import assert from "node:assert/strict";
import { fileLanguage } from "../src/languages/files.ts";
import { checkSyntax } from "../src/languages/checks.ts";

const cases = [
  ["html", "<main><br></main>", "<main x=>"],
  ["xml", "<r><a id='1'/></r>", "<r><a></r>"],
  ["yaml", "---\nkey: [1, 2]\n---\nother: ok", "key: [1,"],
  ["python", "def ok(x):\n    return x + 1", "def bad(:"],
  ["rust", "fn main() { println!(\"ok\"); }", "fn main( {"],
  ["sql", "SELECT * FROM items WHERE id = 1;", "SELECT * FROM ;"],
  ["markdown", "~~~js\nlet x\n~~~", "~~~js\nlet x"],
  ["ini", "[PHP]\nmemory_limit = 128M", "[PHP"],
];
for (const [id, valid, invalid] of cases) {
  assert.deepEqual(await checkSyntax(id, valid), [], id + " valid input");
  assert.ok((await checkSyntax(id, invalid)).length, id + " invalid input");
}
assert.deepEqual(await checkSyntax("ini", 'key = "multi\n[not a section\nline"'), []);
for (const [ext, id] of Object.entries({
  htm: "html", PHTML: "php", less: "less", mjs: "javascript", cts: "typescript",
  TSX: "typescript", JSX: "javascript", yml: "yaml", svg: "xml", pyi: "python", ini: "ini",
  constructor: "plaintext", unknown: "plaintext",
})) assert.equal(fileLanguage("project.dir/file." + ext), id, ext);
assert.equal(fileLanguage("path.rs/README"), "plaintext");
assert.equal(fileLanguage("README"), "plaintext");
console.log("Editor language detection and paired parser fixtures passed.");
