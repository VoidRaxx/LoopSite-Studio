# Signed updates and releases (Tauri 2)

LoopSite Studio checks the official GitHub Releases API on application startup without blocking project loading. It shows the full English changelog before asking the user to choose **Update**, **Later**, or **Skip Update**. Installation always requires an explicit choice; nothing is installed silently.

## Update channels

- **Stable** releases use tags such as `v1.0.0` and are not marked as prereleases.
- **Experimental** releases use tags such as `v0.2.0-experimental.1` and are official GitHub *prereleases*.
- Stable installations **ignore experimental releases by default**. Settings can enable experimental release discovery.
- Experimental installations always check for newer experimental releases; their experimental-update toggle is enabled and disabled.
- Feature releases use the `<!-- loopsite-update:feature -->` marker. Only a deliberate `<!-- loopsite-update:security -->` marker categorizes a security update.

## Update installation security

Tauri requires signed updater bundles and a matching embedded public key. Signing cannot be turned off for self-installation. Private signing keys are never committed to the repository. Only approved release jobs use those secrets. See [Tauri's official updater documentation](https://v2.tauri.app/plugin/updater/).

- Signed Windows NSIS installations support in-app updates after confirmation.
- Signed Linux AppImage installations can support in-app updates.
- Portable builds and Linux `.deb`, `.rpm`, and Arch `.pkg.tar.zst` installations do not self-install updates: they open the official release page and use manual/package-manager installation.
- In-app update installation is blocked when there are unsaved editor changes. Running local servers produce a warning before restarting.

The manifest file `latest.json` is generated from the *exact signed bundles* and their `.sig` files, with platform-specific download URLs.

## One-time signing setup

Generate an Ed25519/minisign key pair with the Tauri CLI:

```bash
mkdir -p ~/.tauri
npx --yes @tauri-apps/cli@2 signer generate --write-keys "$HOME/.tauri/loopsite-studio.key"
```

Back up `loopsite-studio.key` and its password securely. Do **not** publish or paste the private key into issues or conversations. The `.pub` file may be shared.

Add these **repository** secrets under GitHub **Settings → Secrets and variables → Actions**:

| Secret | Meaning |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Full private key contents |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Private key encryption password (if set) |
| `LOOPSITE_UPDATER_PUBLIC_KEY` | Full `.key.pub` text |

The release build uses the public key for verification and the private key for signing. The workflow refuses to sign with missing secrets.

## Approving and publishing a release

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Add and review `release-notes/vX.Y.Z[-experimental.N].md`, with the categories `Added`, `Changed`, `Fixed`, `Security`, and `Known Issues`.
3. Obtain explicit maintainer approval of this exact version and English changelog.
4. Make sure that the normal **Desktop build checks** and **Arch Linux package validation** workflows pass on `main`. These checks do *not* publish downloadable installers.
5. Open **GitHub → Actions → Approved official release → Run workflow**. Select branch `main`, enter the approved version tag, and enter `APPROVE LOOPSITE RELEASE` in the approval field.
6. The workflow verifies that the version/changelog are on the approved commit, builds both Windows variants, DEB/RPM, portable AppImage, and the Arch package and verifies signed NSIS/AppImage assets. Only after all package checks pass does it create the matching Git tag and publish the release.
7. If any job fails, **nothing is publicly released**. If all jobs succeed, the release is published as a stable GitHub release or an experimental prerelease with the approved changelog.

To add an extra approval step, configure the GitHub Actions `release-approval` environment with required reviewers. Without environment protection, **the explicit manual dispatch and approval input are the only human safeguards**.

## Limitations

Package compilation checks are not a substitute for GUI and installation smoke testing on actual operating systems. Experimental releases are for evaluation only. No claim of full production readiness or accessibility compliance is made.

The code and release policy are detailed in [Release policy](release-policy.md).
