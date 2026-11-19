# Local domain routing (experimental)

LoopSite Studio uses Caddy as a reverse proxy. This milestone adds HTTP-only routing of configured domain names to PHP/static project servers.

## Usage

1. Install Caddy on Windows or Linux and ensure the `caddy` executable is in PATH.
2. Create a Project, add a Server, and add one or more Domain routes (e.g. `app.demo.localhost` and `api.demo.localhost`).
3. Start the destination Server(s) from the Project view.
4. Open the **Routing** tab, choose a proxy port (default **8080**), and start the reverse proxy.
5. Open `http://app.demo.localhost:8080/` from a browser whose local resolver supports `.localhost` names.

A single server can have multiple domain names. Across projects, ports and domain names must remain unique. The proxy is local-only; it binds to `127.0.0.1`, never `0.0.0.0`.

### Custom domain caveats

Arbitrary names such as `app.example.test` also require local OS hosts-file or DNS configuration. The proxy itself cannot change host-name resolution; the application currently does not make those system changes automatically.

### Ports 80 and 443

The default is port **8080**, because port 80 can require elevated privileges or conflict with another service. Port 80 may be configured by an advanced user and then `http://app.demo.localhost/` needs no port suffix. This does **not** enable HTTPS.

### Routing behavior

- Caddy routes by HTTP Host header and forwards to `127.0.0.1:<server-port>`.
- Unknown hostnames receive HTTP 404.
- A stopped/unavailable backend typically returns HTTP 502.
- Existing WebSockets and standard reverse-proxy forwarding are handled by Caddy.
- Caddy's admin API is disabled.
- Changes to project domains require stopping and starting the proxy to generate a new config.
- PHP/DB runtime installers, local TLS certificates/HTTPS, optional LAN domains and automatic Caddy installation are **not implemented yet**.

### Safety

Do not expose sensitive projects via per-server LAN settings. Caddy only routes HTTP locally by default; it does not automatically expose your machine or configure router/firewall rules.
