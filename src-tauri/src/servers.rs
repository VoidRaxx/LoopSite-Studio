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

// Windows canonicalize() yields verbatim paths (\\?\C:\...) that PHP's CLI
// router resolution may fail to open. Convert only process arguments back to
// normal Win32 paths; keep canonical paths for security checks.
#[cfg(windows)]
fn php_argument_path(path: &Path) -> String {
    let original = path.to_string_lossy();
    if let Some(unc) = original.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(local) = original.strip_prefix(r"\\?\") {
        local.to_string()
    } else {
        original.into_owned()
    }
}

#[cfg(not(windows))]
fn php_argument_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn php_server_args(root: &Path, router: Option<&str>, addr: SocketAddr) -> Result<Vec<String>, String> {
    let mut args = vec!["-S".to_string(), addr.to_string(), "-t".into(), php_argument_path(root)];
    if let Some(router) = router {
        let candidate = root.join(router);
        let canonical = candidate.canonicalize()
            .map_err(|_| format!("Router-Datei existiert nicht: {}", candidate.display()))?;
        if !canonical.starts_with(root) || !canonical.is_file() {
            return Err("Router muss eine PHP-Datei innerhalb des Serververzeichnisses sein.".into());
        }
        if !canonical.extension().and_then(|x| x.to_str())
            .is_some_and(|x| x.eq_ignore_ascii_case("php")) {
            return Err("Als PHP-Router kann nur eine vorhandene .php-Datei verwendet werden.".into());
        }
        // PHP -S resolves this path relative to current_dir(root).
        // Passing canonical Windows \\?\ paths breaks request handling.
        let relative = canonical.strip_prefix(root).map_err(|e| e.to_string())?;
        args.push(php_argument_path(relative));
    }
    Ok(args)
}

fn run_php(
    app: &AppHandle,
    cfg: &projects::ServerConfig,
    root: &Path,
    addr: SocketAddr,
) -> Result<(Worker, PathBuf), String> {
    let mut args = php_server_args(root, cfg.router_file.as_deref(), addr)?;

    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| format!("Log-Verzeichnis: {e}"))?;
    let log_path = log_dir.join(format!("server-{}-{}.log", cfg.id, cfg.port));
    let stdout = OpenOptions::new()
        .create(true).write(true).truncate(true).open(&log_path)
        .map_err(|e| format!("Log-Datei: {e}"))?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;

    let php_binary = crate::php::resolve_php(app, cfg.php_executable_path.as_deref())?;
    let mut command = Command::new(php_binary);
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
        Worker::Php(child) => match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => { let _ = child.wait(); false },
            Err(_) => false,
        },
        Worker::Static { thread, .. } => !thread.is_finished(),
    });
    Ok(lock.values().map(|entry| entry.details.clone()).collect())
}

#[tauri::command]
pub fn read_server_log(
    app: AppHandle,
    state: State<'_, ServerManager>,
    project_id: String,
    server_id: String,
) -> Result<String, String> {
    use std::io::{Seek, SeekFrom};
    let lock = state.0.lock().map_err(|_| "Interner Serverzustand beschädigt.")?;
    let path = if let Some(entry) = lock.get(&identifier(&project_id, &server_id)) {
        entry.log_path.clone().ok_or("Dieser Server hat kein Prozesslog.")?
    } else {
        let config = resolve_server(app.clone(), &project_id, &server_id)?;
        if config.runtime != "php" { return Err("Dieser Server hat kein PHP-Prozesslog.".into()); }
        app.path().app_log_dir().map_err(|e| e.to_string())?
            .join(format!("server-{}-{}.log", config.id, config.port))
    };
    let mut file = File::open(&path)
        .map_err(|e| format!("Noch kein Log vorhanden: {e}"))?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(32_768))).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}


