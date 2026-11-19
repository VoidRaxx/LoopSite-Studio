# Desktop editor (experimental)

The **Editor** navigation item opens a project-local editor based on Monaco (the text editor engine used by VS Code).

- File explorer with directory navigation, tabs, and Ctrl+S.
- Syntax highlighting for PHP, HTML, CSS, JavaScript, JSON, and more.
- Built-in search and replace with Ctrl+F and Ctrl+H.
- Bundled language workers: no CDN access or cloud account required.
- UTF-8 text files up to 4 MiB; binary files rejected.
- Server-side canonical path checks ensure files cannot escape the selected project directory, including through symlinks.
- Optimistic save: refuses to overwrite a file that changed on disk since it was opened.
- Unsaved changes prompt before closing a tab or navigating away from the editor.
- Only existing text files can be edited at this milestone. Creating, moving, deleting, and renaming files are not available yet.

**Caution:** Save writes currently overwrite the file directly after a conflict check. Keep version control/backups for important project files. Transactional atomic file replacement is not yet implemented and needs further cross-platform testing.

To run the desktop application from source:

- Install Rust, Node.js, and Tauri's OS-specific native prerequisites.
- Run npm install, then npm run tauri dev.
- To produce a native package, use npm run tauri build after tests pass.
