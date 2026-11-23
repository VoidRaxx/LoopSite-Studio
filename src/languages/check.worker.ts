import { checkSyntax } from "./checks";

self.onmessage = async ({ data }) => {
  try {
    if (/\.[jt]sx$/i.test(data.uri)) {
      const { parser } = await import("@lezer/javascript");
      const tree = parser.configure({ dialect: data.language === "typescript" ? "jsx ts" : "jsx" }).parse(data.text);
      const tokens: { from: number; to: number; attribute: boolean }[] = [];
      tree.iterate({ enter(node) {
        if (tokens.length >= 4000) return false;
        if (node.name === "JSXIdentifier") tokens.push({ from: node.from, to: node.to, attribute: node.node.parent?.name === "JSXAttribute" });
      } });
      self.postMessage({ tokens });
      return;
    }
    const issues = await checkSyntax(data.language, data.text);
    self.postMessage({ issues });
  } catch {
    self.postMessage({ failed: true });
  }
};
