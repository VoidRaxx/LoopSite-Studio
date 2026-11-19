use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REGISTERED: usize = 32;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpRuntime {
    pub path: String,
    pub version: String,
    pub source: String,
}

#[derive(Serialize, Deserialize, Default)]
struct RuntimeSettings {
    registered_paths: Vec<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("php-runtimes.json"))
}

fn settings(app: &AppHandle) -> Result<RuntimeSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(RuntimeSettings::default());
    }
    let bytes = fs::read(path).map_err(|e| format!("PHP-Konfiguration konnte nicht gelesen werden: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("PHP-Konfiguration ist ungültig: {e}"))
}

fn persist_settings(app: &AppHandle, state: &RuntimeSettings) -> Result<(), String> {
    let dest = settings_path(app)?;
    fs::create_dir_all(dest.parent().ok_or("Ungültiger Konfigurationspfad.")?)
        .map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    let tmp = dest.with_extension(format!("json.tmp.{}", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if let Err(err) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("PHP-Konfiguration konnte nicht gespeichert werden: {err}"));
    }
    Ok(())
}

fn valid_binary_name(file: &Path) -> bool {
    let Some(name) = file.file_name().and_then(|n| n.to_str()) else { return false };
    let name = name.to_ascii_lowercase();
    #[cfg(windows)]
    let trimmed = name.strip_suffix(".exe").unwrap_or("");
    #[cfg(not(windows))]
    let trimmed = name.as_str();
    if trimmed == "php" { return true; }
    if let Some(version) = trimmed.strip_prefix("php") {
        let mut parts = version.split('.');
        let major = parts.next().unwrap_or("");
        let minor = parts.next().unwrap_or("");
        return !major.is_empty() && !minor.is_empty() && parts.next().is_none()
            && major.len() <= 2 && minor.len() <= 2
            && major.bytes().all(|b| b.is_ascii_digit())
            && minor.bytes().all(|b| b.is_ascii_digit());
    }
    false
}

fn checked_executable(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("PHP-Pfad muss absolut sein.".into());
    }
    if !valid_binary_name(path) {
        return Err("Bitte eine PHP-CLI-Datei auswählen (php.exe, php oder php8.x).".into());
    }
    let canonical = fs::canonicalize(path).map_err(|e| format!("PHP-Datei fehlt: {e}"))?;
    if !canonical.is_file() {
        return Err("PHP-Pfad verweist nicht auf eine Datei.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::metadata(&canonical).map_err(|e| e.to_string())?.permissions();
        if permissions.mode() & 0o111 == 0 {
            return Err("PHP-Datei ist nicht ausführbar.".into());
        }
    }
    Ok(canonical)
}

fn parse_version(output: &str) -> Option<(u32, u32, u32, String)> {
    // Example: PHP 8.4.12 (cli) (built: ...).
    for line in output.lines() {
        let Some(rest) = line.trim().strip_prefix("PHP ") else { continue };
        let Some(raw) = rest.split_whitespace().next() else { continue };
        let digits = raw.split('.').take(3).collect::<Vec<_>>();
        if digits.len() != 3 { continue }
        let (Ok(major), Ok(minor)) = (digits[0].parse::<u32>(), digits[1].parse::<u32>()) else { continue };
        let patch = digits[2].to_string();
        let Ok(patch) = patch.parse::<u32>() else { continue };
        if major < 5 || major > 20 { continue }
        return Some((major, minor, patch, format!("{major}.{minor}.{patch}")));
    }
    None
}

fn probe(path: &Path) -> Result<(u32, u32, u32, String), String> {
    let path = checked_executable(path)?;
    let mut command = Command::new(&path);
    command.arg("-v")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()
        .map_err(|e| format!("PHP konnte nicht ausgeführt werden: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!("PHP-Version konnte nicht gelesen werden (Exit: {status})."));
                }
                use std::io::Read;
                let mut output = String::new();
                if let Some(stdout) = child.stdout.as_mut() {
                    stdout.take(8_192).read_to_string(&mut output).map_err(|e| e.to_string())?;
                }
                return parse_version(&output).ok_or("Ausgabe enthält keine gültige PHP-Versionsnummer.".into());
            }
            Ok(None) if start.elapsed() < VERSION_TIMEOUT => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("PHP-Versionserkennung hat nach fünf Sekunden abgebrochen.".into());
            }
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(err.to_string());
            }
        }
    }
}

