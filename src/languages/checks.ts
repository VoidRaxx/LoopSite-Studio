import type { Parser } from "@lezer/common";

export type Issue = { message: string; from?: number; to?: number; line?: number; column?: number; warning?: boolean };

function syntaxTree(parser: Parser, text: string): Issue[] {
  const issues: Issue[] = [];
  parser.parse(text).iterate({ enter(node) {
    if (issues.length >= 100) return false;
    if (node.type.isError || node.name === "MismatchedCloseTag") {
      issues.push({ from: node.from, to: node.to, message: "Unerwartete oder unvollständige Syntax." });
    }
    return issues.length < 100 && !node.type.isError;
  } });
  return issues.slice(0, 100);
}

export async function checkSyntax(language: string, text: string): Promise<Issue[]> {
  switch (language) {
    case "python": return syntaxTree((await import("@lezer/python")).parser, text);
    case "rust": return syntaxTree((await import("@lezer/rust")).parser, text);
    case "html": return syntaxTree((await import("@lezer/html")).parser, text);
    case "xml": {
      const { XMLValidator } = await import("fast-xml-parser");
      const result = XMLValidator.validate(text);
      return result === true ? [] : [{ message: result.err.msg, line: result.err.line, column: result.err.col }];
    }
    case "yaml": {
      const { parseAllDocuments } = await import("yaml");
      return parseAllDocuments(text, { prettyErrors: false }).flatMap(doc => doc.errors.map(error =>
        ({ message: error.message, from: error.pos[0], to: error.pos[1] }))).slice(0, 100);
    }
    case "ini": {
      const issues: Issue[] = [];
      let quote = "";
      for (const [index, raw] of text.split("\n").entries()) {
        const line = raw.trim();
        if (!quote && (!line || /^[#;]/.test(line))) continue;
        if (!quote && line.startsWith("[")) {
          if (!/^\[[^\]]+\]\s*(?:[;#].*)?$/.test(line)) {
            issues.push({ line: index + 1, column: 1, warning: true, message: "Abschnitt erwartet: [Name]" });
          }
        } else {
          const value = quote ? line : line.slice(line.indexOf("=") + 1).trimStart();
          let start = 0;
          if (!quote && /^["']/.test(value)) { quote = value[0]; start = 1; }
          if (quote) {
            for (let i = start; i < value.length; i++) {
              if (value[i] === "\\") i++;
              else if (value[i] === quote) { quote = ""; break; }
            }
          }
        }
        if (issues.length === 100) break;
      }
      if (quote) issues.push({ line: text.split("\n").length, column: 1, warning: true, message: "Zeichenkette am Dateiende offen." });
      return issues;
    }
    case "markdown": {
      const { parser } = await import("@lezer/markdown");
      const issues: Issue[] = [];
      parser.parse(text).iterate({ enter({ node }) {
        if (node.name === "FencedCode" && node.getChildren("CodeMark").length === 1) {
          issues.push({ from: node.from, to: node.from + 3, warning: true, message: "Codeblock ohne abschließenden Zaun." });
        }
      } });
      return issues.slice(0, 100);
    }
    case "sql": {
      const { default: sqlite } = await import("node-sql-parser/build/sqlite.js");
      try { new sqlite.Parser().astify(text); return []; }
      catch (first) {
        const { default: maria } = await import("node-sql-parser/build/mariadb.js");
        try { new maria.Parser().astify(text); return []; }
        catch {
          const error = first as { location?: { start: { offset: number } } };
          return [{ from: error.location?.start.offset ?? 0, warning: true,
            message: "Die SQL-Prüfung für SQLite und MariaDB erkennt diese Syntax nicht." }];
        }
      }
    }
    default: return [];
  }
}
