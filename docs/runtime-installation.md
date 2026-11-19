# PHP and Caddy runtime installation (experimental)

LoopSite Studio offers an **Einrichtung** view to detect existing runtimes and, with explicit confirmation, install missing PHP or Caddy components.

## Supported installation plans

| OS | PHP | Caddy | Mechanism |
| --- | --- | --- | --- |
| Windows | Winget package PHP.PHP.8.5 | Winget package CaddyServer.Caddy | Installs using winget.exe |
| Arch-based Linux | php | caddy | pkexec + pacman |
| Debian/Ubuntu Linux | php-cli | caddy | pkexec + apt-get |
| Fedora Linux | php-cli | caddy | pkexec + dnf |
| macOS | Not yet supported | Not yet supported | No changes |

*Package availability and versions depend on the configured system repositories.* Linux packages may not provide the newest upstream PHP release. Linux Caddy packages may require prior repository setup. No repositories are automatically added.

## Installation flow

1. Open **Einrichtung** in the desktop sidebar.
2. Review runtime status and the **exact** installation command.
3. Click **Jetzt installieren** and confirm the system modification.
4. Windows winget or Linux's Polkit authorization window may request system approval.
5. The package manager executes with a fixed allowlist of arguments; no shell scripts, interpolated user input or arbitrary downloads are executed.
6. Logs are saved to LoopSite's application log directory.
7. LoopSite rechecks whether the installed runtime can be located, and suggests restart if the process PATH is stale.

The assistant never touches project data or existing database instances; it does not automatically upgrade already recognized components. The PHP package selection is **PHP 8.5 latest patch** on Windows, not an arbitrary upstream snapshot. Runtime selection per project is still handled in the existing PHP manager.

## Limitations and testing

- Installations affect the host operating system rather than being sandboxed in a project. Administrative privileges may be necessary.
- LoopSite does not issue service start/stop commands during installation. **Some distribution packages (notably Caddy from Debian/Ubuntu) automatically start a systemd service as an installation side effect.** This can occupy ports such as 80/443; review installed services and firewall configuration as needed. LoopSite's local proxy still runs separately.
- Cannot reliably prevent all package-manager side effects, such as installing dependencies. Confirm the plan before proceeding.
- Automatically downloading isolated per-project runtime archives, version switching, PHP extension provisioning and MariaDB installation are not implemented yet.
- The installer is not currently integrated into native installer onboarding. It is a dedicated desktop view.
- Some graphical Linux environments do not have pkexec/polkit installed. In this case the UI explains manual installation is required.
- Real Windows and Linux package-manager integration tests require disposable test machines. CI validates compilation and pure argument-validation unit tests only.

## Security

Allowed components: \`php\` and \`caddy\`. No user-controlled package names or shell commands are accepted in the native install command. System command paths are resolved to absolute paths. Execution is serialized to prevent duplicate installs, and bounded by a 10-minute timeout.
