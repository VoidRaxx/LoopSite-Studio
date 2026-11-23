import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import MonacoEditor from "@monaco-editor/react";
import type { Project, Theme } from "./types";
import "./monaco";
import { analysisLimit, fileLanguage } from "./languages/files";
import { translate, type Language } from "./i18n";
import EditorProblems from "./EditorProblems";
import { editor, Uri } from "monaco-editor";
import LogViewer, { type LogTarget } from "./LogViewer";
import ProjectSearch, { type Replacement } from "./ProjectSearch";

type FileEntry = { name: string; path: string; isDir: boolean };
type OpenFile = { content: string; hash: string };
type Tab = { path: string; content: string; savedContent: string; hash: string };
type Props = {
  language: Language;
  project: Project;
  projects: Project[];
  theme: Exclude<Theme, "system">;
  onSelectProject: (projectId: string) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
  visible: boolean;
  running: { projectId: string; serverId: string; port: number }[];
  serverBusy: boolean;
  toggleServer: (projectId: string, serverId: string, running: boolean) => Promise<void>;
  openServerUrl: (port: number) => Promise<void>;
};

const dirname = (path: string) => path.split("/").slice(0, -1).join("/");
const basename = (path: string) => path.split("/").pop() ?? path;

export default function EditorPanel({
  project, projects, theme, language, onSelectProject, onDirtyChange, visible, running, serverBusy, toggleServer, openServerUrl,
}: Props) {
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [secondaryPath, setSecondaryPath] = useState<string | null>(null);
  const [treeWidth, setTreeWidth] = useState(215);
  const resizing = useRef(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saveAction = useRef<(path: string) => void>(() => {});
  const projectId = project.id;
  const [serverId, setServerId] = useState("");
  const servers = project.servers.filter(s => s.runtime !== "custom");
  const server = servers.find(s => s.id === serverId) ?? servers[0];
  const process = running.find(r => r.projectId === projectId && r.serverId === server?.id);
  const [logs, setLogs] = useState(false);
  const logTarget = useMemo<LogTarget | null>(() => server?.runtime === "php"
    ? { kind: "php", projectId, serverId: server.id, title: server.name } : null,
    [projectId, server?.id, server?.name, server?.runtime]);
  const [search, setSearch] = useState<"files" | "text" | null>(null);
  const [create, setCreate] = useState<"file" | "folder" | null>(null);
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [revision, setRevision] = useState(0);
  const mainEditor = useRef<editor.IStandaloneCodeEditor | null>(null);
  const pendingLine = useRef<{ path: string; line: number } | null>(null);
  const models = useRef(new Set<editor.ITextModel>());
  const modelUri = (path: string) => Uri.from({ scheme: "file", path: "/" + projectId + "/" + path }).toString();
  useEffect(() => {
    const open = new Set(tabs.map(t => modelUri(t.path)));
    for (const model of models.current) {
      if (!open.has(model.uri.toString())) { model.dispose(); models.current.delete(model); }
    }
  }, [tabs, projectId]);
  useEffect(() => {
    const owned = models.current;
    return () => { for (const model of owned) model.dispose(); owned.clear(); };
  }, []);
  const dirty = tabs.some(t => t.content !== t.savedContent);
  useEffect(() => { onDirtyChange(projectId, dirty); }, [dirty, projectId, onDirtyChange]);
  useEffect(() => {
    if (!visible) return;
    const handle = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if ((key === "p" && !event.shiftKey) || (key === "f" && event.shiftKey)) {
        event.preventDefault(); event.stopPropagation(); setSearch(key === "p" ? "files" : "text");
      }
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [visible]);

  function reveal(editor: editor.IStandaloneCodeEditor, path: string) {
    if (pendingLine.current?.path !== path) return;
    const lineNumber = Math.min(pendingLine.current.line, editor.getModel()?.getLineCount() ?? 1);
    editor.setPosition({ lineNumber, column: 1 });
    editor.revealLineInCenter(lineNumber); editor.focus();
    pendingLine.current = null;
  }

  useEffect(() => {
    let active = true;
    if (!projectId) return;
    setBusy(true);
    invoke<FileEntry[]>("list_project_directory", { projectId, path: directory })
      .then(items => { if (active) { setEntries(items); setError(""); } })
      .catch(err => { if (active) { setEntries([]); setError(String(err)); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [projectId, directory, revision]);

  const activeTab = tabs.find(tab => tab.path === activePath) ?? null;

  async function openFile(path: string, line?: number) {
    pendingLine.current = line ? { path, line } : null;
    if (activePath === path && mainEditor.current) reveal(mainEditor.current, path);
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

  const openAction = useRef(openFile);
  openAction.current = openFile;
  useEffect(() => {
    if (!visible) return;
    const prefix = "/" + projectId + "/";
    const opener = editor.registerEditorOpener({
      async openCodeEditor(_source, resource, location) {
        if (resource.scheme !== "file" || !resource.path.startsWith(prefix)) return false;
        const line = location && ("lineNumber" in location ? location.lineNumber : location.startLineNumber);
        await openAction.current(resource.path.slice(prefix.length), line);
        return true;
      },
    });
    return () => opener.dispose();
  }, [visible, projectId]);

  async function readBuffer(path: string) {
    const tab = tabs.find(t => t.path === path);
    return tab ?? await invoke<OpenFile>("read_project_file", { projectId, path });
  }
  function stageReplacements(files: Replacement[]) {
    const next = [...tabs];
    for (const file of files) {
      const index = next.findIndex(t => t.path === file.path);
      const tab = next[index];
      if (tab && (tab.content !== file.original || tab.hash !== file.hash)) {
        throw new Error("Datei wurde seit der Vorschau geändert: " + file.path);
      }
      if (tab) next[index] = { ...tab, content: file.updated };
      else next.push({ path: file.path, content: file.updated, savedContent: file.original, hash: file.hash });
    }
    if (next.length > 24) throw new Error("Mehr als 24 offene Dateien. Bitte die Suche eingrenzen.");
    setTabs(next); setActivePath(files[0].path);
  }

  function closeTab(path: string) {
    const tab = tabs.find(t => t.path === path);
    if (tab && tab.content !== tab.savedContent &&
        !window.confirm("Ungespeicherte Änderungen an " + basename(path) + " verwerfen?")) return;
    const next = tabs.filter(t => t.path !== path);
    setTabs(next);
    if (activePath === path) setActivePath(next[next.length - 1]?.path ?? null);
    if (secondaryPath === path) setSecondaryPath(null);
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

  saveAction.current = path => { void saveTab(path); };

  function resizeTo(clientX: number) {
    const bounds = layoutRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setTreeWidth(Math.max(160, Math.min(450, Math.min(bounds.width - 250, clientX - bounds.left))));
  }

  function codePane(path: string, right: boolean) {
    const tab = tabs.find(t => t.path === path);
    if (!tab) return null;
    const dirty = tab.content !== tab.savedContent;
    return <div className="editor-code-pane" key={(right ? "right:" : "left:") + path}>
      <div className="editor-toolbar">
        <span title={path}>{right ? "Zweite Ansicht · " : ""}{path}</span>
        <div className="editor-toolbar-actions">
          <button className="secondary" disabled={busy || !dirty} onClick={() => void saveTab(path)}>
            Speichern{dirty ? " ●" : ""}
          </button>
          {right && <button className="icon-button" onClick={() => setSecondaryPath(null)}
            aria-label="Zweite Ansicht schließen" title="Zweite Ansicht schließen">×</button>}
        </div>
      </div>
      <div className="editor-monaco">
        <MonacoEditor
          path={modelUri(path)}
          keepCurrentModel
          language={tab.content.length > analysisLimit ? "plaintext" : fileLanguage(path)}
          value={tab.content}
          theme={`studio-${theme}`}
          options={{
            wordBasedSuggestions: "currentDocument", automaticLayout: true, minimap: { enabled: false }, fontSize: 12,
            lineNumbersMinChars: 3, wordWrap: "on", scrollBeyondLastLine: false,
            tabSize: 2, autoClosingBrackets: "always", smoothScrolling: true,
            padding: { top: 12 },
          }}
          onChange={value => setTabs(current => current.map(t =>
            t.path === path ? { ...t, content: value ?? "" } : t))}
          onMount={(editor, monaco) => {
            const model = editor.getModel();
            if (model) models.current.add(model);
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
              () => saveAction.current(path));
            if (!right) {
              mainEditor.current = editor;
              reveal(editor, path);
              editor.onDidDispose(() => { if (mainEditor.current === editor) mainEditor.current = null; });
            }
          }}
        />
      </div>
    </div>;
  }

  return <section className="editor-page">
    <div className="page-heading">
      <h1>{project.name}</h1>
      <label className="editor-project-choice">Projekt
        <select value={project.id} onChange={event => onSelectProject(event.target.value)}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
    </div>
    <div className="ide-tools">
      {server && <>
        <label>Server <select value={server.id} onChange={e => setServerId(e.target.value)}>
          {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <button className="secondary" disabled={serverBusy} onClick={() => void toggleServer(projectId, server.id, !!process)}>{process ? "Stoppen" : "Starten"}</button>
        <button className="secondary" disabled={!process} onClick={() => process && void openServerUrl(process.port)}>Im Browser öffnen</button>
        {logTarget && <button className="secondary" aria-expanded={logs} onClick={() => setLogs(!logs)}>Serverlog</button>}
      </>}
      <button className="secondary" onClick={() => setSearch("files")}>Datei öffnen…</button>
      <button className="secondary" onClick={() => setSearch("text")}>Projekt durchsuchen</button>
    </div>
    {search && <ProjectSearch key={search} readBuffer={readBuffer} stage={stageReplacements} projectId={projectId} filenames={search === "files"} openLine={openFile} close={() => setSearch(null)}/>}
    <div className="editor-layout" ref={layoutRef}
      style={{ gridTemplateColumns: treeWidth + "px 7px minmax(0,1fr)" }}>
      <aside className="editor-files">
        <div className="editor-path-header">
          <strong>Dateien</strong>
          <span>{tabs.length} geöffnet</span>
          <button className="icon-button" title="Übergeordneten Ordner öffnen"
            disabled={!directory || busy} onClick={() => setDirectory(dirname(directory))}>↑</button>
        </div>
        <div className="editor-path" title={directory || project.rootPath}>{directory || "/"}</div>
        <div className="file-actions">
          <button className="secondary" onClick={() => { setMoveFrom(null); setCreate("file"); setName(""); }}>+ Datei</button>
          <button className="secondary" onClick={() => { setMoveFrom(null); setCreate("folder"); setName(""); }}>+ Ordner</button>
        </div>
        {create && <form className="file-create" onSubmit={async e => {
          e.preventDefault();
          if (busy || !name.trim()) return;
          setBusy(true);
          try {
            const path = await invoke<string>("create_project_entry", { projectId, directory, name, folder: create === "folder" });
            setRevision(r => r + 1); setCreate(null);
            if (create === "file") await openFile(path);
            else setDirectory(path);
          } catch (e) { setError(String(e)); }
          finally { setBusy(false); }
        }}>
          <label>{create === "file" ? "Dateiname" : "Ordnername"}<input autoFocus value={name} onChange={e => setName(e.target.value)}/></label>
          <button className="secondary" disabled={busy || !name.trim()}>Erstellen</button>
          <button type="button" className="secondary" onClick={() => setCreate(null)}>Abbrechen</button>
        </form>}
        {moveFrom && <form className="file-create" onSubmit={async e => {
          e.preventDefault();
          if (busy || name === moveFrom || !name) return;
          setBusy(true);
          try {
            await invoke("move_project_entry", { projectId, path: moveFrom, destination: name });
            const remap = (path: string) => path === moveFrom || path.startsWith(moveFrom + "/")
              ? name + path.slice(moveFrom.length) : path;
            setTabs(list => list.map(tab => ({ ...tab, path: remap(tab.path) })));
            setActivePath(path => path && remap(path)); setSecondaryPath(path => path && remap(path));
            setMoveFrom(null); setRevision(r => r + 1);
          } catch (e) { setError(String(e)); }
          finally { setBusy(false); }
        }}>
          <label>Zielpfad ab Projektordner<input autoFocus value={name} onChange={e => setName(e.target.value)}/></label>
          <button className="secondary" disabled={busy || !name || name === moveFrom}>Verschieben</button>
          <button type="button" className="secondary" onClick={() => setMoveFrom(null)}>Abbrechen</button>
        </form>}
        <div className="editor-file-list">
          {directory && <button className="editor-entry editor-parent"
            onClick={() => setDirectory(dirname(directory))}>← ..</button>}
          {entries.map(entry => <div className="file-entry-row" key={entry.path}><button
            className={"editor-entry " + (!entry.isDir && tabs.some(t => t.path === entry.path) ? "opened" : "")}
            title={entry.path}
            disabled={busy}
            onClick={() => entry.isDir ? setDirectory(entry.path) : void openFile(entry.path)}>
            <span aria-hidden="true">{entry.isDir ? "▣" : "▤"}</span>
            <span>{entry.name}</span>
            {!entry.isDir && tabs.some(t => t.path === entry.path) && <span aria-label="Geöffnet">•</span>}
          </button><button className="icon-button" title="Umbenennen oder verschieben"
            aria-label={entry.name + " umbenennen oder verschieben"} disabled={busy}
            onClick={() => { setCreate(null); setMoveFrom(entry.path); setName(entry.path); }}>⋯</button></div>)}
          {!busy && entries.length === 0 && <p className="empty-list">Keine Dateien vorhanden.</p>}
        </div>
      </aside>
      <div className="editor-splitter" role="separator" tabIndex={0}
        aria-label="Dateiliste breiter oder schmaler ziehen" aria-orientation="vertical"
        aria-valuemin={160} aria-valuemax={450} aria-valuenow={treeWidth}
        onPointerDown={event => {
          resizing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (resizing.current) resizeTo(event.clientX); }}
        onPointerUp={() => { resizing.current = false; }}
        onPointerCancel={() => { resizing.current = false; }}
        onKeyDown={event => {
          if (event.key === "ArrowLeft") { event.preventDefault(); setTreeWidth(w => Math.max(160, w - 20)); }
          if (event.key === "ArrowRight") { event.preventDefault(); setTreeWidth(w => Math.min(450, w + 20)); }
        }}/>
      <div className="editor-main">
        <div className="editor-tabs" role="tablist" aria-label="Geöffnete Dateien">
          {tabs.map(tab => <div key={tab.path} className={"editor-tab " + (activePath === tab.path ? "selected" : "")}>
            <button role="tab" aria-selected={activePath === tab.path} title={tab.path}
              onClick={() => setActivePath(tab.path)}>
              {basename(tab.path)}{tab.content !== tab.savedContent && <span className="editor-dirty" aria-label="Ungespeichert"> ●</span>}
            </button>
            <button className="editor-tab-side" title="In zweiter Ansicht öffnen"
              aria-label={basename(tab.path) + " rechts anzeigen"} onClick={() => setSecondaryPath(tab.path)}>⇄</button>
            <button className="editor-tab-close" aria-label={basename(tab.path) + " schließen"}
              onClick={() => closeTab(tab.path)}>×</button>
          </div>)}
          {tabs.length === 0 && <span className="editor-tabs-hint">Dateien links anklicken – mehrere Tabs und zweite Ansicht möglich</span>}
        </div>
        {activeTab ? <div className={"editor-code-grid" + (secondaryPath ? " split" : "")}>
          {codePane(activeTab.path, false)}
          {secondaryPath && codePane(secondaryPath, true)}
        </div> : <div className="editor-placeholder">
          <h3>Eine Datei auswählen</h3>
          <p>Links Dateien öffnen · Tabs wechseln · ⇄ für zwei Dateien nebeneinander.
            Die Trennlinie ist mit der Maus verschiebbar.</p>
        </div>}
        {visible && activeTab && activeTab.content.length <= analysisLimit && fileLanguage(activeTab.path) !== "plaintext" &&
          <EditorProblems language={language} key={activeTab.path} uri={modelUri(activeTab.path)} jump={(lineNumber, column) => {
            const code = mainEditor.current;
            code?.setPosition({ lineNumber, column }); code?.revealLineInCenter(lineNumber); code?.focus();
          }}/>}
        <div className="editor-statusbar">
          <span>{activeTab ? activeTab.path : "Keine Datei geöffnet"}</span>
          {activeTab && activeTab.content.length > analysisLimit && <span>{translate(language, "largePlain")}</span>}
          <span>{activeTab ? fileLanguage(activeTab.path).toUpperCase() : "UTF-8"} · {tabs.length} Tabs</span>
        </div>
      </div>
    </div>
    {visible && logs && logTarget && <LogViewer key={server?.id} target={logTarget} projectRoot={project.rootPath}
      onOpenLine={openFile} onClose={() => setLogs(false)}/>}
    {error && <div className="notice error" role="alert">{error}
      <button aria-label="Fehlermeldung schließen" onClick={() => setError("")}>×</button></div>}
    <p className="editor-footnote">Dateien bleiben lokal auf deinem Rechner. LoopSite bearbeitet ausschließlich Dateien innerhalb des ausgewählten Projektordners; binäre Dateien und Dateien über 4 MiB sind gesperrt.</p>
  </section>;
}
