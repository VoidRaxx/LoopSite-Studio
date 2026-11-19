use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub port: u16,
    pub runtime: String,
    #[serde(default)]
    pub php_executable_path: Option<String>,
    pub router_file: Option<String>,
    pub lan_access: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainRoute {
    pub id: String,
    pub hostname: String,
    pub server_id: String,
    pub https: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub servers: Vec<ServerConfig>,
    pub domains: Vec<DomainRoute>,
}

fn projects_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    Ok(dir.join("projects.json"))
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 80 &&
        value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
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
        if !valid_identifier(&project.id) || !project_ids.insert(project.id.as_str()) {
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
            if !valid_identifier(&server.id) || !server_ids.insert(server.id.as_str()) {
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
            if let Some(ref executable) = server.php_executable_path {
                if server.runtime != "php" || !std::path::Path::new(executable).is_absolute()
                    || executable.trim().is_empty() || executable.contains(['\n', '\r', '\0']) {
                    return Err("Ungültiger PHP-Pfad in der Serverkonfiguration.".into());
                }
            }
            if let Some(router) = &server.router_file {
                if router.contains(['\n', '\r', '\0']) || router.trim().is_empty() {
                    return Err("Ungültige Router-Datei.".into());
                }
            }
        }

        let mut domain_ids = HashSet::new();
        for domain in &project.domains {
            if !valid_identifier(&domain.id) || !domain_ids.insert(domain.id.as_str()) {
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
    let tmp_path = path.with_extension(format!("json.tmp.{}", std::process::id()));
    fs::write(&tmp_path, json).map_err(|err| err.to_string())?;
    if let Err(err) = fs::rename(&tmp_path, &path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Projektkonfiguration konnte nicht sicher gespeichert werden: {err}"));
    }
    Ok(())
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

    fn fixture(project_id: &str, hostname: &str, port: u16) -> Project {
        let root_path = std::env::temp_dir().to_string_lossy().to_string();
        Project {
            id: project_id.into(), name: "Example".into(), root_path: root_path.clone(),
            servers: vec![ServerConfig {
                id: format!("server-{project_id}"), name: "Web".into(), root_path,
                port, runtime: "php".into(), php_executable_path: None, router_file: None, lan_access: false
            }],
            domains: vec![DomainRoute {
                id: format!("domain-{project_id}"),
                hostname: hostname.into(),
                server_id: format!("server-{project_id}"), https: false
            }],
        }
    }

    #[test]
    fn separate_projects_can_have_separate_servers() {
        assert!(validate(&[
            fixture("p1", "one.localhost", 8000),
            fixture("p2", "two.localhost", 8001)
        ]).is_ok());
    }

    #[test]
    fn legacy_server_config_defaults_to_automatic_php() {
        let json = r#"{"id":"s1","name":"PHP","rootPath":"/tmp","port":8000,"runtime":"php","routerFile":null,"lanAccess":false}"#;
        let config: ServerConfig = serde_json::from_str(json).unwrap();
        assert!(config.php_executable_path.is_none());
    }

    #[test]
    fn explicit_php_path_survives_roundtrip() {
        let mut project = fixture("p1", "demo.localhost", 8000);
        #[cfg(windows)]
        let path = r"C:\php\php.exe";
        #[cfg(not(windows))]
        let path = "/usr/bin/php8.4";
        project.servers[0].php_executable_path = Some(path.into());
        let encoded = serde_json::to_string(&project).unwrap();
        let restored: Project = serde_json::from_str(&encoded).unwrap();
        assert_eq!(restored.servers[0].php_executable_path.as_deref(), Some(path));
    }

    #[test]
    fn duplicate_port_across_projects_rejected() {
        assert!(validate(&[
            fixture("p1", "one.localhost", 8000),
            fixture("p2", "two.localhost", 8000)
        ]).is_err());
    }

    #[test]
    fn duplicate_domain_across_projects_rejected() {
        assert!(validate(&[
            fixture("p1", "same.localhost", 8000),
            fixture("p2", "same.localhost", 8001)
        ]).is_err());
    }

    #[test]
    fn multiple_hosts_can_point_to_one_server() {
        let mut project = fixture("p1", "main.localhost", 8000);
        project.domains.push(DomainRoute {
            id: "domain2".into(), hostname: "api.main.localhost".into(),
            server_id: "server-p1".into(), https: false
        });
        assert!(validate(&[project]).is_ok());
    }

    #[test]
    fn invalid_references_rejected() {
        let mut project = fixture("p1", "main.localhost", 8000);
        project.domains[0].server_id = "missing-server".into();
        assert!(validate(&[project]).is_err());
    }

    #[test]
    fn project_id_must_not_be_a_path() {
        let project = fixture("../escape", "main.localhost", 8000);
        assert!(validate(&[project]).is_err());
    }

}