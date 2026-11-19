#!/usr/bin/env node
// Configure signed Tauri updater only in the dedicated release workflow.
// Never print or store private signing keys in the source tree.
import { readFileSync, writeFileSync } from "node:fs";

const pubkey = process.env.LOOPSITE_UPDATER_PUBLIC_KEY?.trim();
const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
if (!pubkey || !privateKey) {
  console.error("Missing release signing secrets. Refusing to build an unsigned updater release.");
  process.exit(1);
}
if (!pubkey.startsWith("untrusted comment:") || !pubkey.includes("\nRW")) {
  console.error("LOOPSITE_UPDATER_PUBLIC_KEY must contain the complete minisign public key content.");
  process.exit(1);
}
const path = "src-tauri/tauri.conf.json";
const config = JSON.parse(readFileSync(path, "utf8"));
config.bundle ??= {};
config.bundle.createUpdaterArtifacts = true;
config.plugins ??= {};
config.plugins.updater = {
  pubkey,
  endpoints: [
    "https://github.com/VoidRaxx/LoopSite-Studio/releases/latest/download/latest.json"
  ],
  windows: { installMode: "passive" }
};
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
console.log("Signed updater release configuration ready (keys not printed).");
