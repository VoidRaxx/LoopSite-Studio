# PHP runtime manager (experimental)

LoopSite Studio can discover existing PHP CLI executables and assign different
installed PHP versions to individual project servers.

## Implemented

- On Windows: search absolute entries in PATH, C:\php\php.exe, and C:\xampp\php\php.exe.
- On Linux: search absolute PATH entries for php and php7.x / php8.x / php9.x.
- Validate selected PHP binaries by running php -v without invoking a command shell.
- Time out version probing after five seconds, reject invalid executables, and
  show installed stable versions in descending version order.
- Add a previously installed PHP CLI executable through the OS file picker.
- Save manually registered PHP paths in the application config directory.
- New servers default to the highest detected stable version available when created.
- Existing servers may be changed using their Settings button **while stopped**.
- A server can explicitly select an installed PHP executable. The choice is
  persisted and reused after restarting LoopSite Studio.
- A user can opt into Automatic mode to use the highest version discovered
  when the server starts. In Automatic mode, adding a newer installation can
  change that server's version. Explicit selections are not changed automatically.
- Existing projects created before the PHP version field was added continue to
  use Automatic mode; their JSON configurations remain compatible.

## Not implemented

Automatic downloads, installers, checksum/signature verification of downloaded
PHP binaries, and Linux distribution package-manager integration are not yet
available. Users must install PHP independently before selecting it.

## Testing

Rust unit tests cover version parsing, accepted binary names, legacy config
migration and PHP version binding. Windows and Linux builds run in GitHub Actions.
Actual PHP process runtime and package-installation testing should be performed on
supported target operating systems before a stable release.

## Security

Executable paths are required to be absolute and to match PHP CLI executable
names. LoopSite executes only the user-selected or discovered binary and never
passes the path to a shell. Manually registering PHP code is a trusted local
administrative action: do not select an untrusted executable.
