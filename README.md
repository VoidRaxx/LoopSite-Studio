# LoopSite Studio

<img src="./public/loopsite-logo.png" alt="LoopSite Studio logo" width="110" />

A desktop-first local development environment for Windows and Linux.

## Disclaimer

**This project is currently 100% vibe-coded.**

Due to limited time and other priorities, this project has been developed entirely with the assistance of AI. As a result, some parts of the code may not follow best practices, and bugs, unexpected behavior, or performance issues may occur.

In the future, I plan to gradually review, refactor, and improve the codebase to reduce its reliance on AI-generated code and ensure better code quality, security, stability, and maintainability.

**Found a bug or an issue?**

For bugs and feature suggestions, please [open an issue](https://github.com/VoidRaxx/LoopSite-Studio/issues/new/choose) or submit a pull request. **Do not report security vulnerabilities in public issues; follow the [Security Policy](SECURITY.md) instead.**

Your feedback and contributions are greatly appreciated!

**Please keep in mind:** This is a work in progress, and improvements will be made as time allows.

## Status

Early development. **No stable production release yet.** CI validates development builds without publishing installers. Official experimental builds will be GitHub prereleases, only after review and explicit approval.

### Implemented (experimental)

- Desktop project management with separate server and domain configurations
- PHP and static-site start/stop, status, color-coded searchable live logs (copy/clear), loopback by default, optional LAN binding
- Local HTTP domain routing through an externally installed Caddy executable
- Offline Monaco file editor: browsing, multiple tabs, side-by-side code panes, resizable file tree, syntax highlighting, search, replace and guarded saves
- Default / Universe / Dark / White and additional unified themes (12 options including system default)
- Native SQLite database manager: create project databases and tables, preview/insert rows, and import/export consistent `.sqlite3` files
- Opt-in runtime setup for PHP and Caddy using OS package managers (experimental)
- Connect to existing local MariaDB/MySQL servers, create databases and preview tables (experimental)

### Not implemented yet

- Managed PHP/Caddy runtime installation and version switching
- Automatic MariaDB installation and service management, phpMyAdmin integration; additional SQLite import/export and advanced SQL tooling
- Automatic local HTTPS certificate and arbitrary hostname resolution setup
- Reliable packaged releases verified by installer and runtime smoke tests

For details, see `docs/editor.md`, `docs/local-routing.md` and `docs/architecture.md`.

## Key concept

One **project** contains any number of **servers** and **domain routes**.

- A server has its own document root, runtime, port, router file, and optional LAN access.
- A domain route maps a local hostname or subdomain to a server in the same project.
- Multiple hostnames can route to the same server.
- Different projects can each have independent hostnames, servers, databases and runtime settings.
- Ports and hostnames must not collide globally for simultaneously active projects.

### Example

```
HybrideUniverse (Project)
  Servers
    Web       PHP    127.0.0.1:8000
    Shared    PHP    127.0.0.1:8001   router.php
  Domains
    hybrideuniverse.localhost            -> Web
    shared.hybrideuniverse.localhost     -> Shared
    api.hybrideuniverse.localhost        -> Shared

Test Website (Project)
  Servers
    Web       PHP    127.0.0.1:8010
  Domains
    testwebsite.localhost                -> Web
    api.testwebsite.localhost            -> Web
```

## Planned features

- Native desktop window with easy-first project workflow (Tauri 2 + React/TypeScript)
- Text editor, syntax highlighting, tabs, search/replace and lightweight completion
- PHP, static HTML/CSS/JS and additional runtime support
- Local domains/subdomains, HTTPS, reverse proxy and optional LAN exposure
- Optional editable PHP router
- PHP runtime manager and MariaDB / SQLite database management
- Optional phpMyAdmin, opened separately in a browser
- Consistent, extensible themes with English-first localization and configurable UI density

## Principles

Local-only by default; no implicit router port forwarding or Internet exposure. Runtime downloads must be verified. Never automatically upgrade a running project's PHP or database major version.

Licensed under the MIT license (see LICENSE).

## Contributing and community

- [How to contribute](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Accessibility Statement](ACCESSIBILITY.md)
- [Bug reports and feature requests](https://github.com/VoidRaxx/LoopSite-Studio/issues/new/choose)
- [Pull requests](https://github.com/VoidRaxx/LoopSite-Studio/pulls)

## Distributions and Releases

The regular CI workflow does **not** publish downloadable installers. All releases require an approved English changelog and manual publication, including experimental GitHub prereleases. Windows NSIS and portable ZIP, Linux DEB/RPM/Arch-native packages and Linux portable AppImage are the target formats. See [Release policy](docs/release-policy.md) for package details, approval gates, and portable data storage.

- Database deletion/archival, table creation and guarded row/cell editing; three UI sizes and six themes (experimental). See `docs/database-ui-and-themes.md`.

- Shared theme system with 12 OS-aware and custom palettes; consistent colors across all panels. See `docs/themes-and-appearance.md`.

- Automatic launch-time update checks with changenotes, security/feature categories, Update/Later/Skip options and signed Tauri release support. See [Update setup](docs/updates.md).
