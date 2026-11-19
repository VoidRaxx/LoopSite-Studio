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

**Saving:** Writes go to a temporary file in the target directory, are synced to disk, and then replace the existing file via the operating system rename operation. The original is left in place if writing fails. Important files should still be version controlled or backed up; filesystem semantics and external concurrent edits can vary.

To run the desktop application from source:

- Install Rust, Node.js, and Tauri's OS-specific native prerequisites.
- Run npm install, then npm run tauri dev.
- To produce a native package, use npm run tauri build after tests pass.
