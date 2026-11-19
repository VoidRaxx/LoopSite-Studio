import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

type Status = { host: string; port: number; username: string; version: string };
type Preview = { columns: string[]; rows: (string | number | null)[][]; truncated: boolean };

export default function MariaPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("3306");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState("");
  const [newName, setNewName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    invoke<Status | null>("maria_status").then(info => {
      if (!active) return;
      setStatus(info);
      if (info) {
        setHost(info.host); setPort(String(info.port)); setUsername(info.username);
      }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setDatabases([]); setDatabase("");
    if (!status) return;
    invoke<string[]>("maria_list_databases").then(names => {
      if (active) {setDatabases(names);setDatabase(names[0] ?? "");}
    }).catch(e => {if(active)setError(String(e));});
    return () => {active=false;};
  }, [status]);

  useEffect(() => {
    let active=true;
    setTables([]); setTable(""); setPreview(null);
    if(!status || !database) return;
    invoke<string[]>("maria_list_tables", {database}).then(names=>{
      if(active){setTables(names);setTable(names[0]??"");}
    }).catch(e=>{if(active)setError(String(e));});
    return ()=>{active=false;};
  },[database,status]);

  useEffect(()=>{
    let active=true;
    setPreview(null);
    if(!status||!database||!table)return;
    invoke<Preview>("maria_read_table",{database,table})
      .then(result=>{if(active)setPreview(result);})
      .catch(e=>{if(active)setError(String(e));});
    return ()=>{active=false;};
  },[status,database,table]);

  async function connect(e: FormEvent){
    e.preventDefault(); if(busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      const info=await invoke<Status>("maria_connect",{
        host, port:Number(port),username,password
      });
      setPassword(""); setStatus(info);
      setNotice("Verbindung hergestellt. Das Passwort wurde nicht gespeichert.");
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  async function disconnect(){
    setBusy(true);setError("");
    try{
      await invoke("maria_disconnect");
      setStatus(null);setDatabase("");setDatabases([]);setTables([]);setPreview(null);
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  async function refresh(){
    setBusy(true);setError("");
    try{
      const list=await invoke<string[]>("maria_list_databases");
      setDatabases(list);
      if(!list.includes(database))setDatabase(list[0]??"");
      if(database){
        const t=await invoke<string[]>("maria_list_tables",{database});
        setTables(t);
        if(!t.includes(table))setTable(t[0]??"");
        if(table && t.includes(table))setPreview(await invoke<Preview>("maria_read_table",{database,table}));
      }
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  async function createDb(e: FormEvent){
    e.preventDefault();if(busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      const name=newName.trim();
      await invoke("maria_create_database",{name});
      const next=await invoke<string[]>("maria_list_databases");
      setDatabases(next);setDatabase(name);setNewName("");
      setNotice("Datenbank erstellt. Bestehende Tabellen kannst du in LoopSite ansehen.");
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  }

  return <section>
    <div className="page-heading"><div>
      <p className="eyebrow">LOCAL MARIADB / MYSQL</p><h1>MariaDB-Verwaltung</h1>
      <p>Mit einer vorhandenen lokalen MariaDB-Instanz verbinden, Datenbanken erstellen und Tabellen ansehen.</p>
    </div></div>
    {error&&<div className="notice error" role="alert">{error}<button onClick={()=>setError("")} aria-label="Fehler schließen">×</button></div>}
    {notice&&<div className="db-note" role="status">{notice}<button className="icon-button" onClick={()=>setNotice("")}>×</button></div>}
    {!status ? <div className="card settings maria-connect">
      <h2>Mit lokalem Server verbinden</h2>
      <p>Verwendet die vorhandene MariaDB-Installation (z. B. XAMPP). Es wird kein Dienst installiert oder verändert.</p>
      <form onSubmit={e=>void connect(e)} className="db-form">
        <div className="db-connect-grid">
          <label>Host<select value={host} onChange={e=>setHost(e.target.value)}><option value="127.0.0.1">127.0.0.1</option><option value="::1">::1</option></select></label>
          <label>Port<input type="number" min="1" max="65535" required value={port} onChange={e=>setPort(e.target.value)}/></label>
          <label>Benutzer<input value={username} required maxLength={128} onChange={e=>setUsername(e.target.value)} autoComplete="username"/></label>
          <label>Passwort<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="off" placeholder="Falls leer: frei lassen"/></label>
        </div>
        <div className="db-controls"><button type="submit" className="primary" disabled={busy}>Verbinden</button></div>
      </form>
      <p className="db-muted">Nur lokale Loopback-Verbindungen. Zugangsdaten bleiben im Arbeitsspeicher und werden beim Trennen verworfen. Für entfernte Datenbankserver gibt es derzeit keine Verbindungsmöglichkeit.</p>
    </div> :
    <div className="db-layout">
      <aside className="db-sidebar">
        <h3>Datenbanken <span>{databases.length}</span></h3>
        {databases.map(name=><button className={"db-select "+(database===name?"selected":"")} key={name}
          onClick={()=>setDatabase(name)}><strong>{name}</strong><small>MariaDB</small></button>)}
        {databases.length===0&&<p className="empty-list">Keine Datenbanken vorhanden oder keine Berechtigung.</p>}
        <form className="db-new" onSubmit={e=>void createDb(e)}>
          <label>Neue Datenbank<input value={newName} onChange={e=>setNewName(e.target.value)}
            required maxLength={64} pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="z. B. meine_db"/></label>
          <button type="submit" className="primary" disabled={busy}>+ Datenbank erstellen</button>
        </form>
      </aside>
      <div className="db-work">
        <div className="db-top"><div><p className="eyebrow">VERBUNDEN</p><h2>{status.username}@{status.host}:{status.port}</h2>
          <p className="db-file-path">Serverversion: {status.version}</p></div>
          <div className="db-controls"><button className="secondary" disabled={busy} onClick={()=>void refresh()}>Aktualisieren</button>
            <button className="subtle" disabled={busy} onClick={()=>void disconnect()}>Trennen</button></div>
        </div>
        {database ? <>
          <div className="section-head"><div><h3>{database}</h3><p>Bestehende Tabellen auswählen und Daten ansehen (nur lesend).</p></div></div>
          <div className="db-table-tabs">{tables.map(name=><button key={name} className={table===name?"selected":""} onClick={()=>setTable(name)}>{name}</button>)}
            {tables.length===0&&<p className="empty-list">Keine Tabellen vorhanden.</p>}</div>
          {table&&<><div className="db-table-header"><strong>{table}</strong><span className="db-muted">Vorschau: maximal 100 Zeilen</span></div>
            {preview?<div className="db-scroll"><table className="db-data">
              <thead><tr>{preview.columns.map(c=><th key={c}>{c}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j} title={String(v??"NULL")}>{v===null?<em>NULL</em>:String(v)}</td>)}</tr>)}</tbody>
            </table>{preview.rows.length===0&&<p className="empty-list">Die Tabelle ist leer.</p>}</div>:<p className="db-muted">Tabellendaten werden geladen …</p>}
            {preview?.truncated&&<p className="db-muted">Es werden nur die ersten 100 Zeilen angezeigt.</p>}
          </>}
        </>:<div className="empty"><p>Wähle links eine Datenbank aus.</p></div>}
        <p className="db-muted">Die Datenbank ist eine eigenständige lokale Instanz. Sie wird nicht automatisch einem Projektserver zugeordnet.</p>
      </div>
    </div>}
  </section>;
}
