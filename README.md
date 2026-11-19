# LoopSite Studio

A desktop-first local development environment for Windows and Linux.

## Status

Early development. **Not yet a downloadable or production-ready application.** The project model and architecture are being implemented before server/runtime management.

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
- Theme choices: HybrideUniverse (default), Dark, White, customizable through theme configuration

## Principles

Local-only by default; no implicit router port forwarding or Internet exposure. Runtime downloads must be verified. Never automatically upgrade a running project's PHP or database major version.

MIT license is planned; licensing will be added as a separate tracked file.
