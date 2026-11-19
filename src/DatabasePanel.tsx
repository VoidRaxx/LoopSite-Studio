import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Project } from "./types";

type DatabaseInfo = { name: string; path: string; sizeBytes: number };
type DbColumn = { name: string; dataType: string; notNull: boolean; primaryKey: boolean };
type TableData = { columns: DbColumn[]; rows: (string | number | null)[][]; truncated: boolean };
type NewColumn = { name: string; dataType: string; notNull: boolean };
type Props = { project: Project | null; projects: Project[]; onSelectProject: (id: string) => void };
const types = ["TEXT", "INTEGER", "REAL", "NUMERIC", "BLOB"];

export default function DatabasePanel({ project, projects, onSelectProject }: Props) {
  const projectId = project?.id;
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [database, setDatabase] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState("");
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [newDbName, setNewDbName] = useState("");
  const [importName, setImportName] = useState("");
  const [newTableName, setNewTableName] = useState("");
  const [columns, setColumns] = useState<NewColumn[]>([{ name: "title", dataType: "TEXT", notNull: true }]);
  const [insertValues, setInsertValues] = useState<Record<string, string>>({});
  const [showNewTable, setShowNewTable] = useState(false);
  const [showInsert, setShowInsert] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [originalEditValues, setOriginalEditValues] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteName, setConfirmDeleteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setDatabases([]); setDatabase(""); setTables([]); setTable(""); setTableData(null);
    setError(""); setNotice(""); setShowNewTable(false); setShowInsert(false);
    setEditingRow(null); setConfirmDelete(false); setConfirmDeleteName("");
    if (!projectId) return;
    invoke<DatabaseInfo[]>("list_sqlite_databases", { projectId }).then(result => {
      if (active) { setDatabases(result); setDatabase(result[0]?.name ?? ""); }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setTables([]); setTable(""); setTableData(null); setShowInsert(false); setShowNewTable(false);
    setConfirmDelete(false); setConfirmDeleteName(""); setEditingRow(null);
    if (!projectId || !database) return;
    invoke<string[]>("list_sqlite_tables", { projectId, database }).then(result => {
      if (active) { setTables(result); setTable(result[0] ?? ""); }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [projectId, database]);

  useEffect(() => {
    let active = true;
    setTableData(null); setShowInsert(false); setInsertValues({}); setEditingRow(null);
    if (!projectId || !database || !table) return;
    invoke<TableData>("read_sqlite_table", { projectId, database, table }).then(result => {
      if (active) setTableData(result);
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [projectId, database, table]);

  async function refreshDatabases(select?: string) {
    if (!projectId) return;
    const result=await invoke<DatabaseInfo[]>("list_sqlite_databases", { projectId });
    setDatabases(result);
    if (select) setDatabase(select);
    else if (!result.some(x => x.name === database)) setDatabase(result[0]?.name ?? "");
  }
  async function refreshTables(select?: string) {
    if (!projectId || !database) return;
    const result=await invoke<string[]>("list_sqlite_tables", { projectId, database });
    setTables(result);
    if (select) setTable(select);
    else if (!result.includes(table)) setTable(result[0] ?? "");
  }
  async function refreshRows() {
    if (!projectId || !database || !table) return;
    setTableData(await invoke<TableData>("read_sqlite_table", { projectId, database, table }));
  }
  async function refreshAll() {
    setBusy(true); setError("");
    try {
      await refreshDatabases();
      await refreshTables();
      await refreshRows();
    } catch(e) {setError(String(e));}
    finally {setBusy(false);}
  }
  async function createDatabase(event: FormEvent) {
    event.preventDefault();
    if (!projectId || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const info=await invoke<DatabaseInfo>("create_sqlite_database", { projectId, name: newDbName.trim() });
      await refreshDatabases(info.name);
      setNewDbName("");
      setNotice("SQLite-Datenbank angelegt. Du kannst nun eine Tabelle erstellen.");
    } catch(e) {setError(String(e));}
    finally {setBusy(false);}
  }

  async function importDatabase() {
    if (!projectId || busy || !importName.trim()) {
      setError("Bitte zuerst einen Namen für die importierte Datenbank eingeben."); return;
    }
    setError(""); setNotice("");
    try {
      const source = await open({
        multiple: false,
        directory: false,
        title: "SQLite-Datenbank importieren",
        filters: [{ name: "SQLite", extensions: ["sqlite3", "sqlite", "db"] }],
      });
      if (typeof source !== "string") return;
      setBusy(true);
      const result = await invoke<DatabaseInfo>("import_sqlite_database", {
        projectId, name: importName.trim(), source
      });
      await refreshDatabases(result.name);
      setImportName("");
      setNotice("Datenbank wurde als eigenständige Kopie importiert.");
    } catch (e) { setError("Import fehlgeschlagen: " + String(e)); }
    finally { setBusy(false); }
  }
  async function exportDatabase() {
    if (!projectId || !database || busy) return;
    setError(""); setNotice("");
    try {
      const destination = await save({
        title: "SQLite-Sicherung speichern",
        defaultPath: database + ".sqlite3",
        filters: [{ name: "SQLite", extensions: ["sqlite3"] }],
      });
      if (typeof destination !== "string") return;
      setBusy(true);
      await invoke("export_sqlite_database", { projectId, database, destination });
      setNotice("SQLite-Sicherung erstellt: " + destination);
    } catch (e) { setError("Export fehlgeschlagen: " + String(e)); }
    finally { setBusy(false); }
  }
  async function createTable(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !database || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const name=newTableName.trim();
      await invoke("create_sqlite_table", { projectId, database, table: name,
        columns: columns.map(c => ({...c,name:c.name.trim()})) });
      await refreshTables(name);
      setShowNewTable(false); setNewTableName("");
      setColumns([{name:"title",dataType:"TEXT",notNull:true}]);
      setNotice("Tabelle erstellt.");
    } catch(e) {setError(String(e));}
    finally {setBusy(false);}
  }
  async function insertRow(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !database || !table || !tableData || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const values=tableData.columns.filter(c => !c.primaryKey).map(c => ({
        name:c.name, value:insertValues[c.name] === "" && !c.notNull ? null : (insertValues[c.name] ?? "")
      }));
      await invoke("insert_sqlite_row", { projectId,database,table,values });
      await refreshRows();
      setInsertValues({}); setShowInsert(false); setNotice("Datensatz eingefügt.");
    } catch(e) {setError(String(e));}
    finally {setBusy(false);}
  }

  async function archiveDatabase() {
    if (!projectId || !database || confirmDeleteName !== database || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const archivedPath = await invoke<string>("delete_sqlite_database", {
        projectId, database, confirmation: confirmDeleteName
      });
      const items = await invoke<DatabaseInfo[]>("list_sqlite_databases", { projectId });
      setDatabases(items);
      setDatabase(items[0]?.name ?? "");
      setConfirmDelete(false); setConfirmDeleteName("");
      setNotice("Datenbank aus dem Projekt entfernt und sicher archiviert unter: " + archivedPath);
    } catch (e) { setError("Entfernen fehlgeschlagen: " + String(e)); }
    finally { setBusy(false); }
  }

  function beginEdit(row: (string | number | null)[]) {
    if (!tableData) return;
    const idIndex = tableData.columns.findIndex(c => c.primaryKey && c.name === "id" && c.dataType.toUpperCase() === "INTEGER");
    if (idIndex < 0 || typeof row[idIndex] !== "number" || !Number.isSafeInteger(row[idIndex])) {
      setError("Dieser Datensatz kann nicht sicher über eine ganzzahlige ID bearbeitet werden.");
      return;
    }
    const next: Record<string, string> = {};
    tableData.columns.forEach((column,index) => {
      if (!column.primaryKey) next[column.name] = row[index] == null ? "" : String(row[index]);
    });
    setEditingRow(row[idIndex] as number);
    setEditValues(next); setOriginalEditValues(next); setShowInsert(false); setError("");
  }

  async function saveEditedRow(event: FormEvent) {
    event.preventDefault();
    if (busy || !projectId || !database || !table || !tableData || editingRow === null) return;
    setBusy(true); setError("");
    try {
      const values = tableData.columns.filter(c => !c.primaryKey && editValues[c.name] !== originalEditValues[c.name]).map(c => ({
        name: c.name, value: editValues[c.name] === "" && !c.notNull ? null : (editValues[c.name] ?? "")
      }));
      if (values.length === 0) { setEditingRow(null); return; }
      await invoke("update_sqlite_row",{ projectId, database, table, id: editingRow, values });
      setEditingRow(null);
      await refreshRows();
      setNotice("Datensatz aktualisiert.");
    } catch (e) { setError("Datensatz konnte nicht bearbeitet werden: " + String(e)); }
    finally { setBusy(false); }
  }

  if (!project) return <div className="empty"><h2>Projekt auswählen</h2><p>Erstelle zuerst ein Projekt, um SQLite-Datenbanken anzulegen.</p></div>;
  const currentDb=databases.find(db => db.name === database);
  return <section>
    <div className="page-heading">
      <div><p className="eyebrow">LOCAL DATABASES</p><h1>Datenbanken</h1>
        <p>SQLite-Datenbanken lokal anlegen, Tabellen verwalten und Daten ansehen.</p></div>
      <label className="db-project-select">Projekt
        <select value={project.id} onChange={e => onSelectProject(e.target.value)}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
    </div>

    {error && <div className="notice error" role="alert">{error}<button aria-label="Meldung schließen" onClick={()=>setError("")}>×</button></div>}
    {notice && <div className="db-note" role="status">{notice}<button className="icon-button" onClick={()=>setNotice("")}>×</button></div>}

    <div className="db-layout">
      <aside className="db-sidebar">
        <h3>Datenbanken <span>{databases.length}</span></h3>
        {databases.map(db => <button key={db.name} className={"db-select " + (database === db.name ? "selected" : "")}
          onClick={()=>setDatabase(db.name)}><strong>{db.name}</strong><small>SQLite · {Math.round(db.sizeBytes/1024)} KiB</small></button>)}
        {databases.length===0 && <p className="empty-list">Noch keine Datenbank vorhanden.</p>}
        <form className="db-new" onSubmit={e=>void createDatabase(e)}>
          <label>Neue Datenbank<input value={newDbName} onChange={e=>setNewDbName(e.target.value)}
            placeholder="z. B. webshop" required maxLength={48} pattern="[A-Za-z][A-Za-z0-9_-]*"/></label>
          <button className="primary" disabled={busy} type="submit">+ Datenbank erstellen</button>
        </form>
        <div className="db-new">
          <label>Bestehende SQLite-Datei importieren
            <input value={importName} onChange={e=>setImportName(e.target.value)}
              placeholder="Name der importierten Datenbank" maxLength={48}
              pattern="[A-Za-z][A-Za-z0-9_-]*" />
          </label>
          <button className="secondary" type="button" disabled={busy || !importName.trim()}
            onClick={() => void importDatabase()}>SQLite-Datei auswählen …</button>
          <p className="db-muted">Es wird eine geprüfte Kopie angelegt; bestehende Datenbanken werden nicht überschrieben.</p>
        </div>
      </aside>
      <div className="db-work">
        {currentDb ? <>
          <div className="db-top">
            <div><p className="eyebrow">SQLITE DATABASE</p><h2>{currentDb.name}</h2>
              <p className="db-file-path" title={currentDb.path}>{currentDb.path}</p></div>
            <div className="db-controls"><button className="secondary" disabled={busy} onClick={() => void exportDatabase()}>Sicherung exportieren</button>
            <button className="secondary" disabled={busy} onClick={() => void refreshAll()}>Aktualisieren</button>
              <button className="subtle danger" disabled={busy} onClick={() => setConfirmDelete(!confirmDelete)}>Datenbank entfernen</button></div>
          </div>
          {confirmDelete && <div className="db-delete-panel">
            <h3>Datenbank „{database}“ entfernen</h3>
            <p>Die Datenbank wird aus dem Projekt entfernt und im App-Datenverzeichnis archiviert. Bei aktiven Journaldateien wird das Entfernen verweigert.</p>
            <label>Bestätigung: Datenbanknamen exakt eingeben
              <input value={confirmDeleteName} onChange={e => setConfirmDeleteName(e.target.value)}
                placeholder={database} autoComplete="off"/>
            </label>
            <div className="db-controls">
              <button className="secondary" onClick={() => { setConfirmDelete(false); setConfirmDeleteName(""); }}>Abbrechen</button>
              <button className="primary" disabled={busy || confirmDeleteName !== database}
                onClick={() => void archiveDatabase()}>Datenbank jetzt entfernen</button>
            </div>
          </div>}
          <div className="section-head">
            <div><h3>Tabellen</h3><p>Wähle eine Tabelle zum Anzeigen und Einfügen von Datensätzen.</p></div>
            <button className="secondary" disabled={busy} onClick={()=>{setShowNewTable(!showNewTable);setShowInsert(false);}}>+ Tabelle</button>
          </div>
          {showNewTable && <form className="db-form" onSubmit={e=>void createTable(e)}>
            <h3>Neue Tabelle erstellen</h3>
            <label>Tabellenname<input value={newTableName} maxLength={48} pattern="[A-Za-z][A-Za-z0-9_-]*"
              onChange={e=>setNewTableName(e.target.value)} placeholder="z. B. products" required/></label>
            <p className="db-muted">Die Spalte <code>id</code> wird automatisch als Primärschlüssel angelegt.</p>
            {columns.map((col,i)=><div className="db-column-form" key={i}>
              <label>Spalte<input maxLength={48} required value={col.name} placeholder="name"
                onChange={e=>setColumns(cs=>cs.map((v,k)=>k===i?{...v,name:e.target.value}:v))}/></label>
              <label>Datentyp<select value={col.dataType} onChange={e=>setColumns(cs=>cs.map((v,k)=>k===i?{...v,dataType:e.target.value}:v))}>
                {types.map(t=><option key={t}>{t}</option>)}</select></label>
              <label className="checkbox-label"><input type="checkbox" checked={col.notNull}
                onChange={e=>setColumns(cs=>cs.map((v,k)=>k===i?{...v,notNull:e.target.checked}:v))}/>Pflicht</label>
              <button type="button" className="icon-button" disabled={columns.length===1}
                aria-label="Spalte entfernen" onClick={()=>setColumns(cs=>cs.filter((_,k)=>k!==i))}>×</button>
            </div>)}
            <div className="db-controls">
              <button className="secondary" type="button" disabled={columns.length>=24}
                onClick={()=>setColumns(cs=>[...cs,{name:"",dataType:"TEXT",notNull:false}])}>+ Spalte</button>
              <button className="primary" type="submit" disabled={busy}>Tabelle erstellen</button>
            </div>
          </form>}
          <div className="db-table-tabs">
            {tables.map(t=><button key={t} className={table===t?"selected":""} onClick={()=>setTable(t)}>{t}</button>)}
            {tables.length===0 && <p className="empty-list">Noch keine Tabellen. Erstelle die erste Tabelle.</p>}
          </div>
          {table && <>
            <div className="db-table-header"><strong>{table}</strong>
              <div className="db-controls"><span className="db-muted">Max. 100 Zeilen</span>
                <button className="secondary" disabled={busy || !tableData} onClick={()=>{setShowInsert(!showInsert);setShowNewTable(false);}}>+ Datensatz</button>
              </div>
            </div>
            {showInsert && tableData && <form className="db-form" onSubmit={e=>void insertRow(e)}>
              <h3>Datensatz hinzufügen</h3>
              <div className="db-insert-grid">
                {tableData.columns.filter(c=>!c.primaryKey).map(c=><label key={c.name}>{c.name} <small>({c.dataType})</small>
                  <input value={insertValues[c.name]??""} placeholder={c.notNull?"Pflichtfeld":"Leer = NULL"}
                    onChange={e=>setInsertValues(x=>({...x,[c.name]:e.target.value}))}/></label>)}
              </div>
              <div className="db-controls"><button className="secondary" type="button" onClick={()=>setShowInsert(false)}>Abbrechen</button>
                <button className="primary" type="submit" disabled={busy}>Speichern</button></div>
            </form>}
            {editingRow !== null && tableData && <form className="db-form" onSubmit={e => void saveEditedRow(e)}>
              <h3>Datensatz #{editingRow} bearbeiten</h3>
              <div className="db-insert-grid">{tableData.columns.filter(c => !c.primaryKey).map(c =>
                <label key={c.name}>{c.name} <small>({c.dataType})</small>
                  <input value={editValues[c.name] ?? ""} onChange={e => setEditValues(v => ({ ...v, [c.name]: e.target.value }))}/>
                </label>)}</div>
              <div className="db-controls">
                <button type="button" className="secondary" onClick={() => setEditingRow(null)}>Abbrechen</button>
                <button type="submit" className="primary" disabled={busy || Object.keys(editValues).every(k => editValues[k] === originalEditValues[k])}>Änderungen speichern</button>
              </div>
            </form>}
            {tableData ? <div className="db-scroll"><table className="db-data">
              <thead><tr>{tableData.columns.map(c=><th key={c.name}>{c.name} <span>{c.dataType}</span></th>)}<th>Aktion</th></tr></thead>
              <tbody>{tableData.rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j} title={String(value??"NULL")}>{value===null?<em>NULL</em>:String(value)}</td>)}<td>
          <button className="secondary" disabled={busy || !tableData.columns.some(c => c.primaryKey && c.name === "id" && c.dataType.toUpperCase() === "INTEGER")}
            onClick={() => beginEdit(row)}>Bearbeiten</button>
        </td></tr>)}</tbody>
            </table>{tableData.rows.length===0 && <p className="empty-list">Noch keine Datensätze vorhanden.</p>}</div>
              :<p className="db-muted">Tabellendaten werden geladen …</p>}
            {tableData?.truncated && <p className="db-muted">Es werden nur die ersten 100 Zeilen angezeigt.</p>}
          </>}
          <p className="db-muted">Datenbankdateien liegen außerhalb des öffentlichen Webverzeichnisses. Es erfolgt kein automatischer Zugriff von PHP-Servern.</p>
        </> : <div className="empty"><h3>SQLite bereit</h3><p>Lege links deine erste Datenbank an. SQLite benötigt keinen separaten Datenbankserver.</p></div>}
      </div>
    </div>
  </section>;
}
