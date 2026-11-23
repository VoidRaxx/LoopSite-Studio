import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Hit = { path: string; line: number; preview: string };
type Results = { hits: Hit[]; limited: boolean };
export type Replacement = { path: string; original: string; hash: string; updated: string };
type Preview = { files: Replacement[]; lines: { path: string; line: number; before: string; after: string }[] };
type Props = { readBuffer: (path: string) => Promise<{ content: string; hash: string }>;
  stage: (files: Replacement[]) => void; projectId: string; filenames: boolean; openLine: (path: string, line: number) => void; close: () => void };

export default function ProjectSearch({ projectId, filenames, openLine, close, readBuffer, stage }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Results | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  async function prepare() {
    if (!result) return;
    setBusy(true); setError(""); setPreview(null);
    try {
      const files: Replacement[] = [];
      const lines: Preview["lines"] = [];
      const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      for (const path of new Set(result.hits.map(hit => hit.path))) {
        const { content, hash } = await readBuffer(path);
        const parts = content.split("\n");
        for (const hit of result.hits.filter(h => h.path === path)) {
          const before = parts[hit.line - 1];
          if (before === undefined) continue;
          const after = before.replace(pattern, () => replacement);
          if (after === before) continue;
          parts[hit.line - 1] = after;
          lines.push({ path, line: hit.line, before, after });
        }
        if (parts.join("\n") !== content) files.push({ path, original: content, updated: parts.join("\n"), hash });
      }
      setPreview({ files, lines });
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return <section className="project-search" onKeyDown={e => { if (e.key === "Escape") close(); }}>
    <form onSubmit={async e => {
      e.preventDefault();
      if (busy || !query.trim()) return;
      setBusy(true); setError(""); setResult(null); setPreview(null);
      try { setResult(await invoke<Results>("search_project", { projectId, query, filenames })); }
      catch (e) { setError(String(e)); }
      finally { setBusy(false); }
    }}>
      <label>{filenames ? "Datei schnell öffnen" : "Projektweit suchen"}
        <input ref={input} value={query} disabled={busy} maxLength={512} onChange={e => { setQuery(e.target.value); setResult(null); setPreview(null); }}/>
      </label>
      <button className="secondary" disabled={busy || !query.trim()}>{busy ? "Suche läuft …" : "Suchen"}</button>
      <button type="button" className="secondary" onClick={close}>Schließen</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <><p role="status">{result.hits.length} Treffer{result.limited && " · Suchlimit erreicht"}</p>
      {!filenames && result.hits.length > 0 && <div className="replace-tools">
        <label>Ersetzen durch <input value={replacement} disabled={busy}
          onChange={e => { setReplacement(e.target.value); setPreview(null); }}/></label>
        <button className="secondary" disabled={busy} onClick={() => void prepare()}>Vorschau für Treffer</button>
      </div>}
      {preview && <div className="search-results">
        {preview.lines.map(row => <div key={row.path + ":" + row.line}>
          <strong>{row.path}:{row.line}</strong><del>{row.before}</del><ins>{row.after}</ins>
        </div>)}
        <button className="secondary" disabled={!preview.files.length} onClick={() => {
          try { stage(preview.files); close(); } catch (err) { setError(String(err)); }
        }}>{preview.files.length} Dateien als ungespeicherte Tabs übernehmen</button>
      </div>}
      <div className="search-results">{result.hits.map(hit =>
        <button className="editor-entry" key={hit.path + ":" + hit.line} onClick={() => { openLine(hit.path, hit.line); close(); }}>
          <strong>{hit.path}{!filenames && ":" + hit.line}</strong> {hit.preview}
        </button>)}</div></>}
  </section>;
}
