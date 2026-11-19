use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn executable_name(name: &str) -> String {
    #[cfg(windows)]
    { format!("{name}.exe") }
    #[cfg(not(windows))]
    { name.to_string() }
}

fn usable(path: &Path) -> bool {
    if !path.is_file() { return false; }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return fs::metadata(path).is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0);
    }
    #[cfg(not(unix))]
    { true }
}

/// Find a real executable in absolute PATH entries only. Never search the
/// current working directory, which may be an untrusted project folder.
pub fn resolve(name: &str) -> Result<PathBuf, String> {
    if !matches!(name, "php" | "caddy") {
        return Err("Unsupported executable name.".into());
    }
    let binary = executable_name(name);
    let paths = env::var_os("PATH").ok_or("PATH environment variable missing.")?;
    for directory in env::split_paths(&paths) {
        if !directory.is_absolute() { continue; }
        let candidate = directory.join(&binary);
        if usable(&candidate) {
            if let Ok(real) = fs::canonicalize(candidate) {
                if real.is_file() {
                    return Ok(real);
                }
            }
        }
    }
    Err(format!("{binary} ist nicht installiert oder im PATH nicht auffindbar."))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn executable_names_are_platform_specific() {
        let actual = executable_name("php");
        #[cfg(windows)]
        assert_eq!(actual, "php.exe");
        #[cfg(not(windows))]
        assert_eq!(actual, "php");
    }
    #[test]
    fn unknown_binary_is_rejected() {
        assert!(resolve("cmd").is_err());
        assert!(resolve("bash").is_err());
        assert!(resolve("../php").is_err());
    }
}
