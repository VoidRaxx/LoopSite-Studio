import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

type Status = { host: string; port: number; username: string; version: string };
type Preview = { columns: string[]; rows: (string | number | null)[][]; truncated: boolean; primaryKey: string | null };
type NewColumn = { name: string; dataType: string; notNull: boolean };
const sqlTypes = ["TEXT","VARCHAR(255)","INTEGER","BIGINT","DOUBLE","DATETIME","BOOLEAN"];

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
  const [newTable, setNewTable] = useState("");
  const [newColumns, setNewColumns] = useState<NewColumn[]>([{name:"title",dataType:"VARCHAR(255)",notNull:true}]);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [edit, setEdit] = useState<{keyValue:string;column:string;value:string;original:string}|null>(null);
  const [service, setService] = useState("MariaDB");
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
    setTables([]); setTable(""); setPreview(null); setShowDelete(false); setDeleteName(""); setShowCreateTable(false); setEdit(null);
    if(!status || !database) return;
    invoke<string[]>("maria_list_tables", {database}).then(names=>{
      if(active){setTables(names);setTable(names[0]??"");}
    }).catch(e=>{if(active)setError(String(e));});
    return ()=>{active=false;};
  },[database,status]);

  useEffect(()=>{
    let active=true;
    setPreview(null); setEdit(null);
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


  async function startService() {
    if (busy || !window.confirm("Den bereits installierten Dienst " + service +
      " auf diesem Rechner starten? Windows benötigt gegebenenfalls Administratorrechte, Linux Polkit.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result=await invoke<string>("start_local_mariadb_service",{service});
      setNotice(result + " Gib danach die Verbindungsdaten ein.");
    } catch(e) {setError("Dienststart fehlgeschlagen: " + String(e));}
    finally {setBusy(false);}
  }
  async function deleteDatabase() {
    if (busy || !database || deleteName !== database) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await invoke("maria_delete_database",{database,confirmation:deleteName});
      const next=await invoke<string[]>("maria_list_databases");
      setDatabases(next); setDatabase(next[0]??"");
      setShowDelete(false);setDeleteName("");
      setNotice("MariaDB-Datenbank gelöscht. Dieser Vorgang ist nicht rückgängig zu machen.");
    } catch(e){setError("Löschen fehlgeschlagen: " + String(e));}
    finally{setBusy(false);}
  }
  async function createTable(e:FormEvent) {
    e.preventDefault(); if(busy || !database) return;
    setBusy(true);setError("");setNotice("");
    try {
      const name=newTable.trim();
      await invoke("maria_create_table",{database,table:name,columns:newColumns.map(c=>({...c,name:c.name.trim()}))});
      const next=await invoke<string[]>("maria_list_tables",{database});
      setTables(next);setTable(name);setShowCreateTable(false);setNewTable("");
      setNotice("Tabelle angelegt.");
    }catch(e){setError("Tabelle konnte nicht erstellt werden: " + String(e));}
    finally{setBusy(false);}
  }
  async function saveEdit(e:FormEvent){
    e.preventDefault();
    if(busy || !edit || edit.value === edit.original || !database || !table) return;
    setBusy(true);setError("");setNotice("");
    try {
      await invoke("maria_update_cell",{database,table,keyValue:edit.keyValue,
        column:edit.column,value:edit.value});
      setPreview(await invoke<Preview>("maria_read_table",{database,table}));
      setEdit(null);setNotice("Zelle aktualisiert.");
    }catch(e){setError("Zelle konnte nicht geändert werden: " + String(e));}
    finally{setBusy(false);}
  }

  return <section>
    <div className="page-heading"><div>
      <p className="eyebrow">LOCAL MARIADB / MYSQL</p><h1>MariaDB-Verwaltung</h1>
      <p>Vorhandenen Datenbankdienst starten, verbinden, Datenbanken und Tabellen erstellen sowie Daten bearbeiten.</p>
    </div></div>
    {error&&<div className="notice error" role="alert">{error}<button onClick={()=>setError("")} aria-label="Fehler schließen">×</button></div>}
    {notice&&<div className="db-note" role="status">{notice}<button className="icon-button" onClick={()=>setNotice("")}>×</button></div>}
    {!status ? <div className="card settings maria-connect">
      <h2>Mit lokalem Server verbinden</h2>
      <p>Du kannst einen vorhandenen Systemdienst starten oder dich mit einer bereits laufenden MariaDB-Instanz verbinden (z. B. XAMPP).</p>
      <div className="db-service-start">
        <label>Datenbank-Systemdienst
          <select value={service} onChange={e=>setService(e.target.value)}>
            <option value="MariaDB">MariaDB</option>
            <option value="MySQL">MySQL</option>
            <option value="MySQL80">MySQL80 (Windows)</option>
          </select>
        </label>
        <button className="secondary" disabled={busy} onClick={()=>void startService()}>Dienst starten</button>
        <p className="db-muted">Nur für bereits installierte Systemdienste. Ein XAMPP-Dienst ohne Registrierung wird dadurch nicht gestartet. Kein Datenverzeichnis wird verändert.</p>
      </div>
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
          <div className="section-head"><div><h3>{database}</h3>
            <p>Tabellen erstellen, Datensätze ansehen und Zellen mit eindeutigem Primärschlüssel bearbeiten.</p></div>
            <div className="db-controls">
              <button className="secondary" disabled={busy} onClick={()=>setShowCreateTable(!showCreateTable)}>+ Tabelle</button>
              <button className="subtle danger" disabled={busy} onClick={()=>setShowDelete(!showDelete)}>Datenbank löschen</button>
            </div>
          </div>
          {showDelete && <div className="db-delete-panel">
            <h3>Datenbank „{database}“ dauerhaft löschen</h3>
            <p>Dies führt DROP DATABASE auf deinem MariaDB-Server aus – ohne automatische Sicherung. Stelle vor dem Löschen selbst ein Backup her.</p>
            <label>Zur Bestätigung den vollständigen Datenbanknamen eingeben
              <input autoComplete="off" value={deleteName} onChange={e=>setDeleteName(e.target.value)} placeholder={database}/></label>
            <div className="db-controls"><button className="secondary" onClick={()=>{setDeleteName("");setShowDelete(false);}}>Abbrechen</button>
              <button className="primary" disabled={busy || deleteName!==database} onClick={()=>void deleteDatabase()}>Endgültig löschen</button></div>
          </div>}
          {showCreateTable && <form className="db-form" onSubmit={e=>void createTable(e)}>
            <h3>Neue MariaDB-Tabelle</h3>
            <label>Tabellenname<input required maxLength={64} pattern="[A-Za-z_][A-Za-z0-9_]*"
              value={newTable} onChange={e=>setNewTable(e.target.value)} placeholder="products"/></label>
            <p className="db-muted">Die Spalte id wird automatisch als BIGINT-Primärschlüssel angelegt.</p>
            {newColumns.map((col,i)=><div className="db-column-form" key={i}>
              <label>Spalte<input required maxLength={64} value={col.name} onChange={e=>setNewColumns(cols=>cols.map((x,k)=>k===i?{...x,name:e.target.value}:x))}/></label>
              <label>Datentyp<select value={col.dataType} onChange={e=>setNewColumns(cols=>cols.map((x,k)=>k===i?{...x,dataType:e.target.value}:x))}>
                {sqlTypes.map(type=><option key={type} value={type}>{type}</option>)}</select></label>
              <label className="checkbox-label"><input type="checkbox" checked={col.notNull}
                onChange={e=>setNewColumns(cols=>cols.map((x,k)=>k===i?{...x,notNull:e.target.checked}:x))}/>Pflicht</label>
              <button type="button" className="icon-button" disabled={newColumns.length===1}
                onClick={()=>setNewColumns(cols=>cols.filter((_,k)=>k!==i))}>×</button>
            </div>)}
            <div className="db-controls">
              <button type="button" className="secondary" disabled={newColumns.length>=24}
                onClick={()=>setNewColumns(cols=>[...cols,{name:"",dataType:"TEXT",notNull:false}])}>+ Spalte</button>
              <button type="submit" className="primary" disabled={busy}>Tabelle erstellen</button>
            </div>
          </form>}
          <div className="db-table-tabs">{tables.map(name=><button key={name} className={table===name?"selected":""} onClick={()=>setTable(name)}>{name}</button>)}
            {tables.length===0&&<p className="empty-list">Keine Tabellen vorhanden.</p>}</div>
          {table&&<><div className="db-table-header"><strong>{table}</strong><span className="db-muted">Vorschau: maximal 100 Zeilen</span></div>
            {edit && <form className="db-form" onSubmit={e=>void saveEdit(e)}>
              <h3>{edit.column} bearbeiten</h3>
              <p className="db-muted">Primärschlüssel: {preview?.primaryKey} = {edit.keyValue}</p>
              <label>Neuer Wert
                <input value={edit.value} maxLength={16384} onChange={e=>setEdit(v=>v?{...v,value:e.target.value}:v)}/>
              </label>
              <div className="db-controls"><button type="button" className="secondary" onClick={()=>setEdit(null)}>Abbrechen</button>
                <button type="submit" className="primary" disabled={busy || !edit || edit.value===edit.original}>Wert speichern</button></div>
            </form>}
            {preview?<div className="db-scroll"><table className="db-data">
              <thead><tr>{preview.columns.map(c=><th key={c}>{c}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j} title={String(v??"NULL")}>
                <span>{v===null?<em>NULL</em>:String(v)}</span>
                {preview.primaryKey && preview.columns[j]!==preview.primaryKey && row[preview.columns.indexOf(preview.primaryKey)]!==null &&
                <button className="db-cell-edit" disabled={busy} title={"Zelle "+preview.columns[j]+" bearbeiten"} onClick={()=>{
                  const key=row[preview.columns.indexOf(preview.primaryKey!)];
                  const original=v===null?"":String(v);
                  setEdit({keyValue:String(key),column:preview.columns[j],value:original.endsWith("…")?"":original,original});
                }}>✎</button>}</td>)}</tr>)}</tbody>
            </table>{preview.rows.length===0&&<p className="empty-list">Die Tabelle ist leer.</p>}</div>:<p className="db-muted">Tabellendaten werden geladen …</p>}
            {preview?.truncated&&<p className="db-muted">Es werden nur die ersten 100 Zeilen angezeigt.</p>}
          </>}
        </>:<div className="empty"><p>Wähle links eine Datenbank aus.</p></div>}
        <p className="db-muted">Die Datenbank ist eine eigenständige lokale Instanz. Sie wird nicht automatisch einem Projektserver zugeordnet.</p>
      </div>
    </div>}
  </section>;
}
