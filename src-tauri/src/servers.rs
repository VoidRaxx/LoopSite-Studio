use crate::projects;
use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningServer {
    project_id: String,
    server_id: String,
    port: u16,
    lan_access: bool,
}

enum Worker {
    Php(Child),
    Static { stop: Arc<AtomicBool>, thread: JoinHandle<()> },
}

struct Entry {
    details: RunningServer,
    worker: Worker,
    log_path: Option<PathBuf>,
}

#[derive(Default)]
pub struct ServerManager(Mutex<HashMap<String, Entry>>);

fn identifier(project_id: &str, server_id: &str) -> String {
    format!("{project_id}/{server_id}")
}

fn resolve_server(
    app: AppHandle,
    project_id: &str,
    server_id: &str,
) -> Result<projects::ServerConfig, String> {
    projects::load_projects(app)?
        .into_iter()
        .find(|p| p.id == project_id)
        .and_then(|p| p.servers.into_iter().find(|s| s.id == server_id))
        .ok_or_else(|| "Server ist nicht mehr in der Projektkonfiguration vorhanden.".to_string())
}

fn port_address(port: u16, lan_access: bool) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(if lan_access {
        Ipv4Addr::UNSPECIFIED
    } else {
        Ipv4Addr::LOCALHOST
    }), port)
}

fn run_php(
    app: &AppHandle,
    cfg: &projects::ServerConfig,
    root: &Path,
    addr: SocketAddr,
) -> Result<(Worker, PathBuf), String> {
    let mut args = vec!["-S".to_string(), addr.to_string(), "-t".to_string(), root.display().to_string()];
    if let Some(router) = &cfg.router_file {
        let candidate = root.join(router);
        let absolute = candidate
            .canonicalize()
            .map_err(|_| format!("Router-Datei existiert nicht: {}", candidate.display()))?;
        if !absolute.starts_with(root) || !absolute.is_file() {
            return Err("Router muss innerhalb des Serververzeichnisses liegen.".into());
        }
        args.push(absolute.to_string_lossy().into_owned());
    }

    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| format!("Log-Verzeichnis: {e}"))?;
    let log_path = log_dir.join(format!("server-{}-{}.log", cfg.id, cfg.port));
    let stdout = OpenOptions::new()
        .create(true).write(true).truncate(true).open(&log_path)
        .map_err(|e| format!("Log-Datei: {e}"))?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;

    let mut command = Command::new("php");
    command.args(args).current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|e| format!("PHP konnte nicht gestartet werden. Ist PHP im PATH? {e}"))?;
    for _ in 0..30 {
        if let Some(code) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("PHP wurde sofort beendet ({code}). Details im Log: {}", log_path.display()));
        }
        if TcpStream::connect_timeout(
            &SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), cfg.port),
            Duration::from_millis(100),
        ).is_ok() {
            return Ok((Worker::Php(child), log_path));
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(format!("PHP ist auf Port {} nicht erreichbar. Log: {}", cfg.port, log_path.display()))
}

fn static_path(root: &Path, raw_url: &str) -> Result<PathBuf, u16> {
    let path = raw_url.split('?').next().unwrap_or("/");
    if !path.starts_with('/') { return Err(400); }
    let decoded = percent_decode_str(path).decode_utf8().map_err(|_| 400u16)?;
    if decoded.chars().any(|c| matches!(c, '\\' | '\0' | '\r' | '\n')) { return Err(400); }
    let relative = decoded.trim_start_matches('/');
    if relative.split('/').any(|part| part == ".." || part == "." || part.starts_with('.')) {
        return Err(403);
    }
    let mut file = root.join(relative);
    if file.is_dir() { file = file.join("index.html"); }
    let canonical = file.canonicalize().map_err(|_| 404u16)?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err(403);
    }
    let extension = canonical.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(),
        "html" | "htm" | "css" | "js" | "mjs" | "json" | "svg" | "png" | "jpg"
        | "jpeg" | "gif" | "webp" | "ico" | "woff" | "woff2" | "ttf" | "txt" | "map"
        | "wasm" | "avif" | "webmanifest") {
        return Err(403);
    }
    if canonical.file_name().and_then(|s| s.to_str())
        .is_some_and(|n| matches!(n.to_ascii_lowercase().as_str(), "secrets.json" | "package-lock.json" | "composer.json" | "composer.lock")) {
        return Err(403);
    }
    Ok(canonical)
}

fn handle_connection(mut stream: TcpStream, root: &Path) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    let mut buf = [0u8; 8192];
    let count = stream.read(&mut buf)?;
    let request = std::str::from_utf8(&buf[..count]).unwrap_or("");
    let mut tokens = request.lines().next().unwrap_or("").split_whitespace();
    let method = tokens.next().unwrap_or("");
    let path = tokens.next().unwrap_or("");
    let (status, content_type, body, content_length) = if method != "GET" && method != "HEAD" {
        (405, "text/plain; charset=utf-8".to_string(), b"Method not allowed".to_vec(), 18usize)
    } else {
        match static_path(root, path) {
            Ok(file) => match fs::metadata(&file) {
                Ok(meta) if meta.len() <= 32 * 1024 * 1024 => match fs::read(&file) {
                    Ok(data) => {
                        let mime = mime_guess::from_path(&file).first_or_octet_stream().to_string();
                        let length = data.len();
                        (200, mime, data, length)
                    }
                    Err(_) => (500, "text/plain".into(), b"Read failed".to_vec(), 11),
                },
                Ok(_) => (413, "text/plain".into(), b"File too large".to_vec(), 14),
                Err(_) => (404, "text/plain".into(), b"Not found".to_vec(), 9),
            },
            Err(code) => (code, "text/plain".into(), b"Unavailable".to_vec(), 11),
        }
    };
    let status_text = match status {
        200 => "OK", 400 => "Bad Request", 403 => "Forbidden",
        404 => "Not Found", 405 => "Method Not Allowed",
        413 => "Content Too Large", _ => "Internal Server Error",
    };
    write!(stream, "HTTP/1.1 {status} {status_text}\r\nContent-Length: {content_length}\r\nContent-Type: {content_type}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n")?;
    if method != "HEAD" { stream.write_all(&body)?; }
    stream.flush()
}

