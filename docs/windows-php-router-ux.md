# Windows PHP router & desktop UX fixes

This patch addresses a runtime issue reported using PHP 8.4.12 on Windows:

\`\`\`
PHP Fatal error: Failed opening required '\\\\?\\C:\\...\\index.php'
\`\`\`

## Router path correction

Windows \`canonicalize()\` returns verbatim paths (\`\\\\?\\C:\\...\`). PHP's built-in router handling may fail to open a script passed via this prefix. LoopSite now validates the **canonical absolute router path** (including that it exists, ends in \`.php\`, and remains within the document root) but launches PHP using the **root-relative router path** with \`current_dir(document_root)\`. PHP's \`-t\` argument is converted to a normal Windows path without the verbatim prefix; UNC shares are handled separately.

This is not an automatic correction for an actually missing \`index.php\`: the user must still choose the correct web root and/or router file. A router must be an existing PHP file. For a site where PHP's built-in default index resolution suffices, leave the router field empty.

Windows integration testing now provisions PHP 8.4 and starts a real PHP development server with a router, then requests a page via HTTP and verifies the response. Additional tests cover Windows verbatim-path normalization, safe relative routing, missing files, and invalid extensions.

## Logs

The desktop log window is separate from project settings. It has:
- Timestamp display and severity highlighting (errors / warnings / HTTP / informational);
- Search and severity filters;
- Live refresh every 2 seconds, adjustable auto-scroll;
- Copy whole log and clear (with confirmation). Active log files are truncated in place, not unlinked while a process is still writing;
- Larger, resizable browser-window-friendly reading surface.

Backend log reads show up to the most recent 32 KiB, so a very large log does not freeze the desktop UI. Clearing a log is irreversible. A speculative TCP port check can produce \`Closed without sending a request\` in PHP's logs; it is not an application error.

## Editor / density

- Multiple files open as tabs (up to 24).
- Click the **⇄** icon beside a tab to open that file in a second code pane.
- Drag the vertical separator to resize the file tree, or focus it and use the left/right arrow keys.
- Compact project lists, cards, controls, headings and spacing throughout the app.
- The Monaco editor retains project-scoped file validation, safe saves, syntax highlighting and the existing unsaved-change warning.

## Limitations

The patch must still pass Windows/Linux CI and real Windows user testing. PHP CLI router behavior may differ by PHP build. Existing project data and the official LS logo are not modified.
