//! Explicit, allow-listed installation of PHP and Caddy using OS package managers.
//! Never runs shell strings, modifies project files, or downloads unverified archives.
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const MAX_INSTALL_TIME: Duration = Duration::from_secs(600);

#[derive(Default, Clone)]
pub struct InstallState(Arc<AtomicBool>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    component: String,
    manager: String,
    command: String,
    description: String,
    available: bool,
    installed: bool,
    requires_privilege: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    installed: bool,
    log_path: String,
    details: String,
}

struct Spec {
    executable: PathBuf,
    args: Vec<&'static str>,
    manager: &'static str,
    privileged: bool,
}

fn supported_component(component: &str) -> Result<(), String> {
    match component {
        "php" | "caddy" => Ok(()),
        _ => Err("Unbekannte Komponente. Erlaubt sind ausschließlich PHP und Caddy.".into()),
    }
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        if !dir.is_absolute() { continue; }
        let path = dir.join(name);
        if path.is_file() {
            if let Ok(real) = fs::canonicalize(path) {
                if real.is_file() { return Some(real); }
            }
        }
    }
    None
}

#[cfg(windows)]
fn installation_spec(component: &str) -> Result<Spec, String> {
    supported_component(component)?;
    let executable = find_in_path("winget.exe").ok_or(
        "Windows-Paketmanager winget wurde nicht gefunden. Installiere zuerst den Microsoft App Installer."
    )?;
    // These exact IDs are versioned/channel-specific; package managers choose patch releases.
    let package = if component == "php" { "PHP.PHP.8.5" } else { "CaddyServer.Caddy" };
    Ok(Spec {
        executable,
        args: vec!["install", "--exact", "--id", package, "--source", "winget",
            "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"],
        manager: "Windows Package Manager (winget)",
        privileged: false,
    })
}

