#!/usr/bin/env node
// Assemble a Tauri v2 static update manifest from signed CI artifacts.
// Fail closed if any required platform binary/signature pair is missing.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const [folder, tag, notesFile] = process.argv.slice(2);
if (!folder || !/^v\d+\.\d+\.\d+(?:-experimental\.\d+)?$/.test(tag) || !notesFile) {
  console.error("Usage: node scripts/create-update-manifest.mjs <artifact-dir> <vX.Y.Z> <notes-file>");
  process.exit(1);
}
function recursiveFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? recursiveFiles(file) : [file];
  });
}
const files = recursiveFiles(folder);
const matches = pattern => files.filter(file => pattern.test(basename(file)));
const windows = matches(/\.exe$/i).filter(file => /setup/i.test(basename(file)));
const linux = matches(/\.AppImage$/i).filter(file => !/portable/i.test(basename(file)));
if (windows.length !== 1 || linux.length !== 1) {
  throw new Error("Expected exactly one Windows NSIS setup EXE and one Linux AppImage, received " +
    windows.length + " / " + linux.length);
}
function platform(binary) {
  const sigFile = binary + ".sig";
  if (!files.includes(sigFile)) throw new Error("Missing signature for " + basename(binary));
  const signature = readFileSync(sigFile, "utf8").trim();
  if (!signature) throw new Error("Empty update signature: " + sigFile);
  return {
    signature,
    url: "https://github.com/VoidRaxx/LoopSite-Studio/releases/download/" + tag + "/" + encodeURIComponent(basename(binary))
  };
}
const latest = {
  version: tag.slice(1),
  notes: readFileSync(notesFile, "utf8").slice(0, 16000),
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": platform(windows[0]),
    "linux-x86_64": platform(linux[0]),
  },
};
writeFileSync("latest.json", JSON.stringify(latest, null, 2) + "\n");
console.log("Created signed update manifest for " + tag + " (Windows x64, Linux x64).");
