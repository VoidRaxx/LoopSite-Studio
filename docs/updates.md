# Signed automatic updates (Tauri 2)

LoopSite Studio checks for published, stable updates on **every application start**, without blocking project loading.

## UX

When a new GitHub Release with a higher semantic version exists, LoopSite opens a modal **before** any installation:

- Version, date, changenotes and update category
- **Update** — download and install the selected **signed** package, then restart
- **Later** — close for this session; show again on next launch
- **Skip Update** — ignore this exact version; a newer release will be offered normally

The manual **Jetzt nach Updates suchen** button is in Einstellungen. If there is no published release yet, the checker remains quiet on startup. Startup checks are disabled in the Vite development environment.

A security update must be **explicitly marked** in the GitHub release description:

\`\`\`markdown
<!-- loopsite-update:security -->

## Security
- Fixed ...
\`\`\`

Other releases (including those without the marker) are **Feature-Updates**. Security updates have a prominent warning but are not force-installed. The user always keeps the requested three choices.

The UI displays GitHub release notes as **plain text**, not unsafe HTML. Installation is blocked if the editor contains unsaved changes. Running local servers are warned about before an update restarts the app.

## Current state

**Important:** Experimental GitHub Actions artifacts are **not** signed releases. They can search for updates and show notes, but the action is labeled **Update herunterladen** and opens the project's official GitHub Release page for manual download. There is no unsafe direct self-installation of unsigned files.

In-app installation is enabled **only** for builds created by the signed release workflow, which:
1. Embeds the trusted updater public key in Tauri's configuration.
2. Enables the updater plugin only in the signed build.
3. Produces signed NSIS Windows and Linux AppImage updater assets.
4. Creates \`latest.json\` with exact URLs and the generated signature contents.
5. Uploads the assets to a draft GitHub Release, then publishes it.
6. Downloads and verifies signatures on the client before installation.

Only **Windows x86_64 (NSIS)** and **Linux x86_64 (AppImage)** are supported by the signed release workflow at this point. Distribution builds installed through a package manager, such as \`.deb\`, may require updating through the same package manager instead.

## One-time maintainer setup (required before the first self-installing release)

Generate the keys **locally** in a secure environment, for example:

\`\`\`bash
npm install
npm run tauri signer generate -- -w "$HOME/.tauri/loopsite-studio.key"
\`\`\`

Keep the private \`.key\` file and its password securely backed up. **Never commit or share the private key.** The companion \`.key.pub\` is public.

In the GitHub repository's **Settings → Secrets and variables → Actions**, create:

- \`TAURI_SIGNING_PRIVATE_KEY\`: contents of the private key
- \`TAURI_SIGNING_PRIVATE_KEY_PASSWORD\`: its password, if set
- \`LOOPSITE_UPDATER_PUBLIC_KEY\`: entire \`.key.pub\` text, including the comment line

The signing key is critical. If lost, future releases cannot update already-installed signed versions through that key.

## Publishing a new version

1. Update the app version consistently in \`package.json\`, \`src-tauri/Cargo.toml\` and \`src-tauri/tauri.conf.json\`.
2. Optionally add \`release-notes/vX.Y.Z.md\` with the changenotes and security marker if applicable. Otherwise GitHub auto-generates notes.
3. Push a Git tag \`vX.Y.Z\` pointing at the version commit. The \`Signed desktop release\` GitHub workflow only runs for such tags.
4. CI verifies the tag matches the app version and that signing secrets are present. Missing secrets block release creation.
5. After both platforms build and sign successfully, CI publishes a GitHub Release containing the signed binaries, \`.sig\` files and \`latest.json\`.
6. Newer signed versions will be offered at the next launch.

**Do not publish an unsigned release with a higher version through the official release channel.** The UI could discover it, but Tauri's signed updater would reject installation.

## Security boundaries

- No automatic installation without displaying notes and a user choice.
- The frontend checks only the official GitHub repository's latest stable release.
- The native updater accepts only HTTPS endpoint metadata, a trusted embedded public key and valid signed bundles.
- Build-time private keys are supplied by GitHub Actions secrets, never stored in application binaries or Git.
- No automatic retries of a failed installation.
- Only the chosen version is installed; a mismatch between displayed release and signed updater version aborts the operation.

This is an early alpha implementation. Real signed release smoke tests on Windows and Linux are required before declaring the update system production-ready.
