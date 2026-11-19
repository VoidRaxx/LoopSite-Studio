//! Native SQLite database management. Database files live in LoopSite's
//! private application-data directory, never in a publicly served document root.
use rusqlite::{params, params_from_iter, Connection, OpenFlags, types::ValueRef};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_COLUMNS: usize = 24;
const MAX_ROWS: usize = 100;
const MAX_CELL_CHARS: usize = 1500;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    name: String,
    path: String,
    size_bytes: u64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewColumn {
    name: String,
    data_type: String,
    not_null: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertValue {
    name: String,
    value: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbColumn {
    name: String,
    data_type: String,
    not_null: bool,
    primary_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableData {
    columns: Vec<DbColumn>,
    rows: Vec<Vec<serde_json::Value>>,
    truncated: bool,
}

fn identifier(name: &str) -> bool {
    let b=name.as_bytes();
    !b.is_empty() && b.len() <= 48 &&
    b[0].is_ascii_alphabetic() &&
    b.iter().all(|c| c.is_ascii_alphanumeric() || *c==b'_' || *c==b'-')
}

fn sql_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn validate_project(app: &AppHandle, project_id: &str) -> Result<(), String> {
    if project_id.is_empty() || project_id.len() > 80 ||
       !project_id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return Err("Ungültige Projekt-ID.".into());
    }
    if projects::load_projects(app.clone())?.iter().any(|p| p.id == project_id) {
        Ok(())
    } else {
        Err("Projekt nicht gefunden.".into())
    }
}

use crate::projects;

fn database_dir(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    validate_project(app, project_id)?;
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("sqlite");
    let dir = base.join(project_id);
    Ok(dir)
}

fn database_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !identifier(name) {
        return Err("Datenbankname: 1–48 Zeichen, beginnend mit einem Buchstaben; danach Buchstaben, Zahlen, _ oder -.".into());
    }
    Ok(dir.join(format!("{name}.sqlite3")))
}

fn open_database(dir: &Path, name: &str, write: bool) -> Result<Connection, String> {
    let path = database_path(dir, name)?;
    let md = fs::symlink_metadata(&path).map_err(|e| format!("Datenbank nicht gefunden: {e}"))?;
    if !md.file_type().is_file() || md.file_type().is_symlink() {
        return Err("Datenbankpfad ist keine reguläre Datei.".into());
    }
    let flags = if write { OpenFlags::SQLITE_OPEN_READ_WRITE } else { OpenFlags::SQLITE_OPEN_READ_ONLY };
    let conn = Connection::open_with_flags(path, flags).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(3)).map_err(|e| e.to_string())?;
    // Never load extension libraries from database files or user-provided SQL.
    Ok(conn)
}

fn create_db_in_dir(dir: &Path, name: &str) -> Result<DatabaseInfo, String> {
    let path = database_path(dir, name)?;
    fs::create_dir_all(dir).map_err(|e| format!("Datenbankordner: {e}"))?;
    let created=OpenOptions::new().write(true).create_new(true).open(&path)
        .map_err(|e| format!("Datenbank existiert bereits oder kann nicht erstellt werden: {e}"))?;
    drop(created);
    match open_database(dir, name, true) {
        Ok(conn) => {
            if let Err(e) = conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;") {
                drop(conn);
                let _=fs::remove_file(&path);
                return Err(format!("Datenbankinitialisierung fehlgeschlagen: {e}"));
            }
        }
        Err(e) => { let _=fs::remove_file(&path); return Err(e); }
    };
    let size=fs::metadata(&path).map_err(|e| e.to_string())?.len();
    Ok(DatabaseInfo {name:name.to_owned(),path:path.to_string_lossy().into_owned(),size_bytes:size})
}

#[tauri::command]
pub fn create_sqlite_database(app: AppHandle, project_id: String, name: String) -> Result<DatabaseInfo,String> {
    let dir=database_dir(&app,&project_id)?;
    create_db_in_dir(&dir,&name)
}

#[tauri::command]
pub fn list_sqlite_databases(app: AppHandle, project_id: String) -> Result<Vec<DatabaseInfo>,String> {
    let dir=database_dir(&app,&project_id)?;
    if !dir.exists() {return Ok(Vec::new())}
    let mut found=Vec::new();
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry=item.map_err(|e| e.to_string())?;
        let name=entry.file_name().to_string_lossy().to_string();
        let Some(base)=name.strip_suffix(".sqlite3") else { continue };
        if !identifier(base) {continue}
        let md=fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if !md.file_type().is_file() || md.file_type().is_symlink() {continue}
        found.push(DatabaseInfo {name:base.to_owned(),path:entry.path().to_string_lossy().into_owned(),size_bytes:md.len()});
    }
    found.sort_by(|a,b|a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(found)
}

