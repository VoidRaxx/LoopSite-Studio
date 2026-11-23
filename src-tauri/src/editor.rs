use crate::projects;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const MAX_TEXT_BYTES: u64 = 4 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFile {
    content: String,
    hash: String,
}

fn project_root(app: AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let project = projects::load_projects(app)?
        .into_iter().find(|p| p.id == project_id)
        .ok_or("Projekt existiert nicht.")?;
    let root = fs::canonicalize(&project.root_path).map_err(|err| err.to_string())?;
    if !root.is_dir() {
        return Err("Projektpfad ist kein Verzeichnis.".into());
    }
    Ok(root)
}

fn checked_parts(path: &str, allow_root: bool) -> Result<Vec<&str>, String> {
    if path.is_empty() && allow_root {
        return Ok(vec![]);
    }
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || path.contains(':')
        || path.split('/').any(|s| s.is_empty() || s == "." || s == ".." || s.eq_ignore_ascii_case(".git"))
    {
        return Err("Ungültiger Projektpfad.".into());
    }
    Ok(path.split('/').collect())
}

fn checked_path(root: &Path, relative: &str, allow_root: bool) -> Result<PathBuf, String> {
    let segments = checked_parts(relative, allow_root)?;
    let mut candidate = root.to_path_buf();
    for segment in segments {
        candidate.push(segment);
    }
    let canonical = fs::canonicalize(candidate).map_err(|err| format!("Datei/Ordner nicht gefunden: {err}"))?;
    if !canonical.starts_with(root) {
        return Err("Zugriff außerhalb des Projektordners verweigert.".into());
    }
    if canonical.strip_prefix(root).map_err(|e| e.to_string())?
        .components().any(|c| c.as_os_str().to_string_lossy().eq_ignore_ascii_case(".git")) {
        return Err("Git-Verwaltungsdateien sind geschützt.".into());
    }
    Ok(canonical)
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn load_text(path: &Path) -> Result<OpenFile, String> {
    if !path.is_file() {
        return Err("Dieser Pfad ist keine Datei.".into());
    }
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err("Datei ist zu groß (maximal 4 MiB).".into());
    }
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err("Datei ist zu groß (maximal 4 MiB).".into());
    }
    if bytes.contains(&0) {
        return Err("Binärdateien können nicht als Text bearbeitet werden.".into());
    }
    let content = String::from_utf8(bytes.clone())
        .map_err(|_| "Nur UTF-8-Textdateien werden derzeit unterstützt.".to_string())?;
    Ok(OpenFile { content, hash: digest(&bytes) })
}

#[tauri::command]
pub fn list_project_directory(
    app: AppHandle,
    project_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let root = project_root(app, &project_id)?;
    let dir = checked_path(&root, &path, true)?;
    if !dir.is_dir() {
        return Err("Der Pfad ist kein Ordner.".into());
    }
    let mut files = Vec::new();
    for result in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = result.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" || name.chars().any(|c| matches!(c, '/' | '\\' | '\0')) {
            continue;
        }
        // Hide out-of-project symlink targets and broken links.
        let real = match entry.path().canonicalize() {
            Ok(p) if p.starts_with(&root) &&
                !p.strip_prefix(&root).is_ok_and(|r| r.components().any(|c| c.as_os_str().to_string_lossy().eq_ignore_ascii_case(".git"))) => p,
            _ => continue,
        };
        files.push(FileEntry {
            name: name.clone(),
            path: if path.is_empty() { name } else { format!("{path}/{name}") },
            is_dir: real.is_dir(),
        });
        if files.len() > MAX_DIRECTORY_ENTRIES {
            return Err("Der Ordner enthält über 500 Einträge. Bitte öffne einen kleineren Unterordner.".into());
        }
    }
    files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(files)
}

#[tauri::command]
pub fn read_project_file(
    app: AppHandle,
    project_id: String,
    path: String,
) -> Result<OpenFile, String> {
    let root = project_root(app, &project_id)?;
    let file = checked_path(&root, &path, false)?;
    load_text(&file)
}