#[cfg(target_os = "linux")]
fn installation_spec(component: &str) -> Result<Spec, String> {
    supported_component(component)?;
    let pkexec = PathBuf::from("/usr/bin/pkexec");
    if !pkexec.is_file() {
        return Err("Polkit (pkexec) ist nicht verfügbar. Installiere die Komponenten mit deinem System-Paketmanager.".into());
    }
    // Do not add third-party repositories, run full upgrades or enable services.
    // Distribution packages can trail the upstream releases.
    let (manager, package, args): (&str, &str, Vec<&'static str>) =
        if Path::new("/usr/bin/pacman").is_file() {
            ("pacman", if component == "php" {"php"} else {"caddy"},
                vec!["/usr/bin/pacman", "-S", "--needed", "--noconfirm"])
        } else if Path::new("/usr/bin/apt-get").is_file() {
            ("apt-get", if component == "php" {"php-cli"} else {"caddy"},
                vec!["/usr/bin/apt-get", "install", "--yes"])
        } else if Path::new("/usr/bin/dnf").is_file() {
            ("dnf", if component == "php" {"php-cli"} else {"caddy"},
                vec!["/usr/bin/dnf", "install", "--assumeyes"])
        } else {
            return Err("Kein unterstützter Paketmanager gefunden (pacman, apt-get, dnf).".into());
        };
    let mut args = args;
    args.push(package);
    Ok(Spec { executable: pkexec, args, manager, privileged: true })
}

#[cfg(not(any(windows, target_os = "linux")))]
fn installation_spec(component: &str) -> Result<Spec, String> {
    supported_component(component)?;
    Err("Die automatische Installation unterstützt derzeit nur Windows und Linux.".into())
}

fn plan_for(app: &AppHandle, component: &str) -> Result<InstallPlan, String> {
    supported_component(component)?;
    let installed = match component {
        "php" => !crate::php::list_php_runtimes(app.clone())?.is_empty(),
        "caddy" => crate::executables::resolve("caddy").is_ok(),
        _ => false,
    };
    let description = match component {
        "php" => "Installiert eine PHP-CLI-Laufzeit. Windows: aktuelle PHP-8.5-Patchversion; Linux: Version aus den System-Repositories.",
        "caddy" => "Installiert Caddy über den Paketmanager. Achtung: Einige Linux-Pakete starten dabei automatisch einen Systemdienst.",
        _ => unreachable!(),
    };
    match installation_spec(component) {
        Ok(spec) => Ok(InstallPlan {
            component: component.into(), manager: spec.manager.into(),
            command: format!("{} {}", spec.executable.display(), spec.args.join(" ")),
            description: description.into(), available: true, installed,
            requires_privilege: spec.privileged,
        }),
        Err(reason) => Ok(InstallPlan {
            component: component.into(), manager: "Nicht verfügbar".into(),
            command: String::new(), description: format!("{description} {reason}"),
            available: false, installed, requires_privilege: false,
        }),
    }
}

#[tauri::command]
pub fn runtime_install_plan(app: AppHandle, component: String) -> Result<InstallPlan, String> {
    plan_for(&app, &component)
}

fn read_log_tail(path: &Path) -> String {
    match fs::read(path) {
        Ok(contents) => {
            let start = contents.len().saturating_sub(4_096);
            String::from_utf8_lossy(&contents[start..]).into_owned()
        }
        Err(_) => "Keine Installationsausgabe verfügbar.".into(),
    }
}

fn run_install(app: AppHandle, component: String) -> Result<InstallResult, String> {
    let plan = plan_for(&app, &component)?;
    if plan.installed { return Err("Komponente ist bereits vorhanden. Bestehende Installationen werden nicht ungefragt aktualisiert.".into()); }
    if !plan.available { return Err(plan.description); }
    let spec = installation_spec(&component)?;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join(format!("runtime-install-{component}.log"));
    let stdout = OpenOptions::new().create(true).write(true).truncate(true)
        .open(&log_path).map_err(|e| format!("Installationsprotokoll: {e}"))?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
    let mut command = Command::new(&spec.executable);
    command.args(spec.args).stdin(Stdio::null())
        .stdout(Stdio::from(stdout)).stderr(Stdio::from(stderr));
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| format!("Paketmanager konnte nicht gestartet werden: {e}"))?;
    let started = Instant::now();
    let exit = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < MAX_INSTALL_TIME => thread::sleep(Duration::from_millis(200)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Installation nach 10 Minuten abgebrochen. Protokoll: {}", log_path.display()));
            }
            Err(e) => {
                let _ = child.kill(); let _ = child.wait();
                return Err(format!("Installationsprozess fehlgeschlagen: {e}"));
            }
        }
    };
    if !exit.success() {
        return Err(format!("Paketmanager meldet einen Fehler ({exit}). Protokoll: {}. {}",
            log_path.display(), read_log_tail(&log_path)));
    }
    // A successful manager exit is not necessarily visible in the current process PATH,
    // notably when winget changes the user's environment for future sessions.
    let installed = match component.as_str() {
        "php" => !crate::php::list_php_runtimes(app)?.is_empty(),
        "caddy" => crate::executables::resolve("caddy").is_ok(),
        _ => false,
    };
    Ok(InstallResult {
        installed,
        log_path: log_path.to_string_lossy().into_owned(),
        details: if installed {
            "Installation abgeschlossen und Komponente erkannt.".into()
        } else {
            "Paketmanager erfolgreich beendet. Die Laufzeit wurde im aktuellen Prozess noch nicht erkannt. LoopSite Studio bitte neu starten und die Installation erneut prüfen.".into()
        },
    })
}

struct BusyGuard(Arc<AtomicBool>);
impl Drop for BusyGuard {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}

#[tauri::command]
pub async fn install_runtime(
    app: AppHandle,
    state: State<'_, InstallState>,
    component: String,
) -> Result<InstallResult, String> {
    supported_component(&component)?;
    if state.0.swap(true, Ordering::AcqRel) {
        return Err("Es läuft bereits eine Komponenteninstallation.".into());
    }
    let guard = BusyGuard(state.0.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        run_install(app, component)
    }).await.map_err(|e| format!("Installation unterbrochen: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_components_cannot_be_installed() {
        for value in ["", "bash", "mariadb", "../php", "php; rm -rf /"] {
            assert!(supported_component(value).is_err());
        }
        assert!(supported_component("php").is_ok());
        assert!(supported_component("caddy").is_ok());
    }
    #[test]
    fn installer_has_explicit_fixed_arguments() {
        if let Ok(spec) = installation_spec("php") {
            assert!(spec.executable.is_absolute());
            assert!(spec.args.iter().all(|arg| !arg.contains('\n')));
            assert!(!spec.args.contains(&"-c"));
            assert!(!spec.args.contains(&"sh"));
        }
    }
}
