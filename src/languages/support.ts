import { editor, languages, MarkerSeverity, Range } from "monaco-editor";
import type { Issue } from "./checks";
import CheckWorker from "./check.worker?worker";
import { registerChecks } from "./worker-service";

type JsxToken = { from: number; to: number; attribute: boolean };
const decorations = new WeakMap<editor.ITextModel, string[]>();
registerChecks(["javascript", "typescript"], "studio-jsx", () => new CheckWorker(),
  (model, { tokens }: { tokens: JsxToken[] }) => {
    const ids = model.deltaDecorations(decorations.get(model) ?? [], tokens.map(token => ({
      range: Range.fromPositions(model.getPositionAt(token.from), model.getPositionAt(token.to)),
      options: { inlineClassName: token.attribute ? "jsx-attribute" : "jsx-tag" },
    })));
    decorations.set(model, ids);
  }, model => /\.[jt]sx$/i.test(model.uri.path));

registerChecks(["python", "rust", "html", "yaml", "xml", "markdown", "sql", "ini"], "studio-syntax",
  () => new CheckWorker(), (model, { issues }: { issues: Issue[] }) => {
    editor.setModelMarkers(model, "studio-syntax", issues.map(issue => {
      const start = issue.line !== undefined ? model.validatePosition({ lineNumber: issue.line, column: issue.column ?? 1 })
        : model.getPositionAt(issue.from ?? 0);
      const end = model.getPositionAt(Math.max(model.getOffsetAt(start) + 1, issue.to ?? 0));
      return { severity: issue.warning ? MarkerSeverity.Warning : MarkerSeverity.Error, message: issue.message,
        startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
    }));
  });

const snippets: Record<string, Record<string, string>> = {
  ini: { section: "[${1:section}]", setting: "${1:key} = ${2:value}" },
  python: { def: "def ${1:name}(${2:args}):\n\t${0:pass}", class: "class ${1:Name}:\n\t${0:pass}", for: "for ${1:item} in ${2:items}:\n\t${0:pass}" },
  rust: { fn: "fn ${1:name}(${2}) {\n\t$0\n}", impl: "impl ${1:Type} {\n\t$0\n}", match: "match ${1:value} {\n\t${2:_} => ${0:()},\n}" },
  sql: { SELECT: "SELECT ${1:*} FROM ${2:table};", INSERT: "INSERT INTO ${1:table} (${2:column}) VALUES (${3:value});", JOIN: "JOIN ${1:table} ON ${2:condition}" },
  xml: { element: "<${1:element}>$0</${1}>", declaration: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" },
  yaml: { mapping: "${1:key}: ${2:value}", sequence: "- ${1:item}\n- ${2:item}" },
  markdown: { link: "[${1:text}](${2:url})", code: "```${1:language}\n$0\n```", heading: "## ${1:Heading}" },
  json: { object: "{\n\t\"${1:key}\": \"${2:value}\"\n}", array: "[${1:value}]" },
  php: { function: "function ${1:name}(${2}) {\n\t$0\n}", foreach: "foreach (\\$${1:items} as \\$${2:item}) {\n\t$0\n}" },
};
for (const [id, entries] of Object.entries(snippets)) {
  languages.registerCompletionItemProvider(id, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return { suggestions: Object.entries(entries).map(([label, insertText]) => ({
        label, insertText, range, kind: languages.CompletionItemKind.Snippet,
        insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
      })) };
    },
  });
}
const ts = languages.typescript;
for (const defaults of [ts.javascriptDefaults, ts.typescriptDefaults]) {
  defaults.setCompilerOptions({ ...defaults.getCompilerOptions(), jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs });
  defaults.setDiagnosticsOptions({ ...defaults.getDiagnosticsOptions(), onlyVisible: true });
}
languages.json.jsonDefaults.setDiagnosticsOptions({ ...languages.json.jsonDefaults.diagnosticsOptions,
  validate: true, allowComments: false, comments: "error", trailingCommas: "error", enableSchemaRequest: false });
