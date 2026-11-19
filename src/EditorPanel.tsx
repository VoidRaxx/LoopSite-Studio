import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import MonacoEditor from "@monaco-editor/react";
import type { Project, Theme } from "./types";
import "./monaco";

type FileEntry = { name: string; path: string; isDir: boolean };
type OpenFile = { content: string; hash: string };
type Tab = { path: string; content: string; savedContent: string; hash: string };
type Props = {
  project: Project | null;
  projects: Project[];
  theme: Theme;
  onSelectProject: (projectId: string) => void;
  onDirtyChange: (dirty: boolean) => void;
};

const language = (path: string) => {
  const ext = path.split(".").pop()?.toLowerCase();
  const values: Record<string, string> = {
    html: "html", htm: "html", php: "php", css: "css", scss: "scss",
    js: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript", jsx: "javascript",
    json: "json", md: "markdown", xml: "xml", sql: "sql",
    py: "python", rs: "rust", yml: "yaml", yaml: "yaml"
  };
  return values[ext ?? ""] ?? "plaintext";
};

const dirname = (path: string) => path.split("/").slice(0, -1).join("/");
const basename = (path: string) => path.split("/").pop() ?? path;

export default function EditorPanel({
  project, projects, theme, onSelectProject, onDirtyChange,
}: Props) {
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saveAction = useRef<() => void>(() => {});
  const projectId = project?.id;

  useEffect(() => {
    setDirectory(""); setTabs([]); setActivePath(null);
    setEntries([]); setError(""); onDirtyChange(false);
  }, [projectId, onDirtyChange]);

  useEffect(() => {
    onDirtyChange(tabs.some(t => t.content !== t.savedContent));
  }, [tabs, onDirtyChange]);

  useEffect(() => {
    let active = true;
    if (!projectId) return;
    setBusy(true);
    invoke<FileEntry[]>("list_project_directory", { projectId, path: directory })
      .then(items => { if (active) { setEntries(items); setError(""); } })
      .catch(err => { if (active) { setEntries([]); setError(String(err)); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [projectId, directory]);

  const activeTab = tabs.find(tab => tab.path === activePath) ?? null;

  async function openFile(path: string) {
    const already = tabs.find(t => t.path === path);
    if (already) { setActivePath(path); return; }
    if (!projectId) return;
    if (tabs.length >= 24) {
      setError("Es können maximal 24 Dateien gleichzeitig geöffnet sein."); return;
    }
    setBusy(true);
    try {
      const file = await invoke<OpenFile>("read_project_file", { projectId, path });
      setTabs(current => {
        if (current.some(t => t.path === path)) return current;
        return [...current, { path, content: file.content, savedContent: file.content, hash: file.hash }];
      });
      setActivePath(path); setError("");
    } catch (err) {
      setError("Datei konnte nicht geöffnet werden: " + String(err));
    } finally { setBusy(false); }
  }

  function closeTab(path: string) {
    const tab = tabs.find(t => t.path === path);
    if (tab && tab.content !== tab.savedContent &&
        !window.confirm("Ungespeicherte Änderungen an " + basename(path) + " verwerfen?")) return;
    const next = tabs.filter(t => t.path !== path);
    setTabs(next);
    if (activePath === path) setActivePath(next[next.length - 1]?.path ?? null);
  }

  async function saveTab(path: string) {
    if (!projectId) return;
    const tab = tabs.find(t => t.path === path);
    if (!tab || tab.content === tab.savedContent) return;
    setBusy(true); setError("");
    try {
      const hash = await invoke<string>("save_project_file", {
        projectId, path, content: tab.content, expectedHash: tab.hash,
      });
      setTabs(current => current.map(t => t.path === path
        ? { ...t, savedContent: tab.content, hash }
        : t));
    } catch (err) {
      setError("Speichern fehlgeschlagen: " + String(err));
    } finally { setBusy(false); }
  }

  saveAction.current = () => { if (activePath) void saveTab(activePath); };

  if (!project) {
    return <div className="empty"><h2>Kein Projekt ausgewählt</h2>
      <p>Lege zuerst ein Projekt an, um dessen Dateien zu bearbeiten.</p></div>;
  }

  return <section className="editor-page">
    <div className="page-heading">
      <div><p className="eyebrow">LOCAL FILE EDITOR</p><h1>Datei-Editor</h1>
        <p>UTF-8-Dateien bearbeiten. Suche mit Strg+F, Ersetzen mit Strg+H, Speichern mit Strg+S.</p></div>
      <label className="editor-project-choice">Projekt
        <select value={project.id} onChange={event => onSelectProject(event.target.value)}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
    </div>
    <div className="editor-layout">
      <aside className="editor-files">
        <div className="editor-path-header">
          <strong>Dateien</strong>
          <button className="icon-button" title="Übergeordneten Ordner öffnen"
            disabled={!directory || busy} onClick={() => setDirectory(dirname(directory))}>↑</button>
        </div>
        <div className="editor-path" title={directory || project.rootPath}>{directory || "/"}</div>
        <div className="editor-file-list">
          {entries.map(entry => <button key={entry.path} className="editor-entry"
            onClick={() => entry.isDir ? setDirectory(entry.path) : void openFile(entry.path)}>
            <span aria-hidden="true">{entry.isDir ? "▣" : "▤"}</span>
            <span title={entry.path}>{entry.name}</span>
          </button>)}
          {!busy && entries.length === 0 && <p className="empty-list">Keine Dateien vorhanden.</p>}
        </div>
      </aside>
      <div className="editor-main">
        <div className="editor-tabs" role="tablist" aria-label="Geöffnete Dateien">
          {tabs.map(tab => <div key={tab.path} className={"editor-tab " + (activePath === tab.path ? "selected" : "")}>
            <button role="tab" aria-selected={activePath === tab.path}
              title={tab.path} onClick={() => setActivePath(tab.path)}>
              {basename(tab.path)}{tab.content !== tab.savedContent && <span aria-label="Ungespeichert"> ●</span>}
            </button>
            <button className="editor-tab-close" aria-label={basename(tab.path) + " schließen"}
              onClick={() => closeTab(tab.path)}>×</button>
          </div>)}
        </div>
        {activeTab ? <>
          <div className="editor-toolbar">
            <span title={activeTab.path}>{activeTab.path}</span>
            <button className="primary" disabled={busy || activeTab.content === activeTab.savedContent}
              onClick={() => void saveTab(activeTab.path)}>Speichern</button>
          </div>
          <div className="editor-monaco">
            <MonacoEditor
              path={"file:///" + project.id + "/" + activeTab.path}
              language={language(activeTab.path)}
              value={activeTab.content}
              theme={theme === "white" ? "vs" : "vs-dark"}
              options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 13,
                wordWrap: "on", scrollBeyondLastLine: false, tabSize: 2, autoClosingBrackets: "always" }}
              onChange={value => setTabs(current => current.map(t =>
                t.path === activeTab.path ? { ...t, content: value ?? "" } : t))}
              onMount={(editor, monaco) => {
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                  () => saveAction.current());
              }}
            />
          </div>
        </> : <div className="editor-placeholder">
          <h3>Eine Datei auswählen</h3>
          <p>Wähle links eine Datei aus deinem Projektordner aus. PHP, HTML, CSS und JavaScript werden hervorgehoben.</p>
        </div>}
      </div>
    </div>
    {error && <div className="notice error" role="alert">{error}
      <button aria-label="Fehlermeldung schließen" onClick={() => setError("")}>×</button></div>}
    <p className="editor-footnote">Dateien bleiben lokal auf deinem Rechner. LoopSite bearbeitet ausschließlich Dateien innerhalb des ausgewählten Projektordners; binäre Dateien und Dateien über 4 MiB sind gesperrt.</p>
  </section>;
}
