// Prevent prerelease packaging with inconsistent version metadata or missing release notes.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const text = path => readFileSync(path, "utf8");
const packageVersion = JSON.parse(text("package.json")).version;
const tauriVersion = JSON.parse(text("src-tauri/tauri.conf.json")).version;
const rustVersion = text("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];

assert.equal(packageVersion, tauriVersion, "package.json and Tauri versions differ");
assert.equal(packageVersion, rustVersion, "Cargo and Tauri versions differ");
assert.match(packageVersion, /^\d+\.\d+\.\d+(?:-experimental\.\d+)?$/);

const changelog = text(`release-notes/v${packageVersion}.md`);
assert.ok(changelog.includes("## Added"), "Changelog needs an Added section");
assert.ok(changelog.includes("## Changed"), "Changelog needs a Changed section");
assert.ok(changelog.includes("## Fixed"), "Changelog needs a Fixed section");
assert.ok(changelog.includes("## Security"), "Changelog needs a Security section");
assert.ok(changelog.includes("## Known Issues"), "Changelog needs a Known Issues section");
assert.ok(!/\b(?:TODO|TBD|PLACEHOLDER)\b/i.test(changelog), "Changelog has unfinished sections");
if (packageVersion.includes("-experimental.")) {
  assert.match(changelog, /<!--\s*loopsite-update:(?:feature|security)\s*-->/i);
}
console.log("Release candidate version and changelog verified:", packageVersion);
