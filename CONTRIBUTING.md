# Contributing to LoopSite Studio

Thanks for helping improve LoopSite Studio. The project is an **experimental, cross-platform desktop development environment** built with **Tauri 2, Rust, React, and TypeScript**.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md) before contributing.

## Before starting

Check existing issues and pull requests to avoid duplicate work. For substantial features, UI redesigns, compatibility changes, or changes to the release process, open an issue to discuss the proposal **before** implementing it.

Contributions should be narrowly scoped. Do not change unrelated features, themes, infrastructure, or release versions without a clear reason and prior agreement.

## Local development

**Requirements:** Node.js, npm, Rust/Cargo, Tauri 2 system dependencies for your operating system, and optional external tools (PHP, Caddy, MariaDB) for relevant integration tests.

```bash
git clone https://github.com/VoidRaxx/LoopSite-Studio.git
cd LoopSite-Studio
npm install
npm run tauri dev
```

Frontend production build:

```bash
npm run build
```

Rust tests:

```bash
cd src-tauri
cargo test
```

When changing themes or release logic, run the project-specific validation scripts:

```bash
python scripts/verify-themes.py
node scripts/verify-release-policy.mjs
```

The Tauri application and optional database tools require operating-system dependencies. Refer to the existing documentation under [docs/](docs/) and the GitHub Actions workflows for the current build setup. Windows and Linux require separate verification.

## Contribution guidelines

- Write documentation, GitHub issues, pull requests, and changelogs in **English**.
- Follow existing Rust, React, TypeScript, and project conventions.
- Make code readable, maintainable, and appropriately validated; avoid unnecessary dependencies.
- Never commit secrets, credentials, signing keys, personal paths, local databases, or project data.
- Preserve the local-first security model. Do not expose services to the network unless explicitly configured.
- Validate file paths and database operations, especially destructive actions.
- Add or update tests and documentation for behavior changes.
- Do not claim that code has been tested on a platform you did not actually test.
- Respect the LoopSite Studio branding and use the existing LS logo; never replace it with another project's identity.
- Declare AI-assisted contributions when relevant and review generated code for correctness and security.

## Pull requests

1. Create a focused branch from `main`.
2. Make the change with clear commits.
3. Run the relevant tests and verify the UI if it changed.
4. Open a pull request using the repository's template, linking any related issue.
5. Explain scope, behavioral changes, risks, and test results. Screenshots are useful for visible UI changes.
6. Address review feedback; maintainers may request changes or decline proposals that do not match the roadmap.

**Please do not publish releases or upload unsigned installers from a pull request.** All stable and experimental releases require an English changelog, successful platform checks, and explicit maintainer approval; see [Release Policy](docs/release-policy.md).

## Bugs and security issues

For ordinary bugs, use the GitHub **Bug Report** template and provide reproduction steps, OS, version, and sanitized logs. Remove passwords, tokens, private project paths, database content, and other sensitive data.

For vulnerabilities, **do not open a public issue**. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is distributed under the repository's [MIT License](LICENSE).
