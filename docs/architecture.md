# Architecture — LoopSite Studio

## Domain model

A Project contains Servers and DomainRoutes.

- **Project**: identifier, name, workspace root, servers and routes.
- **Server**: a runtime/process configuration with its own document root, port, optional router and LAN setting.
- **DomainRoute**: a hostname pointing to an existing Server in the same Project. Multiple routes may target one Server.
- **Database** (planned): its own lifecycle and optional association with one or more Projects.
- **Runtime** (planned): globally installed immutable version, selected per Server.

### Invariants

- Server ports are unique across all configured projects.
- Domain hostnames are globally unique (case-insensitive, normalized lowercase).
- DomainRoute.serverId always points to a Server within the same Project.
- Removing a server with routes is blocked until the routes are removed/reassigned.
- None of the create/edit operations currently starts or exposes a server.
- The app binds no LAN ports or edits system DNS/hosts in milestone 1.
- External execution requires its own backend API and explicit user action.

### Planned router pipeline

1. Validate route hostname and destination.
2. Ensure no conflicts with global hostnames or active port bindings.
3. Resolve hostname on the local machine (loopback only by default).
4. Terminate local TLS at reverse proxy.
5. Proxy HTTP/WebSocket requests to the configured service and preserve forwarding metadata correctly.
6. Provide clear diagnostics for backend failures; local HTTPS certificate trust is a separate explicit operation.
7. Optional LAN access uses IP and port, not custom local hostnames, and needs explicit firewall guidance.

### Security boundaries

The WebView is not permitted arbitrary shell commands or unrestricted file system access. Native Tauri commands validate state. Project paths are only used as metadata in milestone 1. Runtime installation and server execution require restricted and audited future commands. Updates must have integrity verification.

## Current status

Milestone 1: repository foundation, native desktop shell, project/server/domain configuration forms, validation and persistence, light/dark/HU UI. Server launches, routing, editor and databases are *not implemented yet*; the UI must not claim otherwise.

## Build

Install Node.js, Rust, and Tauri OS build prerequisites for the selected target OS.

\`\`\`sh
npm install
npm run tauri dev
\`\`\`

To generate installers later:

\`\`\`sh
npm run tauri build
\`\`\`

No official release artifacts have been produced or tested yet.
