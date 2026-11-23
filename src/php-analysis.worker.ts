import { Engine } from "php-parser";

const parser = new Engine({ parser: { version: 805, suppressErrors: true }, ast: { withPositions: true } });
type SymbolInfo = { name: string; kind: string; line: number; column: number; scope: string };
type AstNode = { kind?: string; name?: { name?: string; loc?: { start: { line: number; column: number } } } };

self.onmessage = ({ data }) => {
  const { uri, modelId, version, text } = data;
  const symbols: SymbolInfo[] = [];
  try {
    const program = parser.parseCode(text, uri);
    const nodes: { value: unknown; scope: string }[] = [{ value: program, scope: "" }];
    while (nodes.length) {
      const { value, scope } = nodes.pop()!;
      if (!value || typeof value !== "object") continue;
      const node = value as AstNode;
      const namespace = node.kind === "namespace" && typeof node.name === "string" ? node.name : scope;
      if (node.kind === "call" && "what" in value) {
        const target = value.what as { kind?: string; resolution?: string; name?: string; loc?: { start: { line: number; column: number } } } | null;
        if (target?.kind === "name" && target.resolution === "uqn" && target.name && target.loc) {
          symbols.push({ name: target.name, kind: "call", scope: namespace, line: target.loc.start.line, column: target.loc.start.column + 1 });
        }
      }
      if (node.kind && ["class", "interface", "trait", "enum", "method", "function"].includes(node.kind)) {
        const pos = node.name?.loc?.start;
        if (pos && node.name?.name) symbols.push({ name: node.name.name, kind: node.kind, scope: namespace, line: pos.line, column: pos.column + 1 });
      }
      for (const [key, child] of Object.entries(value)) {
        if (key !== "loc" && key !== "errors" && child && typeof child === "object") nodes.push({ value: child, scope: namespace });
      }
    }
    const errors = program.errors.slice(0, 100).map(e => ({
      message: e.message, line: e.loc?.start.line ?? e.line, column: (e.loc?.start.column ?? 0) + 1,
    }));
    self.postMessage({ uri, modelId, version, symbols, errors });
  } catch {
    self.postMessage({ uri, modelId, version, symbols: [], errors: [] });
  }
};