fn create_table_in_dir(dir:&Path,db:&str,table:&str,columns:&[NewColumn]) -> Result<(),String> {
    if !identifier(table) || table.starts_with("sqlite_") {return Err("Ungültiger Tabellenname.".into())}
    if columns.is_empty() || columns.len()>MAX_COLUMNS {return Err("Bitte 1 bis 24 Spalten angeben.".into())}
    let mut unique=HashSet::new();
    unique.insert("id".to_string());
    let mut definitions=vec!["\"id\" INTEGER PRIMARY KEY AUTOINCREMENT".to_string()];
    for col in columns {
        if !identifier(&col.name) || !unique.insert(col.name.to_ascii_lowercase()) {
            return Err(format!("Ungültiger oder doppelter Spaltenname: {}",col.name));
        }
        let dtype=col.data_type.as_str();
        if !matches!(dtype,"TEXT"|"INTEGER"|"REAL"|"NUMERIC"|"BLOB") {return Err("Ungültiger Spaltentyp.".into())}
        definitions.push(format!("{} {}{}",sql_identifier(&col.name),dtype,if col.not_null{" NOT NULL"}else{""}));
    }
    let conn=open_database(dir,db,true)?;
    let sql=format!("CREATE TABLE {} ({})",sql_identifier(table),definitions.join(", "));
    conn.execute_batch(&sql).map_err(|e|format!("Tabelle konnte nicht erstellt werden: {e}"))
}

#[tauri::command]
pub fn create_sqlite_table(app:AppHandle,project_id:String,database:String,table:String,columns:Vec<NewColumn>)->Result<(),String>{
    let dir=database_dir(&app,&project_id)?;
    create_table_in_dir(&dir,&database,&table,&columns)
}

fn list_tables_in_dir(dir:&Path,db:&str)->Result<Vec<String>,String>{
    let conn=open_database(dir,db,false)?;
    let mut stmt=conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name COLLATE NOCASE")
        .map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())
}

#[tauri::command]
pub fn list_sqlite_tables(app:AppHandle,project_id:String,database:String)->Result<Vec<String>,String>{
    let dir=database_dir(&app,&project_id)?;
    list_tables_in_dir(&dir,&database)
}

fn columns_of(conn:&Connection,table:&str)->Result<Vec<DbColumn>,String>{
    let exists:bool=conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 AND name NOT LIKE 'sqlite_%')",
        params![table],|r|r.get(0)).map_err(|e|e.to_string())?;
    if !exists {return Err("Tabelle nicht vorhanden.".into())}
    let pragma=format!("PRAGMA table_info({})",sql_identifier(table));
    let mut stmt=conn.prepare(&pragma).map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|r|Ok(DbColumn{
        name:r.get(1)?,data_type:r.get(2)?,not_null:r.get::<_,i64>(3)?!=0,
        primary_key:r.get::<_,i64>(5)?!=0,
    })).map_err(|e|e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())
}

fn cell(value:ValueRef<'_>)->serde_json::Value{
    match value {
        ValueRef::Null=>serde_json::Value::Null,
        ValueRef::Integer(x)=>serde_json::Value::from(x),
        ValueRef::Real(x)=>if x.is_finite(){serde_json::json!(x)}else{serde_json::Value::Null},
        ValueRef::Text(b)=>{
            let s=String::from_utf8_lossy(b);
            let truncated:String=s.chars().take(MAX_CELL_CHARS+1).collect();
            if truncated.chars().count()>MAX_CELL_CHARS {serde_json::Value::String(format!("{}…",&truncated.chars().take(MAX_CELL_CHARS).collect::<String>()))}
            else{serde_json::Value::String(truncated)}
        },
        ValueRef::Blob(b)=>serde_json::Value::String(format!("[Binärdaten: {} Bytes]",b.len())),
    }
}

fn read_table_in_dir(dir:&Path,db:&str,table:&str)->Result<TableData,String>{
    let conn=open_database(dir,db,false)?;
    let columns=columns_of(&conn,table)?;
    if columns.len()>100 {return Err("Mehr als 100 Spalten werden derzeit nicht dargestellt.".into())}
    let sql=format!("SELECT * FROM {} LIMIT {}",sql_identifier(table),MAX_ROWS+1);
    let mut stmt=conn.prepare(&sql).map_err(|e|e.to_string())?;
    let count=stmt.column_count();
    let mut rows=stmt.query([]).map_err(|e|e.to_string())?;
    let mut result=Vec::new();
    while let Some(row)=rows.next().map_err(|e|e.to_string())? {
        if result.len()==MAX_ROWS {
            return Ok(TableData {columns,rows:result,truncated:true});
        }
        let mut values=Vec::with_capacity(count);
        for i in 0..count {values.push(cell(row.get_ref(i).map_err(|e|e.to_string())?));}
        result.push(values);
    }
    Ok(TableData{columns,rows:result,truncated:false})
}

