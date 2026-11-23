import * as monaco from "monaco-editor";
import { registerChecks } from "./languages/worker-service";
import PhpWorker from "./php-analysis.worker?worker";

type SymbolInfo = { name: string; kind: string; line: number; column: number; scope: string };
type Analysis = { modelId: string; uri: string; version: number; symbols: SymbolInfo[]; errors: { message: string; line: number; column: number }[] };
const symbols = new WeakMap<monaco.editor.ITextModel, SymbolInfo[]>();
registerChecks(["php"], "loopsite-php", () => new PhpWorker(), (model, data: Analysis) => {
  symbols.set(model, data.symbols);
  monaco.editor.setModelMarkers(model, "loopsite-php", data.errors.map(e => ({
    severity: monaco.MarkerSeverity.Error, message: e.message, source: "PHP",
    startLineNumber: e.line, endLineNumber: e.line, startColumn: e.column, endColumn: e.column + 1,
  })));
});

function range(symbol: SymbolInfo) {
  return new monaco.Range(symbol.line, symbol.column, symbol.line, symbol.column + symbol.name.length);
}

monaco.languages.registerDocumentSymbolProvider("php", {
  provideDocumentSymbols(model) {
    return (symbols.get(model) ?? []).filter(s => s.kind !== "call").map(s => ({
      name: s.name, detail: s.kind, tags: [], range: range(s), selectionRange: range(s),
      kind: s.kind === "function" ? monaco.languages.SymbolKind.Function :
        s.kind === "method" ? monaco.languages.SymbolKind.Method : monaco.languages.SymbolKind.Class,
    }));
  },
});
monaco.languages.registerCompletionItemProvider("php", {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    return { suggestions: (symbols.get(model) ?? []).filter(s => s.kind !== "call").map(s => ({
      label: s.name, insertText: s.name, detail: s.kind, kind: monaco.languages.CompletionItemKind.Reference,
      range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
    })) };
  },
});

function functionLocations(model: monaco.editor.ITextModel, position: monaco.Position) {
  const source = symbols.get(model)?.find(s =>
    (s.kind === "call" || s.kind === "function") && range(s).containsPosition(position));
  if (!source) return [];
  const project = model.uri.path.split("/")[1];
  return monaco.editor.getModels().filter(m => m.uri.path.split("/")[1] === project)
    .flatMap(m => (symbols.get(m) ?? [])
      .filter(s => (s.kind === "function" || s.kind === "call") &&
        s.scope.toLowerCase() === source.scope.toLowerCase() && s.name.toLowerCase() === source.name.toLowerCase())
      .map(s => ({ kind: s.kind, uri: m.uri, range: range(s) })));
}

monaco.languages.registerDefinitionProvider("php", {
  provideDefinition(model, position) {
    return functionLocations(model, position).filter(location => location.kind === "function");
  },
});
monaco.languages.registerReferenceProvider("php", {
  provideReferences(model, position, context) {
    return functionLocations(model, position).filter(location => context.includeDeclaration || location.kind === "call");
  },
});
