# Native SQLite database manager (experimental)

LoopSite Studio can create and manage **SQLite** databases directly inside the desktop application. SQLite is embedded through \`rusqlite\` with the \`bundled\` feature. A separate database daemon is not required.

## Implemented

- Project-scoped database names; databases from another project are not shown.
- Create a SQLite database, list databases, show its local file path and size.
- Create tables with an automatic INTEGER PRIMARY KEY \`id\` and user-defined columns (TEXT, INTEGER, REAL, NUMERIC, BLOB; optional NOT NULL).
- List tables and preview the first 100 rows (max. 100 columns), truncating long cell contents.
- Insert rows using SQLite parameter binding. Empty optional fields become NULL.
- Import an existing SQLite file (`.sqlite`, `.sqlite3` or `.db`) into a new project database without overwriting existing data.
- Export an existing SQLite database to a consistent `.sqlite3` snapshot using `VACUUM INTO`; export destinations must not already exist.
- Check database integrity before and after copying; reject symlinks, invalid SQLite inputs and input files larger than 512 MiB.
- Local database files are stored under the OS application-local-data directory, in \`sqlite/<project-id>/<database-name>.sqlite3\`, not in the PHP web root.
- No user-provided arbitrary SQL is executed; table and column names are validated and escaped.

## How to use

1. Create or select a project in the Projects view.
2. Open **Datenbanken** in the sidebar.
3. Enter a database name and select **Datenbank erstellen**.
4. Add a table, define its fields, and choose **Tabelle erstellen**.
5. Select a table, click **+ Datensatz**, and fill in the fields.
6. Use **Aktualisieren** to reload tables and records.
7. Use **Sicherung exportieren** to save a portable SQLite snapshot, or supply a database name and choose **SQLite-Datei auswählen** to import a file.

## Limitations and safety

- MariaDB/MySQL management and phpMyAdmin integration are **not yet implemented**.
- Plain-text `.sql` import/export, SQL console, schema changes, deletion, scheduled backups and restore-over-existing databases are **not yet implemented**.
- Databases are **not automatically mounted into PHP projects**; the file path is displayed so users can explicitly configure their application to open it.
- Created databases live in the application's local-data directory. Uninstalling may remove app data depending on the installer settings. **Keep your own backups.**
- The UI is intended for local trusted-user development and is not an exposed network administration endpoint.
- Database names and new identifiers must be simple ASCII identifiers (letters, digits, underscores or dashes, up to 48 chars, starting with a letter). Internal metadata is not published to web servers.
- All insert values are parameterized; identifiers are quoted. File symlinks are rejected for database files.
- Runtime and installer tests must pass on both supported platforms before calling this stable.

## Testing

Backend Rust tests cover:
- Creating and reopening a SQLite database
- Table creation and inserting/browsing rows
- Rejection of duplicate databases
- Rejection of traversal, invalid columns/types and unsafe table names
- NOT NULL constraints

GitHub Actions compile and run Rust tests on Windows and Linux. Actual packaged application smoke tests remain necessary.
