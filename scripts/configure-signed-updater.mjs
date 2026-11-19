#!/usr/bin/env node
// Configure signed Tauri updater only in the dedicated release workflow.
// Never print or store private signing keys in the source tree.
import { readFileSync, writeFileSync } from "node:fs";

const providedKey = process.env.LOOPSITE_UPDATER_PUBLIC_KEY?.trim();
const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
if (!providedKey || !privateKey) {
  console.error("Missing release signing secrets. Refusing to build an unsigned updater release.");
  process.exit(1);
}
// The Tauri CLI uses the minisign public-key format. Accept a complete text
// key or its base64-encoded representation; always embed the decoded text.
const pubkey = (providedKey.startsWith("untrusted comment:")
  ? providedKey
  : Buffer.from(providedKey, "base64").toString("utf8")
).replace(/\r\n/g, "\n").trim();
const keyLines = pubkey.split("\n");
const encodedKey = keyLines[1] ?? "";
if (keyLines.length !== 2 ||
    !keyLines[0].startsWith("untrusted comment:") ||
    !/^RW[A-Za-z0-9+/=]{54}$/.test(encodedKey) ||
    Buffer.from(encodedKey, "base64").length !== 42) {
  console.error("LOOPSITE_UPDATER_PUBLIC_KEY is not a complete valid-format minisign public key.");
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
