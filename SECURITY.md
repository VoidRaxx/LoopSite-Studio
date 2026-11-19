# Security Policy

LoopSite Studio is currently an **experimental alpha project**. It manages local development servers, PHP runtimes, files, and databases. Security reports are appreciated, but this software should not yet be relied upon for production or internet-exposed workloads.

## Supported versions

| Version or channel | Security maintenance |
| --- | --- |
| Latest published stable release, if one exists | Best-effort fixes |
| Latest published experimental prerelease | Best-effort fixes; breaking changes possible |
| Older versions and historical CI artifacts | Not supported |

There may be **no published release yet**. Support status is not a guarantee of a response deadline or a security patch.

## Reporting a vulnerability

**Do not disclose exploitable details in a public issue, pull request, or discussion.**

1. If the repository offers GitHub private vulnerability reporting, use **[Report a vulnerability](https://github.com/VoidRaxx/LoopSite-Studio/security/advisories/new)**.
2. If private vulnerability reporting is unavailable, contact the maintainer through an available private channel. Do not send exploits or credentials through public GitHub comments.
3. If no private contact route is available, you may request a private reporting channel in a public issue **without disclosing the vulnerability or reproduction details**.

When reporting privately, include:

- A concise description of the issue and potential impact.
- Affected LoopSite Studio version, operating system, and relevant configuration.
- Reproduction steps or proof of concept, avoiding real user data.
- Any mitigations already identified.

The maintainer will review reports when available and coordinate remediation and disclosure as appropriate. **No fixed response or resolution time is promised.**

## Handling sensitive information

Never attach API keys, passwords, private signing keys, session tokens, full production database exports, or unredacted logs to public reports. For local server issues, reproduce against a disposable test project whenever possible.

## Updates and mitigations

Use only builds and updates from the official project repository. A signed in-app updater, when available, verifies update signatures. Experimental/portable builds may require manual installation, and unsigned downloads should not be treated as trusted production releases.

If you discover a critical vulnerability, stop exposing the affected service and keep it bound to localhost until the issue is resolved.

For everyday bug reports, use the public GitHub issue templates instead.
