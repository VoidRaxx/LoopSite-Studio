import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import type { DomainRoute, Project, Runtime, ServerConfig, Theme } from "./types";
import EditorPanel from "./EditorPanel";
import DatabasePanel from "./DatabasePanel";
import MariaPanel from "./MariaPanel";
import LogViewer, { type LogTarget } from "./LogViewer";
import RuntimeInstallPanel from "./RuntimeInstallPanel";
import UpdateManager from "./UpdateManager";
import { THEME_OPTIONS, resolveTheme } from "./themes";
import { languages, translate, type Language } from "./i18n";

type Panel = "projects" | "routing" | "editor" | "php" | "databases" | "setup" | "settings";
type PhpRuntime = { path: string; version: string; source: string };
type ProxyStatus = { running: boolean; port: number | null; hostnameCount: number };
type RunningServer = { projectId: string; serverId: string; port: number; lanAccess: boolean };
type Dialog = "project" | "server" | "domain" | null;
const uid = () => crypto.randomUUID();

function suggestPort(projects: Project[]): number {
  const taken = new Set(projects.flatMap(p => p.servers.map(s => s.port)));
  let port = 8000;
  while (taken.has(port) && port <= 65535) port++;
  return port;
}
function validHost(host: string): boolean {
  return host.length <= 253 && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) &&
    host.split(".").every(part => part.length <= 63 && !part.startsWith("-") && !part.endsWith("-"));
}
function getError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export default function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("loopsite-language");
    return languages.find(option => option.id === saved)?.id ?? "en";
  });
  const [appVersion, setAppVersion] = useState("0.1.0");
  const experimentalBuild = /-experimental(?:\.|$)/.test(appVersion);
  const [includeExperimental, setIncludeExperimental] = useState(() =>
    localStorage.getItem("loopsite-include-experimental") === "true"
  );
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  useEffect(() => {
    localStorage.setItem("loopsite-language", language);
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    localStorage.setItem("loopsite-include-experimental", String(includeExperimental));
  }, [includeExperimental]);
  useEffect(() => { void getVersion().then(setAppVersion).catch(() => {}); }, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [phpRuntimes, setPhpRuntimes] = useState<PhpRuntime[]>([]);
  const [phpBusy, setPhpBusy] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serverPhpPath, setServerPhpPath] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [dbEngine, setDbEngine] = useState<"sqlite" | "maria">("sqlite");
  const [updateCheckSignal, setUpdateCheckSignal] = useState(0);
  const [updateStatus, setUpdateStatus] = useState("Noch nicht geprüft.");
  const [proxy, setProxy] = useState<ProxyStatus>({ running: false, port: null, hostnameCount: 0 });
  const [proxyPort, setProxyPort] = useState("8080");
  const [proxyBusy, setProxyBusy] = useState(false);
  const [running, setRunning] = useState<RunningServer[]>([]);
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("projects");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("loopsite-theme");
    if (saved === "hu") return "default";
    return saved === "system" || THEME_OPTIONS.some(item => item.id === saved) ? saved as Theme : "default";
  });
  const [uiSize, setUiSize] = useState<"compact" | "normal" | "large">(() => {
    const saved = localStorage.getItem("loopsite-ui-size");
    return saved === "compact" || saved === "large" ? saved : "normal";
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const activeTheme = resolveTheme(theme, systemDark);
  const [projectName, setProjectName] = useState("");
  const [projectRoot, setProjectRoot] = useState("");
  const [serverName, setServerName] = useState("");
  const [serverRoot, setServerRoot] = useState("");
  const [serverPort, setServerPort] = useState("8000");
  const [serverRuntime, setServerRuntime] = useState<Runtime>("php");
  const [serverRouter, setServerRouter] = useState("");
  const [serverLan, setServerLan] = useState(false);
  const [domainHost, setDomainHost] = useState("");
  const [domainServerId, setDomainServerId] = useState("");
  const [domainHttps, setDomainHttps] = useState(false);

  useEffect(() => {
    invoke<Project[]>("load_projects")
      .then(data => { setProjects(data); if (data.length) setSelectedId(data[0].id); })
      .catch(err => setError("Projekte konnten nicht geladen werden: " + getError(err)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = activeTheme.id;
    root.style.colorScheme = activeTheme.light ? "light" : "dark";
    const variables: Record<string, string> = {
      "--bg": activeTheme.palette.bg,
      "--panel": activeTheme.palette.panel,
      "--sidebar": activeTheme.palette.sidebar,
      "--line": activeTheme.palette.line,
      "--text": activeTheme.palette.text,
      "--muted": activeTheme.palette.muted,
      "--accent": activeTheme.palette.accent,
      "--accent-bg": activeTheme.palette.accentBg,
      "--glass": activeTheme.palette.glass,
      "--danger": activeTheme.palette.danger,
      "--on-accent": activeTheme.palette.onAccent,
    };
    for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
    localStorage.setItem("loopsite-theme", theme);
  }, [theme, activeTheme]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.density = uiSize;
    localStorage.setItem("loopsite-ui-size", uiSize);
  }, [uiSize]);

  useEffect(() => {
    let alive = true;
    const refresh = () => invoke<RunningServer[]>("list_running_servers").then(data => {
      if (alive) setRunning(data);
    }).catch(err => { if (alive) setError("Serverstatus: " + getError(err)); });
    void refresh();
    const refreshProxy = () => invoke<ProxyStatus>("proxy_status").then(data => {
      if (alive) setProxy(data);
    }).catch(err => { if (alive) setError("Proxy-Status: " + getError(err)); });
    void refreshProxy();
    const timer = window.setInterval(() => { refresh(); refreshProxy(); }, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  async function toggleProxy() {
    if (!proxy.running && (!/^[0-9]+$/.test(proxyPort) || Number(proxyPort) < 1 || Number(proxyPort) > 65535)) {
      setError("Proxy-Port muss zwischen 1 und 65535 liegen."); return;
    }
    setProxyBusy(true); setError("");
    try {
      if (proxy.running) {
        await invoke("stop_proxy");
      } else {
        await invoke("start_proxy", { port: Number(proxyPort) });
      }
      setProxy(await invoke<ProxyStatus>("proxy_status"));
    } catch (err) {
      setError("Domain-Routing: " + getError(err));
    } finally { setProxyBusy(false); }
  }
  function showProxyLog() {
    setLogTarget({ kind: "proxy", title: "Caddy · Reverse Proxy" });
  }
  async function openDomainUrl(hostname: string) {
    if (!proxy.running || proxy.port === null) return;
    const port = proxy.port === 80 ? "" : ":" + proxy.port;
    try { await openUrl("http://" + hostname + port); }
    catch (err) { setError("Domain konnte nicht geöffnet werden: " + getError(err)); }
  }
  async function toggleServer(projectId: string, serverId: string, isRunning: boolean) {
    setBusy(true); setError("");
    try {
      await invoke(isRunning ? "stop_server" : "start_server", { projectId, serverId });
      setRunning(await invoke<RunningServer[]>("list_running_servers"));
    } catch (err) { setError("Server konnte nicht " + (isRunning ? "gestoppt" : "gestartet") + " werden: " + getError(err)); }
    finally { setBusy(false); }
  }
  function showLog(projectId: string, serverId: string) {
    const project = projects.find(p => p.id === projectId);
    const server = project?.servers.find(s => s.id === serverId);
    setLogTarget({ kind: "php", projectId, serverId,
      title: (project?.name ?? "Projekt") + " / " + (server?.name ?? "PHP") });
  }
  async function openServerUrl(port: number) {
    try { await openUrl("http://127.0.0.1:" + port); }
    catch (err) { setError("Browser konnte nicht geöffnet werden: " + getError(err)); }
  }

  async function refreshPhp() {
    setPhpBusy(true);
    try {
      setPhpRuntimes(await invoke<PhpRuntime[]>("list_php_runtimes"));
    } catch (err) {
      setError("PHP-Erkennung: " + getError(err));
    } finally { setPhpBusy(false); }
  }
  async function addPhpRuntime() {
    try {
      const path = await open({ multiple: false, directory: false, title: "PHP-CLI auswählen (php.exe / php8.x)" });
      if (typeof path !== "string") return;
      setPhpBusy(true);
      const runtime = await invoke<PhpRuntime>("register_php_runtime", { path });
      setServerPhpPath(runtime.path);
      setPhpRuntimes(await invoke<PhpRuntime[]>("list_php_runtimes"));
      setError("");
    } catch (err) {
      setError("PHP konnte nicht hinzugefügt werden: " + getError(err));
    } finally { setPhpBusy(false); }
  }

  useEffect(() => {
    void invoke<PhpRuntime[]>("list_php_runtimes").then(setPhpRuntimes)
      .catch(err => setError("PHP-Erkennung: " + getError(err)));
  }, []);

  const selected = useMemo(() => projects.find(p => p.id === selectedId) ?? null, [projects, selectedId]);

  async function persist(next: Project[]) {
    setBusy(true);
    setError("");
    try {
      await invoke("save_projects", { projects: next });
      setProjects(next);
      return true;
    } catch (err) {
      setError("Speichern fehlgeschlagen: " + getError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function chooseDir(setter: (path: string) => void) {
    try {
      const path = await open({ directory: true, multiple: false, title: "Projektordner auswählen" });
      if (typeof path === "string") setter(path);
    } catch (err) { setError("Ordnerauswahl fehlgeschlagen: " + getError(err)); }
  }
  function openProject() {
    setProjectName(""); setProjectRoot(""); setDialog("project"); setError("");
  }
  function openServer() {
    if (!selected) return;
    setServerName(""); setServerRoot(selected.rootPath);
    setServerPort(String(suggestPort(projects)));
    setServerRuntime("php"); setServerRouter(""); setServerLan(false);
    setServerPhpPath(phpRuntimes[0]?.path ?? ""); setEditingServerId(null);
    void refreshPhp();
    setDialog("server"); setError("");
  }
  function editServer(server: ServerConfig) {
    if (!selected) return;
    if (running.some(r => r.projectId === selected.id && r.serverId === server.id)) {
      setError("Bitte den Server stoppen, bevor du seine Konfiguration änderst."); return;
    }
    setServerName(server.name); setServerRoot(server.rootPath);
    setServerPort(String(server.port)); setServerRuntime(server.runtime);
    setServerRouter(server.routerFile ?? ""); setServerLan(server.lanAccess);
    setServerPhpPath(server.phpExecutablePath ?? "");
    setEditingServerId(server.id); setDialog("server"); setError("");
    void refreshPhp();
  }

  function openDomain() {
    if (!selected || selected.servers.length === 0) return;
    setDomainHost(""); setDomainServerId(selected.servers[0].id);
    setDomainHttps(false); setDialog("domain"); setError("");
  }
  async function createProject() {
    if (!projectName.trim() || !projectRoot.trim()) { setError("Name und Projektordner sind erforderlich."); return; }
    const project: Project = { id: uid(), name: projectName.trim(), rootPath: projectRoot.trim(), servers: [], domains: [] };
    if (await persist([...projects, project])) { setSelectedId(project.id); setDialog(null); }
  }
  async function createServer() {
    if (!selected) return;
    const port = Number(serverPort);
    if (!serverName.trim() || !serverRoot.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Servername, Ordner und gültiger Port (1–65535) sind erforderlich."); return;
    }
    if (projects.some(p => p.servers.some(s => s.port === port && s.id !== editingServerId))) {
      setError("Dieser Port ist bereits einem anderen Server zugewiesen."); return;
    }
    const server: ServerConfig = {
      id: editingServerId ?? uid(), name: serverName.trim(), rootPath: serverRoot.trim(), port,
      runtime: serverRuntime, phpExecutablePath: serverRuntime === "php" ? serverPhpPath || null : null,
      routerFile: serverRouter.trim() || null, lanAccess: serverLan
    };
    const next = projects.map(p => p.id === selected.id ? {
      ...p,
      servers: editingServerId
        ? p.servers.map(s => s.id === editingServerId ? server : s)
        : [...p.servers, server]
    } : p);
    if (await persist(next)) setDialog(null);
  }
  async function createDomain() {
    if (!selected) return;
    const host = domainHost.trim().toLowerCase();
    if (!validHost(host)) { setError("Bitte einen gültigen Hostnamen angeben, z. B. api.projekt.localhost."); return; }
    if (projects.some(p => p.domains.some(d => d.hostname.toLowerCase() === host))) {
      setError("Dieser Hostname ist bereits vergeben."); return;
    }
    if (!selected.servers.some(s => s.id === domainServerId)) { setError("Zielserver auswählen."); return; }
    const domain: DomainRoute = { id: uid(), hostname: host, serverId: domainServerId, https: domainHttps };
    const next = projects.map(p => p.id === selected.id ? { ...p, domains: [...p.domains, domain] } : p);
    if (await persist(next)) setDialog(null);
  }
  async function deleteProject(project: Project) {
    if (running.some(r => r.projectId === project.id)) { setError("Bitte alle Server dieses Projekts zuerst stoppen."); return; }
    if (!window.confirm('Projekt "' + project.name + '" aus LoopSite entfernen? Dateien auf der Festplatte bleiben erhalten.')) return;
    const next = projects.filter(p => p.id !== project.id);
    if (await persist(next)) setSelectedId(next[0]?.id ?? null);
  }
  async function deleteServer(server: ServerConfig) {
    if (!selected) return;
    if (selected.domains.some(d => d.serverId === server.id)) {
      setError("Entferne zuerst die Domains, die auf diesen Server verweisen."); return;
    }
    if (running.some(r => r.serverId === server.id && r.projectId === selected.id)) { setError("Bitte den Server zuerst stoppen."); return; }
    if (!window.confirm('Server "' + server.name + '" aus der Konfiguration entfernen?')) return;
    await persist(projects.map(p => p.id === selected.id
      ? { ...p, servers: p.servers.filter(s => s.id !== server.id) } : p));
  }
  async function deleteDomain(domain: DomainRoute) {
    if (!selected) return;
    await persist(projects.map(p => p.id === selected.id
      ? { ...p, domains: p.domains.filter(d => d.id !== domain.id) } : p));
  }

  useEffect(() => {
    if (!editorDirty) return;
    const block = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", block);
    return () => window.removeEventListener("beforeunload", block);
  }, [editorDirty]);

  function navigate(next: Panel) {
    if (panel === next) return;
    if (panel === "editor" && editorDirty &&
        !window.confirm("Ungespeicherte Editoränderungen verwerfen?")) return;
    setEditorDirty(false);
    setPanel(next);
  }
  function switchEditorProject(id: string) {
    if (selectedId === id) return;
    if (editorDirty && !window.confirm("Ungespeicherte Editoränderungen verwerfen?")) return;
    setEditorDirty(false);
    setSelectedId(id);
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><img className="brand-image" src="/loopsite-logo.png" alt="LoopSite Studio" /><div><strong>LoopSite Studio</strong><small>Local Development Environment</small></div></div>
      <nav>
        <button className={panel === "projects" ? "nav active" : "nav"} onClick={() => navigate("projects")}>▦ <span>{t("projects")}</span></button>
        <button className={panel === "routing" ? "nav active" : "nav"} onClick={() => navigate("routing")}>◉ <span>{t("routing")}</span></button>
        <button className={panel === "editor" ? "nav active" : "nav"} onClick={() => navigate("editor")}>▤ <span>{t("editor")}</span></button>
        <button className={panel === "databases" ? "nav active" : "nav"} onClick={() => navigate("databases")}>▤ <span>{t("databases")}</span></button>
        <button className={panel === "php" ? "nav active" : "nav"} onClick={() => navigate("php")}>⌘ <span>{t("runtimes")}</span></button>
        <button className={panel === "setup" ? "nav active" : "nav"} onClick={() => navigate("setup")}>↓ <span>{t("setup")}</span></button>
        <button className={panel === "settings" ? "nav active" : "nav"} onClick={() => navigate("settings")}>⚙ <span>{t("settings")}</span></button>
      </nav>
      <div className="sidebar-note">{t("tagline")}</div>
      <div className="sidebar-version" title={appVersion}>v{appVersion} · {experimentalBuild ? t("experimental") : t("development")}</div>
    </aside>
    <main className="main">
      {error && <div className="notice error" role="alert">{error}<button onClick={() => setError("")} aria-label="Fehler schließen">×</button></div>}
      {panel === "setup" ? <RuntimeInstallPanel onInstalled={() => { void refreshPhp(); }} /> : panel === "databases" ? <>
        <div className="db-engine-switch" role="group" aria-label="Datenbanktyp">
          <button className={dbEngine === "sqlite" ? "selected" : ""} onClick={() => setDbEngine("sqlite")}>SQLite</button>
          <button className={dbEngine === "maria" ? "selected" : ""} onClick={() => setDbEngine("maria")}>MariaDB / MySQL</button>
        </div>
        {dbEngine === "sqlite"
          ? <DatabasePanel project={selected} projects={projects} onSelectProject={setSelectedId}/>
          : <MariaPanel/>}
      </> : panel === "php" ? <section>
        <div className="page-heading">
          <div><p className="eyebrow">RUNTIMES</p><h1>PHP-Laufzeiten</h1>
            <p>Erkannte PHP-Versionen verwalten und einzelnen Servern zuordnen.</p></div>
          <div className="php-actions">
            <button className="secondary" disabled={phpBusy} onClick={() => void refreshPhp()}>Erneut suchen</button>
            <button className="primary" disabled={phpBusy} onClick={() => void addPhpRuntime()}>+ PHP auswählen</button>
            <button className="secondary" onClick={() => navigate("setup")}>PHP installieren</button>
          </div>
        </div>
        <div className="card settings">
          <div className="section-head" style={{marginTop:0}}>
            <h2>Installierte PHP-Versionen</h2><span className="status">{phpRuntimes.length} gefunden</span>
          </div>
          {phpRuntimes.map((runtime, index) => <article className="item-card" key={runtime.path}>
            <div><strong>PHP {runtime.version}</strong>
              <p>{runtime.path}</p><small>{runtime.source}</small>
            </div>
            {index === 0 && <span className="status">Automatische Auswahl</span>}
          </article>)}
          {phpRuntimes.length === 0 && <div className="empty-section">
            Keine PHP-CLI gefunden. Du kannst eine vorhandene Version auswählen oder PHP direkt über „Einrichtung“ installieren.
          </div>}
          <p className="hint">Im Automatikmodus verwendet LoopSite die höchste erkannte stabile PHP-Version.
            Bestehende Server mit fest zugewiesener Version bleiben unverändert.
            Unter „Einrichtung“ kannst du fehlendes PHP über den System-Paketmanager installieren.</p>
        </div>
      </section> : panel === "editor" ? <EditorPanel project={selected} projects={projects} theme={activeTheme.id}
        onSelectProject={switchEditorProject} onDirtyChange={setEditorDirty}/> : panel === "settings" ? <section>
        <div className="page-heading"><div><p className="eyebrow">ANPASSUNG</p><h1>Einstellungen</h1><p>Darstellung von LoopSite Studio.</p></div></div>
        <div className="card settings"><div className="theme-settings-header">
          <div><h2>Farbschema</h2>
            <p>Einheitliche Farbpalette in allen Bereichen. Systemstandard übernimmt automatisch den Hell-/Dunkelmodus.</p></div>
          <span className="theme-current">Aktiv: {theme === "system" ? "Systemstandard" : activeTheme.label}</span>
        </div>
          <div className="theme-grid">
            <button aria-pressed={theme === "system"} className={"theme-select " + (theme === "system" ? "chosen" : "")}
              onClick={() => setTheme("system")}>
              <span className="theme-preview theme-preview-system" aria-hidden="true">
                <i className="theme-preview-bar"/><i className="theme-preview-card"/><i className="theme-preview-accent"/>
              </span>
              <strong>Systemstandard</strong><small>Automatisch · Hell/Dunkel</small>
            </button>
            {THEME_OPTIONS.map(item => <button key={item.id}
              aria-pressed={theme === item.id} className={"theme-select " + (theme === item.id ? "chosen" : "")}
              onClick={() => setTheme(item.id)}>
              <span className="theme-preview" aria-hidden="true"
                style={{
                  background: item.palette.bg,
                  color: item.palette.text,
                  borderColor: item.palette.line,
                  ["--preview-sidebar" as string]: item.palette.sidebar,
                  ["--preview-panel" as string]: item.palette.panel,
                  ["--preview-accent" as string]: item.palette.accent,
                }}>
                <i className="theme-preview-bar"/><i className="theme-preview-card"/><i className="theme-preview-accent"/>
              </span>
              <strong>{item.label}</strong><small>{item.description}</small>
            </button>)}
          </div>
          <div className="ui-size-settings">
            <h3>{t("language")}</h3><p>{t("languageHint")}</p>
            <label className="language-select-label">{t("language")}
              <select value={language} onChange={event => setLanguage(event.target.value as Language)}>
                {languages.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
          </div>
          <div className="ui-size-settings">
            <h3>{t("updates")}</h3>
            <label className="checkbox-label">
              <input type="checkbox" checked={experimentalBuild || includeExperimental}
                disabled={experimentalBuild}
                onChange={event => setIncludeExperimental(event.target.checked)}/>
              {t("ignoreExperiments")}
            </label>
            <p>{t("ignoreHint")}</p>
          </div>
          <div className="ui-size-settings">
            <h3>Updates</h3>
            <p>Beim Programmstart wird automatisch nach veröffentlichten Updates gesucht. Vor einer
              Installation werden die Changenotes angezeigt. Du entscheidest zwischen
              Update, Later und Skip Update.</p>
            <div className="update-settings">
              <span role="status">{updateStatus}</span>
              <button className="secondary" type="button"
                onClick={() => setUpdateCheckSignal(value => value + 1)}>
                Jetzt nach Updates suchen
              </button>
            </div>
          </div>
          <div className="ui-size-settings">
            <h3>UI-Größe</h3>
            <p>Skaliert sämtliche Bedienelemente und Texte. Die Einstellung wird gespeichert.</p>
            <div className="ui-size-options" role="group" aria-label="Größe der Benutzeroberfläche">
              {(["compact","normal","large"] as const).map(size =>
                <button key={size} className={uiSize === size ? "secondary selected" : "secondary"}
                  aria-pressed={uiSize === size} onClick={() => setUiSize(size)}>
                  {size === "compact" ? "Compact" : size === "normal" ? "Normal" : "Large"}
                </button>)}
            </div>
          </div>
        </div>
      </section> : panel === "routing" ? <section>
        <div className="page-heading"><div><p className="eyebrow">LOCAL ROUTING</p><h1>Domains &amp; Subdomains</h1>
          <p>Lokale Hostnamen aller Projekte über einen gemeinsamen HTTP-Proxy erreichen.</p></div></div>
        <div className="card settings" style={{marginBottom:22}}>
          <div className="section-head" style={{marginTop:0}}>
            <div><h3>Lokaler Reverse Proxy</h3><p>Benötigt Caddy im System-PATH. Standardport 8080 ist ohne Administratorrechte nutzbar.</p></div>
            <span className="status">{proxy.running ? "Läuft" : "Gestoppt"}</span>
          </div>
          <div className="proxy-actions">
            <label>Proxy-Port<input type="number" min="1" max="65535" value={proxy.running && proxy.port ? proxy.port : proxyPort}
              onChange={e => setProxyPort(e.target.value)} disabled={proxy.running || proxyBusy} /></label>
            <button className="primary" onClick={() => void toggleProxy()} disabled={proxyBusy || busy}>
              {proxyBusy ? "Bitte warten …" : proxy.running ? "Proxy stoppen" : "Proxy starten"}
            </button>
            <button className="secondary" onClick={() => void showProxyLog()}>Log anzeigen</button>
            <button className="secondary" onClick={() => navigate("setup")}>Caddy installieren</button>
          </div>
          <p className="hint">Routing ist aktuell HTTP-only. HTTPS folgt; fehlendes Caddy kann unter „Einrichtung“ über den System-Paketmanager installiert werden. Für .localhost-Domains kann die lokale Auflösung verwendet werden; andere Domains benötigen eine passende hosts-/DNS-Konfiguration. Nach Domainänderungen den Proxy neu starten. Der Proxy bindet ausschließlich an 127.0.0.1.</p>
        </div>
        <div className="card settings">
          <h2>Aktuelle Domain-Zuordnungen</h2>
          {projects.flatMap(p => p.domains.map(d => {
            const server = p.servers.find(s => s.id === d.serverId);
            return <article className="item-card" key={p.id + "/" + d.id}>
              <div><strong>{d.hostname}</strong><p>{p.name} → {server?.name ?? "Kein Server"} (:{server?.port ?? "?"})</p></div>
              <button className="secondary" disabled={!proxy.running} onClick={() => void openDomainUrl(d.hostname)}>Öffnen</button>
            </article>;
          }))}
          {projects.every(p => p.domains.length === 0) && <div className="empty-section">Noch keine Domains eingerichtet. Lege sie im jeweiligen Projekt an.</div>}
        </div>
      </section> : <section>
        <div className="page-heading"><div><p className="eyebrow">WORKSPACE</p><h1>Meine Projekte</h1><p>Jedes Projekt verwaltet eigene Server und Domains.</p></div><button className="primary" onClick={openProject} disabled={busy}>+ Neues Projekt</button></div>
        <div className="workspace">
          <div className="project-list">
            <h2>Projekte <span>{projects.length}</span></h2>
            {projects.map(p => <button key={p.id} className={"project-item " + (p.id === selectedId ? "selected" : "")} onClick={() => setSelectedId(p.id)}>
              <strong>▣ {p.name}</strong><small>{p.servers.length} Server · {p.domains.length} Domains</small>
            </button>)}
            {!busy && projects.length === 0 && <div className="empty-list">Noch keine Projekte vorhanden.</div>}
          </div>
          <div className="project-detail">
            {busy && projects.length === 0 ? <div className="empty">Konfiguration wird geladen …</div> :
            !selected ? <div className="empty"><h2>Dein erstes Projekt</h2><p>Wähle einen Ordner und lege ein Projekt an. Danach kannst du mehrere Server und Domains hinzufügen.</p><button className="primary" onClick={openProject}>Projekt erstellen</button></div> :
            <>
              <div className="detail-header"><div><p className="eyebrow">PROJEKT</p><h2>{selected.name}</h2><code title={selected.rootPath}>{selected.rootPath}</code></div><button className="subtle danger" onClick={() => void deleteProject(selected)} disabled={busy}>Projekt entfernen</button></div>
              <div className="section-head"><div><h3>Server</h3><p>Unabhängige Prozesse innerhalb dieses Projekts.</p></div><button className="secondary" onClick={openServer} disabled={busy}>+ Server</button></div>
              {selected.servers.length === 0 && <div className="empty-section">Noch keine Server konfiguriert.</div>}
              {selected.servers.map(s => <article className="item-card" key={s.id}>
                <div><strong>{s.name}</strong><p>{s.runtime.toUpperCase()} · 127.0.0.1:{s.port}{s.routerFile ? " · Router: " + s.routerFile : ""}</p>
                  {s.runtime === "php" && <p>PHP: {s.phpExecutablePath ? (phpRuntimes.find(r => r.path === s.phpExecutablePath)?.version ?? "Fest zugewiesene Laufzeit") : "Automatisch (neueste erkannte Version)"}</p>}
                  <small>{s.rootPath}</small></div>
                <div className="item-right">
                  <span className="status">{running.some(r => r.projectId === selected.id && r.serverId === s.id) ? "Läuft" : "Gestoppt"}</span>
                  {running.some(r => r.projectId === selected.id && r.serverId === s.id) && <>
                    <button className="secondary" title="Im Browser öffnen" onClick={() => void openServerUrl(s.port)}>Öffnen</button>
                    
                  </>}
                  <button className="secondary" disabled={busy} onClick={() => editServer(s)}>Einstellungen</button>
                  {s.runtime === "php" && <button className="secondary" onClick={() => void showLog(selected.id, s.id)}>Log</button>}
                  <button className="secondary" disabled={busy || s.runtime === "custom"} onClick={() => void toggleServer(selected.id, s.id, running.some(r => r.projectId === selected.id && r.serverId === s.id))}>
                    {running.some(r => r.projectId === selected.id && r.serverId === s.id) ? "Stoppen" : "Starten"}
                  </button>
                  <button className="icon-button" title="Server entfernen" onClick={() => void deleteServer(s)} disabled={busy}>×</button>
                </div>
              </article>)}
              <div className="section-head"><div><h3>Domains & Subdomains</h3><p>Hostnamen auf vorhandene Server routen.</p></div><button className="secondary" onClick={openDomain} disabled={busy || selected.servers.length === 0}>+ Domain</button></div>
              {selected.domains.length === 0 && <div className="empty-section">Noch keine Domains konfiguriert.</div>}
              {selected.domains.map(d => {
                const server = selected.servers.find(s => s.id === d.serverId);
                return <article className="item-card" key={d.id}><div><strong>{d.hostname}</strong><p>HTTP → {server?.name ?? "Unbekannter Server"} :{server?.port}{d.https ? " · HTTPS geplant" : ""}</p></div>
                  <button className="icon-button" title="Domain entfernen" onClick={() => void deleteDomain(d)} disabled={busy}>×</button></article>;
              })}
              <div className="hint">PHP- und statische Server können gestartet und gestoppt werden. Das lokale HTTP-Domain-Routing findest du unter Routing. Runtime-Downloads und Datenbanken folgen später.</div>
            </>}
          </div>
        </div>
      </section>}
    </main>
    <UpdateManager checkSignal={updateCheckSignal} onStatus={setUpdateStatus}
      includeExperimental={experimentalBuild || includeExperimental} installedExperimental={experimentalBuild}
      editorDirty={editorDirty} runningServers={running.length}/>
    {logTarget && <LogViewer target={logTarget} onClose={() => setLogTarget(null)} />}
    {dialog && <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
      <form className="modal" onSubmit={event => { event.preventDefault(); void (dialog === "project" ? createProject() : dialog === "server" ? createServer() : createDomain()); }}>
        <h2>{dialog === "project" ? "Neues Projekt" : dialog === "server" ? (editingServerId ? "Server bearbeiten" : "Server hinzufügen") : "Domain hinzufügen"}</h2>
        {dialog === "project" && <>
          <label>Projektname<input autoFocus value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="z. B. HybrideUniverse" required maxLength={80}/></label>
          <label>Projektordner<div className="field-row"><input value={projectRoot} onChange={e => setProjectRoot(e.target.value)} placeholder="Vorhandenen Ordner auswählen" required/><button type="button" className="secondary" onClick={() => void chooseDir(setProjectRoot)}>Wählen</button></div></label>
        </>}
        {dialog === "server" && <>
          <label>Servername<input autoFocus value={serverName} onChange={e => setServerName(e.target.value)} placeholder="z. B. Shared API" required maxLength={80}/></label>
          <label>Document Root<div className="field-row"><input value={serverRoot} onChange={e => setServerRoot(e.target.value)} required/><button type="button" className="secondary" onClick={() => void chooseDir(setServerRoot)}>Wählen</button></div></label>
          <div className="field-row"><label className="grow">Runtime<select value={serverRuntime} onChange={e => setServerRuntime(e.target.value as Runtime)}><option value="php">PHP</option><option value="static">Statisch (HTML/CSS/JS)</option><option value="custom">Benutzerdefiniert (geplant)</option></select></label><label className="port-field">Port<input type="number" min="1" max="65535" value={serverPort} onChange={e => setServerPort(e.target.value)} required/></label></div>
          {serverRuntime === "php" && <label>PHP-Version
            <div className="field-row">
              <select value={serverPhpPath} onChange={e => setServerPhpPath(e.target.value)} className="grow">
                <option value="">Automatisch – höchste erkannte Version</option>
                {serverPhpPath && !phpRuntimes.some(r => r.path === serverPhpPath) &&
                  <option value={serverPhpPath}>Bisheriger Pfad (momentan nicht erkannt)</option>}
                {phpRuntimes.map(runtime => <option key={runtime.path} value={runtime.path}>
                  PHP {runtime.version} – {runtime.path}
                </option>)}
              </select>
              <button type="button" className="secondary" disabled={phpBusy} onClick={() => void addPhpRuntime()}>PHP auswählen</button>
            </div>
          </label>}
          <label>PHP-Router (optional)<input value={serverRouter} onChange={e => setServerRouter(e.target.value)} placeholder="router.php" /></label>
          <label className="checkbox-label"><input type="checkbox" checked={serverLan} onChange={e => setServerLan(e.target.checked)}/> LAN-Zugriff aktivieren (nur für vertrauenswürdige lokale Netzwerke)</label>
        </>}
        {dialog === "domain" && <>
          <label>Hostname<input autoFocus value={domainHost} onChange={e => setDomainHost(e.target.value)} placeholder="api.meinprojekt.localhost" required/></label>
          <label>Zielserver<select value={domainServerId} onChange={e => setDomainServerId(e.target.value)}>{selected?.servers.map(s => <option key={s.id} value={s.id}>{s.name} (:{s.port})</option>)}</select></label>
          <div className="hint">.localhost funktioniert in vielen lokalen Browsern ohne hosts-Datei. Eigene Domains erfordern eine lokale Namensauflösung. HTTPS ist noch nicht implementiert.</div>
        </>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialog(null)} disabled={busy}>Abbrechen</button><button type="submit" className="primary" disabled={busy}>Speichern</button></div>
      </form>
    </div>}
  </div>;
}
