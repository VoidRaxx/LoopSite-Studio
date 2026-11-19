import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import type { DomainRoute, Project, Runtime, ServerConfig, Theme } from "./types";

type Panel = "projects" | "routing" | "settings";
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [proxy, setProxy] = useState<ProxyStatus>({ running: false, port: null, hostnameCount: 0 });
  const [proxyPort, setProxyPort] = useState("8080");
  const [proxyBusy, setProxyBusy] = useState(false);
  const [running, setRunning] = useState<RunningServer[]>([]);
  const [activeLog, setActiveLog] = useState<string | null>(null);
  const [logText, setLogText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("projects");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("loopsite-theme");
    return saved === "dark" || saved === "white" ? saved : "hu";
  });
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
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("loopsite-theme", theme);
  }, [theme]);

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
  async function showProxyLog() {
    try {
      const log = await invoke<string>("read_proxy_log");
      setLogText(log); setActiveLog("proxy");
    } catch (err) { setError("Proxy-Log: " + getError(err)); }
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
  async function showLog(projectId: string, serverId: string) {
    setError("");
    try {
      const log = await invoke<string>("read_server_log", { projectId, serverId });
      setLogText(log); setActiveLog(serverId);
    } catch (err) { setError("Log konnte nicht geöffnet werden: " + getError(err)); }
  }
  async function openServerUrl(port: number) {
    try { await openUrl("http://127.0.0.1:" + port); }
    catch (err) { setError("Browser konnte nicht geöffnet werden: " + getError(err)); }
  }

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
    setDialog("server"); setError("");
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
    if (projects.some(p => p.servers.some(s => s.port === port))) {
      setError("Dieser Port ist bereits einem anderen Server zugewiesen."); return;
    }
    const server: ServerConfig = {
      id: uid(), name: serverName.trim(), rootPath: serverRoot.trim(), port,
      runtime: serverRuntime, routerFile: serverRouter.trim() || null, lanAccess: serverLan
    };
    const next = projects.map(p => p.id === selected.id ? { ...p, servers: [...p.servers, server] } : p);
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

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><img className="brand-image" src="/loopsite-logo.png" alt="LoopSite Studio" /><div><strong>LoopSite Studio</strong><small>Local Development Environment</small></div></div>
      <nav>
        <button className={panel === "projects" ? "nav active" : "nav"} onClick={() => setPanel("projects")}>▦ <span>Projekte</span></button>
        <button className={panel === "routing" ? "nav active" : "nav"} onClick={() => setPanel("routing")}>◉ <span>Routing</span></button>
        <button className={panel === "settings" ? "nav active" : "nav"} onClick={() => setPanel("settings")}>⚙ <span>Einstellungen</span></button>
      </nav>
      <div className="sidebar-note">Lokal. Privat. Unter deiner Kontrolle.</div>
    </aside>
    <main className="main">
      {error && <div className="notice error" role="alert">{error}<button onClick={() => setError("")} aria-label="Fehler schließen">×</button></div>}
      {panel === "settings" ? <section>
        <div className="page-heading"><div><p className="eyebrow">ANPASSUNG</p><h1>Einstellungen</h1><p>Darstellung von LoopSite Studio.</p></div></div>
        <div className="card settings"><h2>Design</h2><p>Wähle ein Theme. Die Auswahl wird lokal gespeichert.</p>
          <div className="theme-grid">
            {(["hu","dark","white"] as Theme[]).map(id => <button key={id} className={"theme-select " + (theme === id ? "chosen" : "")} onClick={() => setTheme(id)}>
              <span className={"theme-preview preview-" + id}></span>
              <strong>{id === "hu" ? "HybrideUniverse" : id === "dark" ? "Dark" : "White"}</strong>
            </button>)}
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
            {proxy.running && <button className="secondary" onClick={() => void showProxyLog()}>Log anzeigen</button>}
          </div>
          <p className="hint">Routing ist aktuell HTTP-only. HTTPS und automatische Caddy-Installation folgen. Für .localhost-Domains kann die lokale Auflösung verwendet werden; andere Domains benötigen eine passende hosts-/DNS-Konfiguration. Nach Domainänderungen den Proxy neu starten. Der Proxy bindet ausschließlich an 127.0.0.1.</p>
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
                <div><strong>{s.name}</strong><p>{s.runtime.toUpperCase()} · 127.0.0.1:{s.port}{s.routerFile ? " · Router: " + s.routerFile : ""}</p><small>{s.rootPath}</small></div>
                <div className="item-right">
                  <span className="status">{running.some(r => r.projectId === selected.id && r.serverId === s.id) ? "Läuft" : "Gestoppt"}</span>
                  {running.some(r => r.projectId === selected.id && r.serverId === s.id) && <>
                    <button className="secondary" title="Im Browser öffnen" onClick={() => void openServerUrl(s.port)}>Öffnen</button>
                    {s.runtime === "php" && <button className="secondary" onClick={() => void showLog(selected.id, s.id)}>Log</button>}
                  </>}
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
              <div className="hint">PHP- und statische Server können lokal gestartet und gestoppt werden. Domain-Routing, Runtime-Downloads und Datenbanken folgen in späteren Entwicklungsschritten.</div>
            </>}
          </div>
        </div>
      </section>}
    </main>
    {activeLog && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setActiveLog(null); }}><div className="modal"><h2>{activeLog === "proxy" ? "Reverse-Proxy-Protokoll" : "PHP-Serverprotokoll"}</h2><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:"55vh",overflow:"auto",fontSize:12}}>{logText || "Keine Ausgabe vorhanden."}</pre><button className="secondary" onClick={() => setActiveLog(null)}>Schließen</button></div></div>}
    {dialog && <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
      <form className="modal" onSubmit={event => { event.preventDefault(); void (dialog === "project" ? createProject() : dialog === "server" ? createServer() : createDomain()); }}>
        <h2>{dialog === "project" ? "Neues Projekt" : dialog === "server" ? "Server hinzufügen" : "Domain hinzufügen"}</h2>
        {dialog === "project" && <>
          <label>Projektname<input autoFocus value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="z. B. HybrideUniverse" required maxLength={80}/></label>
          <label>Projektordner<div className="field-row"><input value={projectRoot} onChange={e => setProjectRoot(e.target.value)} placeholder="Vorhandenen Ordner auswählen" required/><button type="button" className="secondary" onClick={() => void chooseDir(setProjectRoot)}>Wählen</button></div></label>
        </>}
        {dialog === "server" && <>
          <label>Servername<input autoFocus value={serverName} onChange={e => setServerName(e.target.value)} placeholder="z. B. Shared API" required maxLength={80}/></label>
          <label>Document Root<div className="field-row"><input value={serverRoot} onChange={e => setServerRoot(e.target.value)} required/><button type="button" className="secondary" onClick={() => void chooseDir(setServerRoot)}>Wählen</button></div></label>
          <div className="field-row"><label className="grow">Runtime<select value={serverRuntime} onChange={e => setServerRuntime(e.target.value as Runtime)}><option value="php">PHP</option><option value="static">Statisch (HTML/CSS/JS)</option><option value="custom">Benutzerdefiniert (geplant)</option></select></label><label className="port-field">Port<input type="number" min="1" max="65535" value={serverPort} onChange={e => setServerPort(e.target.value)} required/></label></div>
          <label>PHP-Router (optional)<input value={serverRouter} onChange={e => setServerRouter(e.target.value)} placeholder="router.php" /></label>
          <label className="checkbox-label"><input type="checkbox" checked={serverLan} onChange={e => setServerLan(e.target.checked)}/> LAN-Zugriff später erlauben (standardmäßig aus)</label>
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
