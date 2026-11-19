use crate::projects;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub hostname_count: usize,
}

struct ProxyProcess {
    child: Child,
    port: u16,
    hostname_count: usize,
    log_path: PathBuf,
}

#[derive(Default)]
pub struct ProxyManager(Mutex<Option<ProxyProcess>>);

fn config_for(projects: &[projects::Project], port: u16) -> Result<(String, usize), String> {
    if port == 0 {
        return Err("Proxy-Port muss zwischen 1 und 65535 liegen.".into());
    }
    if projects.iter().flat_map(|p| &p.servers).any(|s| s.port == port) {
        return Err(format!("Proxy-Port {port} ist bereits einem Projektserver zugewiesen."));
    }
    let mut lines = vec![
        "{".to_string(),
        "    admin off".to_string(),
        "    auto_https off".to_string(),
        "}".to_string(),
        format!(":{port} {{"),
        "    bind 127.0.0.1".to_string(),
    ];
    let mut count = 0usize;
    for project in projects {
        for route in &project.domains {
            let server = project.servers.iter().find(|s| s.id == route.server_id)
                .ok_or_else(|| format!("Domain {} ohne Zielserver.", route.hostname))?;
            // These hostnames are checked by projects::load_projects. Repeat the
            // essential safety validation to protect Caddyfile serialization.
            if !is_safe_hostname(&route.hostname) {
                return Err(format!("Unsicherer Domainname: {}", route.hostname));
            }
            lines.push(format!("    @route{count} host {}", route.hostname));
            lines.push(format!("    handle @route{count} {{"));
            lines.push(format!("        reverse_proxy 127.0.0.1:{}", server.port));
            lines.push("    }".to_string());
            count += 1;
        }
    }
    if count == 0 {
        return Err("Keine lokalen Domains konfiguriert. Füge zuerst eine Domain zu einem Projekt hinzu.".into());
    }
    lines.push("    handle {".into());
    lines.push("        respond \"Unknown LoopSite hostname\" 404".into());
    lines.push("    }".into());
    lines.push("}".into());
    Ok((lines.join("\n") + "\n", count))
}

