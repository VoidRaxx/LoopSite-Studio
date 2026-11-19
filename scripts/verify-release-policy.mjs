// Release guardrail: CI must not publish binaries; releases require manual approval.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = path => readFileSync(path,"utf8");
const ci = read(".github/workflows/desktop-build.yml");
const release = read(".github/workflows/release.yml");
const portable = JSON.parse(read("src-tauri/tauri.portable.conf.json"));
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const pkg = read("packaging/arch/PKGBUILD");
const app = read("src/App.tsx");

assert.equal(portable.app.appDirectoriesOverride,"./portable-data","Portable paths must be isolated");
assert.equal(portable.bundle?.createUpdaterArtifacts,false,"Portable builds must not require signing secrets or self-install updates");
assert.ok(!/actions\/upload-artifact@/.test(ci),"CI must not upload downloadable installers");
assert.match(release,/workflow_dispatch:/,"Release workflow must require manual dispatch");
assert.ok(!/^\s+push:\s*$/m.test(release),"Release must not auto-publish on push");
assert.match(release,/APPROVE LOOPSITE RELEASE/,"Release requires explicit approval");
assert.match(release,/release-approval/,"Approval environment is required");
assert.match(release,/release-notes\/\$RELEASE_TAG\.md/,"English changelog is mandatory");
assert.match(release,/--prerelease/,"Experimental tags must publish as GitHub prereleases");
for (const format of ["*-setup.exe","*Windows-Portable.zip","*.deb","*.rpm","*.pkg.tar.zst","*.AppImage.sig","*Linux-Portable.zip"])
  assert.ok(release.includes(format),"Missing release format: "+format);
assert.match(pkg,/webkit2gtk-4\.1/,"Arch package must declare desktop runtime dependency");
assert.equal(config.bundle.windows.nsis.displayLanguageSelector,true,"Windows language selector expected");
assert.match(app,/sidebar-version/,"Application version must appear in sidebar");
assert.match(app,/installedExperimental=\{experimentalBuild\}/,"Experimental update channel must be forced for experimental builds");
console.log("Release-policy guardrails passed.");
