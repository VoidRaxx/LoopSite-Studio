use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    id: String,
    name: String,
    root_path: String,
    port: u16,
    runtime: String,
    router_file: Option<String>,
    lan_access: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainRoute {
    id: String,
    hostname: String,
    server_id: String,
    https: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: String,
    name: String,
    root_path: String,
    servers: Vec<ServerConfig>,
    domains: Vec<DomainRoute>,
}

fn projects_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    Ok(dir.join("projects.json"))
}

fn valid_hostname(host: &str) -> bool {
    if host.len() > 253 || host.is_empty() || host != host.to_ascii_lowercase() {
        return false;
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    labels.into_iter().all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}

fn validate(projects: &[Project]) -> Result<(), String> {
    let mut project_ids = HashSet::new();
    let mut all_ports = HashSet::new();
    let mut all_hostnames = HashSet::new();

    for project in projects {
        if project.id.trim().is_empty() || !project_ids.insert(project.id.as_str()) {
            return Err("Ungültige oder doppelte Projekt-ID.".into());
        }
        if project.name.trim().is_empty() || project.name.len() > 80 {
            return Err("Projektname ist leer oder zu lang.".into());
        }
        if !std::path::Path::new(&project.root_path).is_dir() {
            return Err(format!("Projektordner existiert nicht: {}", project.root_path));
        }

        let mut server_ids = HashSet::new();
        for server in &project.servers {
            if server.id.trim().is_empty() || !server_ids.insert(server.id.as_str()) {
                return Err("Doppelte oder ungültige Server-ID.".into());
            }
            if server.name.trim().is_empty() || server.name.len() > 80 {
                return Err("Servername ist leer oder zu lang.".into());
            }
            if !std::path::Path::new(&server.root_path).is_dir() {
                return Err(format!("Serverordner existiert nicht: {}", server.root_path));
            }
            if server.port == 0 || !all_ports.insert(server.port) {
                return Err(format!("Port {} ist ungültig oder mehrfach vergeben.", server.port));
            }
            if !matches!(server.runtime.as_str(), "php" | "static" | "custom") {
                return Err("Unbekannte Server-Runtime.".into());
            }
            if let Some(router) = &server.router_file {
                if router.contains(['\n', '\r', '\0']) || router.trim().is_empty() {
                    return Err("Ungültige Router-Datei.".into());
                }
            }
        }

        let mut domain_ids = HashSet::new();
        for domain in &project.domains {
            if domain.id.trim().is_empty() || !domain_ids.insert(domain.id.as_str()) {
                return Err("Doppelte oder ungültige Domain-ID.".into());
            }
            if !server_ids.contains(domain.server_id.as_str()) {
                return Err(format!("Domain {} zeigt auf unbekannten Server.", domain.hostname));
            }
            if !valid_hostname(&domain.hostname) || !all_hostnames.insert(domain.hostname.as_str()) {
                return Err(format!("Hostname ungültig oder mehrfach vergeben: {}", domain.hostname));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn load_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    let path = projects_file(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let projects: Vec<Project> = serde_json::from_str(&content)
        .map_err(|err| format!("Ungültige Projektkonfiguration: {err}"))?;
    validate(&projects)?;
    Ok(projects)
}

#[tauri::command]
pub fn save_projects(app: AppHandle, projects: Vec<Project>) -> Result<(), String> {
    validate(&projects)?;
    let path = projects_file(&app)?;
    let parent = path.parent().ok_or("Kein Konfigurationsverzeichnis gefunden.")?;
    fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    let json = serde_json::to_vec_pretty(&projects).map_err(|err| err.to_string())?;
    fs::write(path, json).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hostname_validation() {
        assert!(valid_hostname("api.projekt.localhost"));
        assert!(valid_hostname("mein-projekt.test"));
        assert!(!valid_hostname("localhost"));
        assert!(!valid_hostname("EXAMPLE.localhost"));
        assert!(!valid_hostname("bad..localhost"));
        assert!(!valid_hostname("-bad.localhost"));
        assert!(!valid_hostname("bad.localhost:8000"));
    }
}