fn checked_save(file: &Path, content: &str, expected_hash: &str) -> Result<String, String> {
    if content.len() as u64 > MAX_TEXT_BYTES {
        return Err("Datei ist zu groß (maximal 4 MiB).".into());
    }
    let current = load_text(file)?;
    if current.hash != expected_hash {
        return Err("Die Datei wurde zwischenzeitlich außerhalb von LoopSite geändert. Bitte neu öffnen und Änderungen vergleichen.".into());
    }
    // Write beside the target and replace it only after a successful sync.
    // The original file remains intact if writing the temporary file fails.
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?.as_nanos();
    let filename = file.file_name().ok_or("Dateiname nicht gefunden.")?.to_string_lossy();
    let temporary = file.with_file_name(format!(".{filename}.loopsite-{}-{timestamp}.tmp", std::process::id()));
    let write_result = (|| -> Result<(), String> {
        let mut output = OpenOptions::new().write(true).create_new(true)
            .open(&temporary).map_err(|err| err.to_string())?;
        output.write_all(content.as_bytes()).map_err(|err| err.to_string())?;
        output.sync_all().map_err(|err| err.to_string())?;
        let permissions = fs::metadata(file).map_err(|err| err.to_string())?.permissions();
        fs::set_permissions(&temporary, permissions).map_err(|err| err.to_string())?;
        if load_text(file)?.hash != expected_hash {
            return Err("Datei hat sich während des Speicherns verändert.".into());
        }
        fs::rename(&temporary, file).map_err(|err| err.to_string())?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result.map_err(|err| format!("Datei konnte nicht sicher gespeichert werden: {err}"))?;
    Ok(digest(content.as_bytes()))
}

#[tauri::command]
pub fn save_project_file(
    app: AppHandle,
    project_id: String,
    path: String,
    content: String,
    expected_hash: String,
) -> Result<String, String> {
    let root = project_root(app, &project_id)?;
    let file = checked_path(&root, &path, false)?;
    checked_save(&file, &content, &expected_hash)
}

fn valid_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    checked_parts(name, false).is_ok_and(|parts| parts.len() == 1)
        && !name.trim().is_empty() && !name.ends_with([' ', '.'])
        && !name.eq_ignore_ascii_case(".git")
        && !name.chars().any(|c| c.is_control() || "<>\"|?*".contains(c))
        && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        && !(stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
}

// Both APIs fail atomically if the destination already exists.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn move_new(from: &Path, to: &Path) -> std::io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};
    renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE).map_err(Into::into)
}

#[cfg(windows)]
fn move_new(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" { fn MoveFileW(from: *const u16, to: *const u16) -> i32; }
    let from: Vec<_> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<_> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // Each buffer is NUL-terminated and stays alive throughout the call.
    if unsafe { MoveFileW(from.as_ptr(), to.as_ptr()) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[tauri::command]
pub fn move_project_entry(app: AppHandle, project_id: String, path: String, destination: String) -> Result<(), String> {
    let root = project_root(app, &project_id)?;
    let parts = checked_parts(&destination, false)?;
    if !parts.iter().all(|s| valid_name(s)) { return Err("Ungültiger Zielpfad.".into()); }
    checked_path(&root, &path, false)?;
    let (parent, name) = path.rsplit_once('/').unwrap_or(("", path.as_str()));
    let source = checked_path(&root, parent, true)?.join(name);
    let (parent, name) = destination.rsplit_once('/').unwrap_or(("", destination.as_str()));
    let destination = checked_path(&root, parent, true)?.join(name);
    move_new(&source, &destination).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project_entry(
    app: AppHandle, project_id: String, directory: String, name: String, folder: bool,
) -> Result<String, String> {
    let root = project_root(app, &project_id)?;
    if !valid_name(&name) {
        return Err("Bitte einen einzelnen Namen eingeben.".into());
    }
    let parent = checked_path(&root, &directory, true)?;
    let target = parent.join(&name);
    if folder {
        fs::create_dir(target).map_err(|err| err.to_string())?;
    } else {
        OpenOptions::new().write(true).create_new(true).open(target).map_err(|err| err.to_string())?;
    }
    Ok(if directory.is_empty() { name } else { format!("{directory}/{name}") })
}

#[derive(Serialize)]
pub struct SearchHit {
    path: String,
    line: usize,
    preview: String,
}

#[derive(Serialize)]
pub struct SearchResults {
    hits: Vec<SearchHit>,
    limited: bool,
}

fn search(root: &Path, query: &str, filenames: bool) -> Result<SearchResults, String> {
    if query.is_empty() || query.len() > 512 {
        return Err("Suchbegriff muss zwischen 1 und 512 Bytes lang sein.".into());
    }
    let needle = query.to_lowercase();
    let mut pending = vec![root.to_path_buf()];
    let mut hits = Vec::new();
    let mut visited = 0;
    let mut bytes_left = 128 * 1024 * 1024_u64;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            visited += 1;
            if visited > 25_000 {
                return Ok(SearchResults { hits, limited: true });
            }
            let name = entry.file_name();
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            let full = entry.path();
            let relative = full.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/");
            if checked_parts(&relative, false).is_err() || file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if !matches!(name.to_str(), Some("node_modules" | "vendor" | "target" | "dist")) {
                    pending.push(full);
                }
            } else if file_type.is_file() {
                if filenames {
                    if relative.to_lowercase().contains(&needle) {
                        hits.push(SearchHit { path: relative, line: 1, preview: String::new() });
                    }
                } else {
                    let len = entry.metadata().map_err(|e| e.to_string())?.len();
                    if len > MAX_TEXT_BYTES { continue; }
                    if len > bytes_left { return Ok(SearchResults { hits, limited: true }); }
                    bytes_left -= len;
                    let path = checked_path(root, &relative, false)?;
                    let Ok(content) = fs::read_to_string(path) else { continue };
                    if content.contains('\0') { continue; }
                    for (index, line) in content.lines().enumerate() {
                        if line.to_lowercase().contains(&needle) {
                            hits.push(SearchHit { path: relative.clone(), line: index + 1,
                                preview: line.trim().chars().take(180).collect() });
                            if hits.len() == 100 { break; }
                        }
                    }
                }
                if hits.len() == 100 { return Ok(SearchResults { hits, limited: true }); }
            }
        }
    }
    Ok(SearchResults { hits, limited: false })
}