#[tauri::command]
pub fn clear_server_log(
    app: AppHandle,
    state: State<'_, ServerManager>,
    project_id: String,
    server_id: String,
) -> Result<(), String> {
    let cfg = resolve_server(app.clone(), &project_id, &server_id)?;
    if cfg.runtime != "php" { return Err("Statische Server haben kein PHP-Prozesslog.".into()); }
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let log_path = log_dir.join(format!("server-{}-{}.log", cfg.id, cfg.port));
    let lock = state.0.lock().map_err(|_| "Interner Serverzustand beschädigt.")?;
    // On Windows a running PHP child may hold handles to this file.
    // Truncate in place rather than trying to delete/rename the active log.
    let _active = lock.get(&identifier(&project_id, &server_id));
    OpenOptions::new().write(true).truncate(true).open(log_path)
        .map_err(|e| format!("Log konnte nicht geleert werden: {e}"))?;
    Ok(())
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

    #[test]
    fn static_server_responds_and_stops() {
        let directory = std::env::temp_dir().join(format!("loopsite-http-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("index.html"), "<h1>LoopSite smoke test</h1>").unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = start_static(listener, fs::canonicalize(&directory).unwrap());

        let mut connection = TcpStream::connect_timeout(&address, Duration::from_secs(2)).unwrap();
        connection.write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
        connection.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut received = String::new();
        connection.read_to_string(&mut received).unwrap();
        assert!(received.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(received.contains("LoopSite smoke test"));

        let mut forbidden = TcpStream::connect_timeout(&address, Duration::from_secs(2)).unwrap();
        forbidden.write_all(b"GET /.env HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
        let mut forbidden_response = String::new();
        forbidden.read_to_string(&mut forbidden_response).unwrap();
        assert!(forbidden_response.starts_with("HTTP/1.1 403 Forbidden\r\n"));

        stop_worker(worker).unwrap();
        assert!(TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn duplicate_tcp_bind_is_rejected() {
        let first = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = first.local_addr().unwrap();
        assert!(TcpListener::bind(address).is_err());
    }
    #[test]
    fn php_router_argument_is_relative_and_validated() {
        let directory = std::env::temp_dir().join(format!("loopsite-router-test-{}", std::process::id()));
        std::fs::create_dir_all(directory.join("src")).unwrap();
        std::fs::write(directory.join("src").join("router.php"), "<?php return false;").unwrap();
        std::fs::write(directory.join("readme.txt"), "not PHP").unwrap();
        let root = directory.canonicalize().unwrap();
        let addr = port_address(8000, false);
        let args = php_server_args(&root, Some("src/router.php"), addr).unwrap();
        assert_eq!(args[0], "-S");
        assert_eq!(args[2], "-t");
        assert_eq!(args[4].replace('\\', "/"), "src/router.php");
        assert!(!args[4].starts_with(r"\\?\"));
        assert!(php_server_args(&root, Some("readme.txt"), addr).is_err());
        assert!(php_server_args(&root, Some("not-found.php"), addr).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_windows_paths_are_normalized_for_php() {
        assert_eq!(php_argument_path(Path::new(r"\\?\C:\Users\Test\index.php")),
                   r"C:\Users\Test\index.php");
        assert_eq!(php_argument_path(Path::new(r"\\?\UNC\server\share\site")),
                   r"\\server\share\site");
    }

    #[cfg(windows)]
    #[test]
    fn windows_php_router_smoke_test() {
        // CI sets this to a real PHP executable; local runs without it skip the
        // integration test instead of assuming PHP is installed.
        let Some(php) = std::env::var_os("LOOPSITE_TEST_PHP") else { return };
        let directory = std::env::temp_dir().join(format!("loopsite-win-php-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("router.php"), "<?php echo 'LOOPSITE_ROUTER_OK';").unwrap();
        let root = directory.canonicalize().unwrap();
        let reserved = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = reserved.local_addr().unwrap();
        drop(reserved);
        let args = php_server_args(&root, Some("router.php"), addr).unwrap();
        let mut child = Command::new(php).args(args)
            .current_dir(&root).stdin(Stdio::null())
            .stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().expect("PHP should be available on the Windows CI runner");
        let mut response = String::new();
        for _ in 0..60 {
            if let Ok(Some(status)) = child.try_wait() {
                panic!("PHP server terminated unexpectedly: {status}");
            }
            if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(100)) {
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                stream.write_all(b"GET /example HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
                let _ = stream.read_to_string(&mut response);
                if response.contains("LOOPSITE_ROUTER_OK") { break; }
            }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
        std::fs::remove_dir_all(directory).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"), "PHP returned unexpected response: {response}");
        assert!(response.contains("LOOPSITE_ROUTER_OK"), "PHP router was not executed correctly: {response}");
    }

}