fn is_safe_hostname(value: &str) -> bool {
    if value.len() > 253 || value.is_empty() || value != value.to_ascii_lowercase() {
        return false;
    }
    let labels: Vec<_> = value.split('.').collect();
    labels.len() >= 2 && labels.iter().all(|label| {
        !label.is_empty() && label.len() <= 63 && !label.starts_with('-') &&
        !label.ends_with('-') &&
        label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}

fn status(manager: &mut Option<ProxyProcess>) -> Result<ProxyStatus, String> {
    if let Some(process) = manager {
        if process.child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(ProxyStatus {
                running: true, port: Some(process.port), hostname_count: process.hostname_count,
            });
        }
    }
    *manager = None;
    Ok(ProxyStatus { running: false, port: None, hostname_count: 0 })
}

#[tauri::command]
pub fn proxy_status(state: State<'_, ProxyManager>) -> Result<ProxyStatus, String> {
    let mut lock = state.0.lock().map_err(|_| "Proxy-Status nicht verfügbar.")?;
    status(&mut lock)
}

#[tauri::command]
pub fn start_proxy(
    app: AppHandle,
    state: State<'_, ProxyManager>,
    port: u16,
) -> Result<ProxyStatus, String> {
    let mut lock = state.0.lock().map_err(|_| "Proxy-Status nicht verfügbar.")?;
    if status(&mut lock)?.running {
        return Err("Der Domain-Proxy läuft bereits. Stoppe ihn zuerst, um Änderungen zu übernehmen.".into());
    }

    let projects = projects::load_projects(app.clone())?;
    let (config, hostname_count) = config_for(&projects, port)?;
    let socket = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let port_lock = TcpListener::bind(socket)
        .map_err(|err| format!("Proxy-Port {port} ist nicht verfügbar: {err}"))?;

    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let config_path = config_dir.join("LoopSite.Caddyfile");
    fs::write(&config_path, config).map_err(|e| format!("Proxy-Konfiguration: {e}"))?;
    let log_path = log_dir.join("local-proxy.log");

    // Explicit argv: do not pass user-defined hostnames through a command shell.
    // caddy must be installed separately until runtime provisioning is available.
    let caddy_path = crate::executables::resolve("caddy")?;
    let output = Command::new(&caddy_path)
        .arg("validate").arg("--config").arg(&config_path).arg("--adapter").arg("caddyfile")
        .output()
        .map_err(|err| format!("Caddy fehlt oder konnte nicht gestartet werden: {err}. Installiere Caddy und füge es deinem PATH hinzu."))?;
    if !output.status.success() {
        return Err(format!("Caddy-Konfiguration ungültig: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let stdout = OpenOptions::new().write(true).create(true).truncate(true)
        .open(&log_path).map_err(|e| e.to_string())?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
    drop(port_lock);
    let mut command = Command::new(&caddy_path);
    command.arg("run").arg("--config").arg(&config_path).arg("--adapter").arg("caddyfile")
        .current_dir(&config_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|e| format!("Domain-Proxy konnte nicht gestartet werden: {e}"))?;
    for _ in 0..50 {
        if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("Caddy wurde unerwartet beendet ({exit}). Siehe {}", log_path.display()));
        }
        if TcpStream::connect_timeout(&socket, Duration::from_millis(100)).is_ok() {
            *lock = Some(ProxyProcess { child, port, hostname_count, log_path });
            return Ok(ProxyStatus { running: true, port: Some(port), hostname_count });
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(format!("Caddy antwortet nicht auf 127.0.0.1:{port}. Details: {}", log_path.display()))
}

#[tauri::command]
pub fn stop_proxy(state: State<'_, ProxyManager>) -> Result<(), String> {
    let mut lock = state.0.lock().map_err(|_| "Proxy-Status nicht verfügbar.")?;
    let mut process = lock.take().ok_or("Der Domain-Proxy läuft nicht.")?;
    if process.child.try_wait().map_err(|e| e.to_string())?.is_none() {
        process.child.kill().map_err(|e| format!("Caddy konnte nicht beendet werden: {e}"))?;
    }
    process.child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_proxy_log(app: AppHandle) -> Result<String, String> {
    let log_path = app.path().app_log_dir().map_err(|e| e.to_string())?.join("local-proxy.log");
    let mut file = File::open(log_path).map_err(|e| format!("Noch kein Proxy-Log vorhanden: {e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(32_768))).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

impl ProxyManager {
    pub fn stop_all(&self) {
        if let Ok(mut lock) = self.0.lock() {
            if let Some(mut process) = lock.take() {
                let _ = process.child.kill();
                let _ = process.child.wait();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_proxy_rejected() {
        assert!(config_for(&[], 8080).is_err());
    }
    #[test]
    fn invalid_hostnames_rejected() {
        assert!(!is_safe_hostname("test.com\nrespond 200"));
        assert!(!is_safe_hostname("a..localhost"));
        assert!(is_safe_hostname("api.localhost"));
    }
    #[test]
    fn creates_host_routes() {
        let p = projects::Project {
            id: "project".into(), name: "Website".into(), root_path: "/tmp".into(),
            servers: vec![projects::ServerConfig {
                id: "server".into(), name: "PHP".into(), root_path: "/tmp".into(),
                port: 8000, runtime: "php".into(), router_file: None, lan_access: false,
            }],
            domains: vec![
                projects::DomainRoute { id:"d1".into(), hostname:"demo.localhost".into(), server_id:"server".into(), https:false },
                projects::DomainRoute { id:"d2".into(), hostname:"api.demo.localhost".into(), server_id:"server".into(), https:false },
            ],
        };
        let (text, count) = config_for(&[p.clone()], 8080).unwrap();
        assert_eq!(count, 2);
        assert!(text.contains("@route0 host demo.localhost"));
        assert!(text.contains("@route1 host api.demo.localhost"));
        assert!(text.contains("reverse_proxy 127.0.0.1:8000"));
        assert!(text.contains("bind 127.0.0.1"));
        assert!(config_for(&[p], 8000).is_err());
    }
}
