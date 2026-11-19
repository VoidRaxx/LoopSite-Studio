# Release policy — LoopSite Studio

**No releases without the owner's explicit approval.** Applies equally to experimental/prerelease and stable builds.

## Channels

- **Experimental:** official GitHub **Prerelease**, SemVer tags `vX.Y.Z-experimental.N`; can receive later experimental releases. The "Include experimental updates" switch is **on and disabled** in these builds.
- **Stable:** official GitHub Release, SemVer tags `vX.Y.Z`; experimental releases **ignored by default**, with an opt-in switch in Settings. A user can opt into experimental updates without changing source files.
- All release descriptions and changelogs are written in **English**.

Before publishing any version, the maintainer must see and approve: version, channel, complete release changelog, platform package list, automated test evidence and known issues.

## Available distribution formats and user workflows

| Platform | Installer | Truly portable |
| --- | --- | --- |
| Windows | A multilingual NSIS Setup.exe (existing LS icon and custom app name) | ZIP with a directly executable .exe and `portable-data/` beside it |
| Debian/Ubuntu | .deb (GNOME Software/Discover or `sudo apt install ./file.deb`) | Linux AppImage ZIP |
| Fedora/openSUSE | .rpm (Software/Discover or `sudo dnf install ./file.rpm`) | Same AppImage ZIP |
| Arch/CachyOS/Garuda | native .pkg.tar.zst (`sudo pacman -U ./file.pkg.tar.zst`) | Same AppImage ZIP |

Linux installers are deliberately **not one universal package**. Native packages preserve distribution integration and dependency resolution. Linux Portable is an AppImage that runs from a writable directory; it may still require system libraries (such as FUSE compatibility depending on AppImage runtime). All packages are x86_64 initially.

## Portable storage

The Tauri portable flavor is built with `src-tauri/tauri.portable.conf.json`, overriding application config, local data, cache, logs and WebView storage into a **dedicated `portable-data/` folder beside the executable/AppImage**. Move this folder together with the executable to retain settings and project metadata.

The Portable build does not install itself, register a system service, or add file associations. Projects located outside the portable folder are **external data**; moving the app does not automatically copy/migrate them. For completely self-contained work, create projects inside your portable folder.

Portable installers are treated as manually updated, so a signed NSIS installer cannot accidentally replace a portable executable. All application flavors still check release notes at startup.

## Languages

English is the default language for new installations. The Windows NSIS installer provides a language selector (English, German, French, Spanish, Portuguese, Italian, Japanese and Simplified Chinese). Linux package installers normally use the OS/software-center locale, rather than a custom installer wizard; the application offers its own language preference.

Localization of the entire existing UI is an incremental project. Do not label the app as fully localized until every screen has been migrated and checked.

## Release procedure

1. Complete all four primary forms (**Windows Setup**, **Windows Portable**, **Linux native installers** and **Linux Portable**), with the Arch package checked separately. Test both GUI launching and command-line use where supported.
2. Prepare the matching version in `package.json`, `Cargo.toml`, `tauri.conf.json`.
3. Add `release-notes/vX.Y.Z[-experimental.N].md` in **English** using the template below.
4. Review the complete changelog with the owner and obtain explicit approval.
5. In **GitHub → Actions → Approved official release → Run workflow**, select **main**, enter the approved version tag (for example `v0.2.0-experimental.1`) and type the exact approval phrase `APPROVE LOOPSITE RELEASE`.
6. The workflow verifies the version and changelog on the approved main commit, **creates the corresponding Git tag automatically**, then builds, checks, signs, and publishes only after every platform succeeds. Ordinary commits and tag pushes do not trigger publication.
7. For an additional mandatory human gate, configure the GitHub Actions `release-approval` environment with **Required reviewers**. Without configuring that environment protection in GitHub, manual workflow dispatch and its confirmation are the only gates.
8. The workflow builds and checks Windows, Ubuntu/Fedora-compatible packages and Arch. If any requested format fails, nothing is published.
9. Signed releases additionally require secure GitHub secrets for the Tauri updater. Do not publish unsigned installers claiming signed auto-update support.

## Changelog template (mandatory English)

```markdown
<!-- loopsite-update:feature -->

## Added
- ...

## Changed
- ...

## Fixed
- ...

## Security
- None.

## Known Issues
- ...
```

Use `<!-- loopsite-update:security -->` only for genuinely security-focused releases. Never silently upgrade or publish a release without the owner's go-ahead.

## Legacy experimental CI artifacts

Old GitHub Actions artifact ZIPs are **not official Releases**. The normal CI workflow no longer uploads installers. Existing artifacts remain on GitHub until deleted by an authorized GitHub account or until their retention period expires. Deleting them does not remove commits, source code or test records.