#[tauri::command]
pub async fn search_project(app: AppHandle, project_id: String, query: String, filenames: bool)
    -> Result<SearchResults, String> {
    tauri::async_runtime::spawn_blocking(move || search(&project_root(app, &project_id)?, &query, filenames))
        .await.map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_traversal_and_drive_paths() {
        assert!(checked_parts("../secret", false).is_err());
        assert!(checked_parts("folder/../../secret", false).is_err());
        assert!(checked_parts("C:/windows/system.ini", false).is_err());
        assert!(checked_parts("/etc/passwd", false).is_err());
        assert!(checked_parts("dir\\file.txt", false).is_err());
        assert!(checked_parts(".git/config", false).is_err());
        assert!(checked_parts("", true).is_ok());
        assert!(checked_parts("src/example.php", false).is_ok());
    }

    #[test]
    fn searches_text_and_paths_and_preserves_existing_move_targets() {
        let root = std::env::temp_dir().join(format!("loopsite-ide-test-{}", std::process::id()));
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "hello").unwrap();
        fs::write(root.join("demo.php"), "first\nHELLO world").unwrap();
        fs::write(root.join("binary.bin"), b"hello\0").unwrap();
        let root = root.canonicalize().unwrap();
        let result = search(&root, "hello", false).unwrap();
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].line, 2);
        assert_eq!(search(&root, "DEMO", true).unwrap().hits[0].path, "demo.php");
        assert!(move_new(&root.join("demo.php"), &root.join("binary.bin")).is_err());
        assert_eq!(fs::read(root.join("binary.bin")).unwrap(), b"hello\0");
        move_new(&root.join("demo.php"), &root.join("renamed.php")).unwrap();
        assert!(root.join("renamed.php").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn requires_portable_single_component_names() {
        for name in ["../test", ".GIT", "NUL.txt", "file.", "x:y", "a/b"] {
            assert!(!valid_name(name));
        }
        assert!(valid_name("mein projekt.php"));
    }

    #[test]
    fn hashes_are_stable_and_sensitive_to_changes() {
        assert_eq!(digest(b"hello"), digest(b"hello"));
        assert_ne!(digest(b"hello"), digest(b"HELLO"));
    }

    #[test]
    fn prevents_overwriting_changed_files() {
        let file = std::env::temp_dir().join(format!("loopsite-test-{}-conflict", std::process::id()));
        fs::write(&file, b"first").unwrap();
        let original = load_text(&file).unwrap();
        fs::write(&file, b"external edit").unwrap();
        assert!(checked_save(&file, "new content", &original.hash).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "external edit");
        let actual = load_text(&file).unwrap();
        let new_hash = checked_save(&file, "saved", &actual.hash).unwrap();
        assert_eq!(new_hash, digest(b"saved"));
        assert_eq!(fs::read_to_string(&file).unwrap(), "saved");
        fs::remove_file(file).unwrap();
    }

    #[test]
    fn rejects_binary_files() {
        let path = std::env::temp_dir().join(format!("loopsite-test-{}-binary", std::process::id()));
        fs::write(&path, b"start\0end").unwrap();
        assert!(load_text(&path).is_err());
        fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_outside_project() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("loopsite-root-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("loopsite-other-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, root.join("link.txt")).unwrap();
        let root = fs::canonicalize(root).unwrap();
        assert!(checked_path(&root, "link.txt", false).is_err());
        fs::remove_file(root.join("link.txt")).unwrap();
        fs::remove_dir(root).unwrap();
        fs::remove_file(outside).unwrap();
    }
}
