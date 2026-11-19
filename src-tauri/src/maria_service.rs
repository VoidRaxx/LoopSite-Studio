//! Starts an already installed, explicitly selected local database service.
//! Never installs services, modifies data directories or runs arbitrary shell input.
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use std::thread;

fn service_name(value: &str) -> Result<&'static str,String> {
    match value {
        "MariaDB" => Ok("MariaDB"),
        "MySQL" => Ok("MySQL"),
        "MySQL80" => Ok("MySQL80"),
        _ => Err("Unbekannter Datenbankdienst.".into()),
    }
}

fn build_command(service:&str)->Result<Command,String>{
    service_name(service)?;
    #[cfg(windows)] {
        let windir=std::env::var_os("SystemRoot").ok_or("Windows-Systemverzeichnis nicht gefunden.")?;
        let binary=std::path::PathBuf::from(windir).join("System32").join("sc.exe");
        if !binary.is_file(){return Err("Windows-Dienststeuerung ist nicht verfügbar.".into())}
        let mut command=Command::new(binary);
        command.arg("start").arg(service);
        Ok(command)
    }
    #[cfg(target_os="linux")] {
        let service_unit=if service=="MySQL" || service=="MySQL80"{"mysql"}else{"mariadb"};
        if !std::path::Path::new("/usr/bin/pkexec").is_file() ||
            !std::path::Path::new("/usr/bin/systemctl").is_file() {
            return Err("Polkit und systemctl müssen installiert sein, damit ein Systemdienst gestartet werden kann.".into());
        }
        let mut command=Command::new("/usr/bin/pkexec");
        command.args(["/usr/bin/systemctl","start",service_unit]);
        Ok(command)
    }
    #[cfg(not(any(windows,target_os="linux")))] {
        Err("Dienststart ist derzeit nur unter Windows und Linux verfügbar.".into())
    }
}

fn start_service(service:&str)->Result<String,String>{
    let mut cmd=build_command(service)?;
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child=cmd.spawn().map_err(|e|format!("Datenbankdienst konnte nicht gestartet werden: {e}"))?;
    let start=Instant::now();
    while child.try_wait().map_err(|e|e.to_string())?.is_none(){
        if start.elapsed()>Duration::from_secs(60){
            let _=child.kill();let _=child.wait();
            return Err("Dienststart abgebrochen (Zeitüberschreitung nach 60 Sekunden).".into());
        }
        thread::sleep(Duration::from_millis(150));
    }
    let result=child.wait_with_output().map_err(|e|e.to_string())?;
    if !result.status.success(){
        return Err(format!("Dienststart fehlgeschlagen ({}). Prüfe, ob der Dienst installiert ist und die nötigen Administratorrechte vorliegen. {}",
            result.status,String::from_utf8_lossy(&result.stderr).chars().take(600).collect::<String>()));
    }
    Ok(format!("Dienst {service} wurde gestartet. Verbindung anschließend herstellen."))
}

#[tauri::command]
pub async fn start_local_mariadb_service(service:String)->Result<String,String>{
    service_name(&service)?;
    tauri::async_runtime::spawn_blocking(move ||start_service(&service))
        .await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn only_whitelisted_services(){
        for name in ["", "postgresql", "MariaDB & rm -rf /", "../mysql", "MYSQL"] {
            assert!(service_name(name).is_err());
        }
        assert!(service_name("MariaDB").is_ok());
        assert!(service_name("MySQL80").is_ok());
    }
}
