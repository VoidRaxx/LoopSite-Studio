# Server execution (experimental)

PHP projects require `php` to be available in the host's PATH. The configured router file, when provided, must exist within the canonical document root. Static files are restricted to a whitelist of common public asset extensions.

- Start and stop actions run in the Tauri Rust backend, not in the WebView.
- Server startup and status information is provided in the UI; PHP output goes to the app's log directory.
- 127.0.0.1 is the default bind address. LAN is opt-in and exposes that port to reachable devices; do not enable it for sensitive projects.
- Stopping a server terminates its managed PHP process.
- This is an experimental implementation, not yet verified by native Windows/Linux builds.
- Domain routing, HTTPS proxy, PHP version installation, SQLite/MariaDB management, and editor are not implemented yet.
