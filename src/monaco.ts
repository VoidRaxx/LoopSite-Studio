import "./php-analysis";
import { resolveTheme } from "./themes";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Bundle language workers locally: no CDN or internet dependency.
self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (["css", "scss", "less"].includes(label)) return new cssWorker();
    if (["html", "handlebars", "razor"].includes(label)) return new htmlWorker();
    if (["typescript", "javascript"].includes(label)) return new tsWorker();
    return new editorWorker();
  },
};
for (const mode of ["dark", "light"] as const) {
  const { palette } = resolveTheme(mode, mode === "dark");
  monaco.editor.defineTheme(`studio-${mode}`, {
    base: mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": palette.bg,
      "editor.foreground": palette.text,
      "editorCursor.foreground": palette.accent,
      "editor.lineHighlightBackground": palette.panel,
      "editorLineNumber.foreground": palette.muted,
      "editor.selectionBackground": palette.accent + "55",
      "editorWidget.background": palette.panel,
    },
  });
}
loader.config({ monaco });
