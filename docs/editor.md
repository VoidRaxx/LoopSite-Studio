# Desktop editor (experimental)

The **Editor** navigation item opens a project-local editor based on Monaco (the text editor engine used by VS Code).

- File explorer with directory navigation, tabs, and Ctrl+S.
- Syntax highlighting for PHP, HTML, CSS, JavaScript, JSON, and more.
- Built-in search and replace with Ctrl+F and Ctrl+H.
- Bundled language workers: no CDN access or cloud account required.
- UTF-8 text files up to 4 MiB; binary files rejected.
- Server-side canonical path checks ensure files cannot escape the selected project directory, including through symlinks.
- Optimistic save: refuses to overwrite a file that changed on disk since it was opened.
- Each visited project retains its tabs, buffers and editor position while the application is open. Closing a dirty tab prompts for confirmation. Session drafts are held in memory.
- Create files and directories in the current folder. The menu beside each entry accepts a new project-relative path to rename or move it to an existing directory. Existing destinations are protected.
- Ctrl/Cmd+P searches file paths; Ctrl/Cmd+Shift+F searches saved UTF-8 text. Submit a query to search. Searches skip symlinks, Git metadata, and generated dependency/build directories. Results indicate when a search limit was reached.
- Replacement previews show individual lines and use the open buffer where available. Accepting a preview stages edits in tabs; Ctrl+S saves the reviewed changes using the normal conflict checks.
- Select a configured project server to start or stop it and open its running loopback URL. PHP servers provide a docked log with links to recognized project-local PHP error locations.
- A bundled PHP parser supplies syntax markers, document symbols and local symbol suggestions without executing the file. Definition and reference lookup match ordinary named function calls in analyzed open models within the same project and namespace. Imports and PHP method dispatch require a full language server.

**Saving:** Writes go to a temporary file in the target directory, are synced to disk, and then replace the existing file via the operating system rename operation. The original is left in place if writing fails. Important files should still be version controlled or backed up; filesystem semantics and external concurrent edits can vary.

To run the desktop application from source:

- Install Rust, Node.js, and Tauri's OS-specific native prerequisites.
- Run npm install, then npm run tauri dev.
- To produce a native package, use npm run tauri build after tests pass.


## Language assistance

| Files | Live checks and suggestions |
| --- | --- |
| HTML, CSS, SCSS, LESS | HTML grammar checks and web-language completions; CSS-family validation and property/value suggestions. |
| JS, JSX, TS, TSX | Monaco JavaScript/TypeScript services. JSX is enabled and tag/attribute colors apply in JSX/TSX files. TypeScript includes type diagnostics; JavaScript uses syntax diagnostics. |
| PHP, PHTML | Local syntax diagnostics, symbols, snippets and file-aware function navigation as described above. |
| JSON | Strict JSON syntax checks, Monaco completions and object/array snippets. |
| Python, Rust | Grammar diagnostics and language snippets. External interpreter/compiler and project-level type checks are separate. |
| XML, SVG, XHTML | XML well-formedness checks and markup snippets. |
| YAML | Multi-document YAML parsing and mapping/list snippets. |
| SQL | Advisory syntax checks against SQLite and MariaDB parser grammars and SQL snippets. Database schemas are not consulted. |
| Markdown, INI | Structural hints for open code fences or malformed INI sections/quoted settings, plus snippets. |

Use **Problems** beneath the active editor to jump to a reported line and column. Press Ctrl+Space for suggestions. Supplementary parsers load locally on demand. Their checks start after a 350 ms editing pause, coalesce pending versions and discard stale results. Above 524,288 UTF-16 code units a file opens in plain-text mode; the existing 4 MiB file-opening limit still applies.

Run `npm run test:languages` with Node 22.6+ to check extension aliases and positive/negative parser fixtures.