fn start_static(listener: TcpListener, root: PathBuf) -> Worker {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let thread = thread::spawn(move || {
        let _ = listener.set_nonblocking(true);
        while !flag.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => { let _ = handle_connection(stream, &root); }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
    });
    Worker::Static { stop, thread }
}

fn stop_worker(worker: Worker) -> Result<(), String> {
    match worker {
        Worker::Php(mut child) => {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                child.kill().map_err(|e| format!("Prozess konnte nicht beendet werden: {e}"))?;
            }
            child.wait().map_err(|e| e.to_string())?;
        }
        Worker::Static { stop, thread } => {
            stop.store(true, Ordering::Relaxed);
            thread.join().map_err(|_| "Server-Thread wurde unerwartet beendet.".to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn start_server(
    app: AppHandle,
    state: State<'_, ServerManager>,
    project_id: String,
    server_id: String,
) -> Result<(), String> {
    let cfg = resolve_server(app.clone(), &project_id, &server_id)?;
    if cfg.runtime == "custom" {
        return Err("Benutzerdefinierte Serverprozesse sind noch nicht implementiert.".into());
    }
    let root = Path::new(&cfg.root_path).canonicalize()
        .map_err(|e| format!("Serververzeichnis nicht erreichbar: {e}"))?;
    if !root.is_dir() { return Err("Serververzeichnis ist kein Ordner.".into()); }
    let key = identifier(&project_id, &server_id);
    let mut lock = state.0.lock().map_err(|_| "Interner Serverzustand beschädigt.")?;
    if lock.contains_key(&key) { return Err("Dieser Server läuft bereits.".into()); }

    let addr = port_address(cfg.port, cfg.lan_access);
    let listener = TcpListener::bind(addr).map_err(|e| format!("Port {} ist nicht verfügbar: {e}", cfg.port))?;

    let (worker, log_path) = if cfg.runtime == "php" {
        drop(listener);
        let (worker, log_path) = run_php(&app, &cfg, &root, addr)?;
        (worker, Some(log_path))
    } else {
        (start_static(listener, root), None)
    };

    lock.insert(key, Entry {
        details: RunningServer { project_id, server_id, port: cfg.port, lan_access: cfg.lan_access },
        worker, log_path,
    });
    Ok(())
}

#[tauri::command]
pub fn stop_server(
    state: State<'_, ServerManager>,
    project_id: String,
    server_id: String,
) -> Result<(), String> {
    let entry = state.0.lock().map_err(|_| "Interner Serverzustand beschädigt.")?
        .remove(&identifier(&project_id, &server_id))
        .ok_or_else(|| "Server läuft nicht.".to_string())?;
    stop_worker(entry.worker)
}

#[tauri::command]
pub fn list_running_servers(state: State<'_, ServerManager>) -> Result<Vec<RunningServer>, String> {
    let mut lock = state.0.lock().map_err(|_| "Interner Serverzustand beschädigt.")?;
    lock.retain(|_, entry| match &mut entry.worker {
        Worker::Php(child) => matches!(child.try_wait(), Ok(None)),
        Worker::Static { thread, .. } => !thread.is_finished(),
    });
    Ok(lock.values().map(|entry| entry.details.clone()).collect())
}

#[tauri::command]
pub fn read_server_log(
    state: State<'_, ServerManager>,
    project_id: String,
    server_id: String,
) -> Result<String, String> {
    use std::io::{Seek, SeekFrom};
    let lock = state.0.lock().map_err(|_| "Interner Serverzustand beschädigt.")?;
    let entry = lock.get(&identifier(&project_id, &server_id))
        .ok_or("Server läuft nicht.")?;
    let path = entry.log_path.as_ref().ok_or("Dieser Server hat kein Prozesslog.")?;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(32_768))).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

impl ServerManager {
    pub fn stop_all(&self) {
        if let Ok(mut lock) = self.0.lock() {
            for (_, entry) in lock.drain() {
                let _ = stop_worker(entry.worker);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn port_bindings() {
        assert_eq!(port_address(8000, false).ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_eq!(port_address(8000, true).ip(), IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    }
    #[test]
    fn traversal_is_rejected() {
        let root = std::env::temp_dir();
        assert_eq!(static_path(&root, "/%2e%2e/secrets.json").unwrap_err(), 403);
        assert_eq!(static_path(&root, "/.env").unwrap_err(), 403);
        assert_eq!(static_path(&root, "/hello%5cworld").unwrap_err(), 400);
    }
}