fn candidates() -> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            if !directory.is_absolute() { continue; }
            result.push(directory.join(if cfg!(windows) { "php.exe" } else { "php" }));
            #[cfg(unix)]
            for major in 7..=9 {
                for minor in 0..=9 { result.push(directory.join(format!("php{major}.{minor}"))); }
            }
        }
    }
    #[cfg(windows)]
    {
        result.push(PathBuf::from(r"C:\php\php.exe"));
        result.push(PathBuf::from(r"C:\xampp\php\php.exe"));
    }
    result
}

fn discovered(registered: &[String]) -> Vec<PhpRuntime> {
    let mut paths = candidates();
    paths.extend(registered.iter().map(PathBuf::from));
    let mut visited = HashSet::new();
    let mut runtimes = Vec::new();
    for candidate in paths {
        if !candidate.is_file() { continue; }
        let Ok(real) = checked_executable(&candidate) else { continue };
        if !visited.insert(real.clone()) { continue; }
        if let Ok((_, _, _, version)) = probe(&real) {
            let source = if registered.iter().any(|r| fs::canonicalize(r).ok().as_ref() == Some(&real)) {
                "Manuell hinzugefügt"
            } else {
                "Automatisch erkannt"
            };
            runtimes.push(PhpRuntime {
                path: real.to_string_lossy().into_owned(),
                version,
                source: source.to_string(),
            });
        }
    }
    runtimes.sort_by(|a,b| {
        let rank = |v: &str| v.split('.').map(|x| x.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
        rank(&b.version).cmp(&rank(&a.version)).then_with(|| a.path.cmp(&b.path))
    });
    runtimes
}

#[tauri::command]
pub fn list_php_runtimes(app: AppHandle) -> Result<Vec<PhpRuntime>, String> {
    Ok(discovered(&settings(&app)?.registered_paths))
}

#[tauri::command]
pub fn register_php_runtime(app: AppHandle, path: String) -> Result<PhpRuntime, String> {
    let real = checked_executable(Path::new(&path))?;
    let (_, _, _, version) = probe(&real)?;
    let mut state = settings(&app)?;
    let canonical = real.to_string_lossy().into_owned();
    if !state.registered_paths.iter().any(|p| fs::canonicalize(p).ok().as_ref() == Some(&real)) {
        if state.registered_paths.len() >= MAX_REGISTERED {
            return Err("Maximal 32 manuell registrierte PHP-Versionen erlaubt.".into());
        }
        state.registered_paths.push(canonical.clone());
        persist_settings(&app, &state)?;
    }
    Ok(PhpRuntime { path: canonical, version, source: "Manuell hinzugefügt".into() })
}

pub fn resolve_php(app: &AppHandle, chosen: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = chosen {
        let path = checked_executable(Path::new(path))?;
        probe(&path)?;
        return Ok(path);
    }
    let found = discovered(&settings(app)?.registered_paths);
    found.first().map(|runtime| PathBuf::from(&runtime.path))
        .ok_or_else(|| "Keine PHP-Installation gefunden. Installiere PHP oder wähle im PHP-Manager eine vorhandene php.exe-Datei aus.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_parsing_and_sorting_basics() {
        assert_eq!(parse_version("PHP 8.4.12 (cli) (built: ...)"), Some((8,4,12,"8.4.12".into())));
        assert!(parse_version("PHP 8.5.0RC1 (cli)").is_none());
        assert!(parse_version("Node v22.0.0").is_none());
        assert!(parse_version("PHP malicious").is_none());
    }
    #[test]
    fn only_php_named_executables() {
        #[cfg(windows)]
        { assert!(valid_binary_name(Path::new(r"C:\php\php.exe"))); assert!(!valid_binary_name(Path::new(r"C:\php\cmd.exe"))); }
        #[cfg(not(windows))]
        { assert!(valid_binary_name(Path::new("/usr/bin/php8.4"))); assert!(!valid_binary_name(Path::new("/usr/bin/bash"))); }
    }
    #[test]
    fn relative_paths_are_rejected() {
        assert!(checked_executable(Path::new("php")).is_err());
    }
}