#[tauri::command]
pub fn read_sqlite_table(app:AppHandle,project_id:String,database:String,table:String)->Result<TableData,String>{
    let dir=database_dir(&app,&project_id)?;
    read_table_in_dir(&dir,&database,&table)
}

fn insert_in_dir(dir:&Path,db:&str,table:&str,values:&[InsertValue])->Result<(),String>{
    let conn=open_database(dir,db,true)?;
    let cols=columns_of(&conn,table)?;
    let mut allowed=HashSet::new();
    for col in cols.iter().filter(|c|!c.primary_key) {allowed.insert(col.name.as_str());}
    if values.len()>allowed.len() || values.is_empty(){return Err("Keine gültigen Spaltenwerte übergeben.".into())}
    let mut seen=HashSet::new();
    for v in values {
        if !allowed.contains(v.name.as_str()) || !seen.insert(v.name.as_str()) {
            return Err("Ungültige oder doppelte Spaltenbezeichnung.".into())
        }
        if v.value.as_ref().is_some_and(|v|v.len()>16_384) {
            return Err("Zellen dürfen maximal 16 KiB enthalten.".into())
        }
    }
    let fields=values.iter().map(|v|sql_identifier(&v.name)).collect::<Vec<_>>().join(",");
    let placeholders=(1..=values.len()).map(|x|format!("?{x}")).collect::<Vec<_>>().join(",");
    let query=format!("INSERT INTO {} ({}) VALUES ({})",sql_identifier(table),fields,placeholders);
    conn.execute(&query,params_from_iter(values.iter().map(|x| &x.value)))
        .map_err(|e|format!("Datensatz konnte nicht gespeichert werden: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn insert_sqlite_row(app:AppHandle,project_id:String,database:String,table:String,values:Vec<InsertValue>)->Result<(),String>{
    let dir=database_dir(&app,&project_id)?;
    insert_in_dir(&dir,&database,&table,&values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize,Ordering};
    static NEXT:AtomicUsize=AtomicUsize::new(0);
    fn temp()->PathBuf{
        let n=NEXT.fetch_add(1,Ordering::Relaxed);
        let dir=std::env::temp_dir().join(format!("loopsite-db-{}-{n}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    #[test]
    fn rejects_path_traversal_and_invalid_names(){
        assert!(!identifier("../user"));
        assert!(!identifier("test/file"));
        assert!(!identifier(""));
        assert!(!identifier("X".repeat(60).as_str()));
        assert!(identifier("my_database_01"));
    }
    #[test]
    fn creates_database_table_and_inserts_rows(){
        let dir=temp();
        let db=create_db_in_dir(&dir,"testdb").unwrap();
        assert!(Path::new(&db.path).exists());
        assert!(create_db_in_dir(&dir,"testdb").is_err());
        let fields=vec![NewColumn{name:"title".into(),data_type:"TEXT".into(),not_null:true},
                        NewColumn{name:"quantity".into(),data_type:"INTEGER".into(),not_null:false}];
        create_table_in_dir(&dir,"testdb","products",&fields).unwrap();
        assert_eq!(list_tables_in_dir(&dir,"testdb").unwrap(),vec!["products"]);
        insert_in_dir(&dir,"testdb","products",&[
            InsertValue{name:"title".into(),value:Some("Hallo".into())},
            InsertValue{name:"quantity".into(),value:Some("42".into())}
        ]).unwrap();
        let result=read_table_in_dir(&dir,"testdb","products").unwrap();
        assert_eq!(result.columns.len(),3);
        assert_eq!(result.rows.len(),1);
        assert_eq!(result.rows[0][1],"Hallo");
        assert_eq!(result.rows[0][2],42);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_unsafe_schema_and_column_names(){
        let dir=temp();
        create_db_in_dir(&dir,"tests").unwrap();
        assert!(create_table_in_dir(&dir,"tests","evil; DROP TABLE tests",&[
            NewColumn{name:"ok".into(),data_type:"TEXT".into(),not_null:false}]).is_err());
        assert!(create_table_in_dir(&dir,"tests","safe",&[
            NewColumn{name:"bad;".into(),data_type:"TEXT".into(),not_null:false}]).is_err());
        assert!(create_table_in_dir(&dir,"tests","safe",&[
            NewColumn{name:"title".into(),data_type:"DROP".into(),not_null:false}]).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_reused_columns_and_null_constraint(){
        let dir=temp();
        create_db_in_dir(&dir,"tests").unwrap();
        let bad=[NewColumn{name:"a".into(),data_type:"TEXT".into(),not_null:false},NewColumn{name:"A".into(),data_type:"TEXT".into(),not_null:false}];
        assert!(create_table_in_dir(&dir,"tests","wrong",&bad).is_err());
        create_table_in_dir(&dir,"tests","safe",&[NewColumn{name:"required".into(),data_type:"TEXT".into(),not_null:true}]).unwrap();
        assert!(insert_in_dir(&dir,"tests","safe",&[InsertValue{name:"required".into(),value:None}]).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}