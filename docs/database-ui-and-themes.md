# Database management, theme and UI-density update

## SQLite (embedded, no service required)

SQLite is immediately available when a project database is opened. Create a named database, create tables and rows, edit existing records with a single integer primary key named \`id\`, import and export consistent snapshots.

**Remove a SQLite database:** Use **Datenbank entfernen**, type its exact name and confirm. LoopSite moves the SQLite file to an application-local \`sqlite-archive/<project>/...\` folder instead of permanently deleting the file. Existing WAL, SHM or journal sidecar files block removal to prevent loss of pending changes. Archived files are not listed as active databases. Recovery is currently manual, by importing that saved SQLite file under a new database name; do not erase the archive folder if data is needed.

To edit rows, select a table and click **Bearbeiten**. Editing is enabled only for tables with exactly one \`INTEGER PRIMARY KEY\` named \`id\`. Other tables are read-only until broader row-identity support exists. Avoid concurrent modifications from another program while editing; the record is looked up by its primary key.

## MariaDB/MySQL (existing installed server)

The MariaDB view can start an already installed local **system service** named \`MariaDB\`, \`MySQL\` or \`MySQL80\` before connecting to the loopback server. On Windows the service-control command may require administrator privileges; on Linux it uses Polkit and systemctl. This does **not** install database software or initialize an unconfigured database directory. XAMPP installations that are not registered as system services still need to be started through XAMPP until a separate managed-process workflow is available.

After connecting, create databases and basic tables (automatic numeric \`id\`, up to 24 columns of fixed supported types), browse rows and update individual cells for tables with a single supported primary key. Do not edit critical/production databases without backups.

**MariaDB deletion is permanent.** It invokes \`DROP DATABASE\` on the connected server after typing the exact database name. There is no automatic MariaDB backup/export in this version. System schemas are blocked. User account SQL privileges still apply.

## Appearance

Selectable themes: **Systemstandard** (follows OS dark/light), **Default**, **Universe Dark**, **Universe Light**, **Dark** and **White**. The former \`hu\` theme preference migrates to \`default\`. The old HybrideUniverse name is no longer presented in the app's theme picker; this is a LoopSite Studio theme and uses only the LoopSite logo.

Three UI scales: **Compact**, **Normal** and **Large**. Preferences are stored locally. The editor's Monaco light/dark mode also follows the chosen palette.

## Tests / limitations

Rust unit tests cover SQLite archiving and safe row edits, supported MariaDB column names/types and service allowlisting. Windows/Linux builds and existing database integration tests must pass. A manual Windows test is still needed, particularly for service permissions, theme switching and interactive form behavior.
