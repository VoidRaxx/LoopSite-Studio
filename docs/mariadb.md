# MariaDB / MySQL connection (experimental)

This milestone adds a **native local MariaDB/MySQL client** inside the desktop app.
It is independent of the project-scoped SQLite manager.

## Supported

- Connect to an **existing** local server over TCP on 127.0.0.1 or ::1 (default 3306).
- Credentials are supplied on connect and retained only in process memory by the database driver; LoopSite never saves the password in project files, configuration, logs or CLI arguments.
- Disconnect manually or close LoopSite to end the session.
- Show non-system databases, create databases with utf8mb4, list existing tables and view a read-only preview of up to 100 rows.
- Basic SQL identifier validation, escaping, and parameterized metadata queries.

## Prerequisites

MariaDB or MySQL must already be installed and running. For XAMPP on Windows, start MySQL in XAMPP, then enter its local port, username and password in LoopSite Studio.

## Limitations

- No automatic MariaDB download/installation or service controls yet. LoopSite does not change an existing XAMPP installation.
- No phpMyAdmin integration, SQL import/export, editing rows, deleting databases, users/privileges, or backups yet.
- No remote DB connections, no TLS transport (loopback only), no credentials on disk.
- Direct queries use the account's existing SQL privileges. Use a dedicated development account with minimal required privileges.
- Table previews are limited to 100 rows and 64 columns. Large binary values are displayed as placeholders when not valid UTF-8; large result sets can still require significant memory. Do not point this early preview at tables with large untrusted BLOB contents.
- MariaDB databases belong to the database instance, not automatically to a LoopSite project.
- Compatibility is expected with MariaDB/MySQL over the standard protocol but must be verified with actual XAMPP/MariaDB installations before a stable release.

## Test coverage

Unit tests exercise permitted loopback hosts, identifiers, quoting and binary value handling. GitHub Actions compile and test on Windows and Ubuntu. Integration tests with a real MariaDB instance remain necessary.
