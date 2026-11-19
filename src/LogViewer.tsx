import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export type LogTarget =
  | { kind: "php"; projectId: string; serverId: string; title: string }
  | { kind: "proxy"; title: string };

type LogLevel = "error" | "warning" | "request" | "info" | "plain";
type Filter = "all" | "error" | "warning" | "request";

function levelOf(line: string): LogLevel {
  if (/\b(fatal error|parse error|uncaught|failed opening|required|error:|panic|failed to open)\b/i.test(line)) return "error";
  if (/\bwarning\b|\bdeprecated\b/i.test(line)) return "warning";
  if (/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/|\[[1-5][0-9]{2}\]:\s*(?:GET|POST)/i.test(line)) return "request";
  if (/\b(started|accepted|closing|closed|listening|ready|connected)\b/i.test(line)) return "info";
  return "plain";
}

export default function LogViewer({ target, onClose }: { target: LogTarget; onClose: () => void }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [follow, setFollow] = useState(true);
  const [working, setWorking] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const request = target.kind === "php"
    ? { command: "read_server_log", args: { projectId: target.projectId, serverId: target.serverId } }
    : { command: "read_proxy_log", args: {} };

  useEffect(() => {
    let active = true;
    const refresh = () => {
      invoke<string>(request.command, request.args)
        .then(content => { if (active) { setRaw(content); setError(""); } })
        .catch(err => {
          if (active) setError(String(err));
        });
    };
    refresh();
    if (!live) return () => { active = false; };
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [target, live]);

  const lines = useMemo(() => {
    const query = search.toLocaleLowerCase();
    return raw.split(/\r?\n/).filter(Boolean).map((text, index) => ({
      text, index, level: levelOf(text),
    })).filter(line =>
      (filter === "all" || line.level === filter) &&
      (!query || line.text.toLocaleLowerCase().includes(query))
    );
  }, [raw, search, filter]);

  useEffect(() => {
    if (follow && viewRef.current) {
      viewRef.current.scrollTop = viewRef.current.scrollHeight;
    }
  }, [lines, follow]);

  async function copy() {
    try {
      await writeText(raw);
      setNotice("Log in Zwischenablage kopiert.");
      setError("");
    } catch (err) {
      setError("Kopieren fehlgeschlagen: " + String(err));
    }
  }

  async function clear() {
    if (!window.confirm("Die bisherige Logausgabe wirklich leeren?")) return;
    setWorking(true); setError("");
    try {
      if (target.kind === "php") {
        await invoke("clear_server_log", { projectId: target.projectId, serverId: target.serverId });
      } else {
        await invoke("clear_proxy_log");
      }
      setRaw("");
      setNotice("Log geleert. Neue Servermeldungen werden weiterhin angezeigt.");
    } catch (err) {
      setError("Leeren fehlgeschlagen: " + String(err));
    } finally {
      setWorking(false);
    }
  }

  return <div className="overlay" onMouseDown={event => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <section className="log-window" role="dialog" aria-modal="true" aria-label={target.title}>
      <div className="log-header">
        <div><p className="eyebrow">SERVER-KONSOLE</p><h2>{target.title}</h2>
          <p>Letzte 32 KiB der Protokolldatei · {raw.split(/\r?\n/).filter(Boolean).length} Zeilen</p>
        </div>
        <button className="icon-button" onClick={onClose} title="Schließen" aria-label="Logfenster schließen">×</button>
      </div>
      <div className="log-controls">
        <input className="log-search" type="search" aria-label="Log durchsuchen"
          value={search} onChange={e => setSearch(e.target.value)} placeholder="Meldungen durchsuchen …"/>
        <select aria-label="Logfilter" value={filter} onChange={e => setFilter(e.target.value as Filter)}>
          <option value="all">Alle Meldungen</option><option value="error">Fehler</option>
          <option value="warning">Warnungen</option><option value="request">HTTP-Aufrufe</option>
        </select>
        <label className="log-toggle"><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)}/> Live</label>
        <button className="secondary" onClick={() => setFollow(!follow)}>{follow ? "Auto-Scroll an" : "Auto-Scroll aus"}</button>
        <button className="secondary" disabled={!raw} onClick={() => void copy()}>Kopieren</button>
        <button className="secondary danger" disabled={working} onClick={() => void clear()}>Leeren</button>
      </div>
      {error && <div className="log-error" role="alert">{error}</div>}
      {notice && <div className="log-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Hinweis schließen">×</button></div>}
      <div className="log-output" ref={viewRef} role="log" aria-live="off" onScroll={e => {
        const area = e.currentTarget;
        if (area.scrollHeight - area.scrollTop - area.clientHeight > 42 && follow) setFollow(false);
      }}>
        {lines.map(line => {
          const timestamp = line.text.match(/^\[([^\]]+)\]\s*(.*)$/);
          return <div className={"log-line log-" + line.level} key={line.index}>
            <span className="log-index">{line.index + 1}</span>
            {timestamp && <time className="log-time">{timestamp[1]}</time>}
            <span className="log-message">{timestamp ? timestamp[2] : line.text}</span>
          </div>;
        })}
        {lines.length === 0 && <p className="log-empty">
          {raw ? "Keine passenden Meldungen gefunden." : "Noch keine Logmeldungen vorhanden."}
        </p>}
      </div>
      <div className="log-footer">
        <span><i className="log-dot error-dot"/> Fehler <i className="log-dot warning-dot"/> Warnungen <i className="log-dot request-dot"/> HTTP</span>
        <button className="secondary" onClick={onClose}>Schließen</button>
      </div>
    </section>
  </div>;
}

export { levelOf };
