const extensions: Record<string, string> = {
  html: "html", htm: "html", php: "php", phtml: "php", css: "css", scss: "scss", less: "less",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  json: "json", md: "markdown", markdown: "markdown", xml: "xml", svg: "xml", xhtml: "xml",
  ini: "ini", sql: "sql", py: "python", pyi: "python", rs: "rust", yml: "yaml", yaml: "yaml",
};

export const analysisLimit = 512 * 1024;

export function fileLanguage(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(extensions, ext) ? extensions[ext] : "plaintext";
}
