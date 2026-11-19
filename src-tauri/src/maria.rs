//! MariaDB client for existing loopback-only database instances.
//! Credentials live only in process memory; never persisted or sent to a shell.
use mysql::{prelude::Queryable, Conn, OptsBuilder, Row, Value};
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::State;

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct MariaStatus { host:String, port:u16, username:String, version:String }

struct Connected { conn:Conn, info:MariaStatus }

#[derive(Default)]
pub struct MariaManager(Mutex<Option<Connected>>);

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct MariaTableData { columns:Vec<String>, rows:Vec<Vec<serde_json::Value>>, truncated:bool, primary_key:Option<String> }

const MAX_ROWS: usize=100;

fn local_host(host:&str)->Option<&'static str>{
    match host.trim().to_ascii_lowercase().as_str(){
        "localhost"|"127.0.0.1"=>Some("127.0.0.1"),
        "::1"|"[::1]"=>Some("::1"),
        _=>None,
    }
}

fn safe_new_name(name:&str)->bool{
    let b=name.as_bytes();
    !b.is_empty() && b.len()<=64 &&
    (b[0].is_ascii_alphabetic()||b[0]==b'_') &&
    b.iter().all(|x|x.is_ascii_alphanumeric()||*x==b'_') &&
    !system_name(name)
}

fn system_name(name:&str)->bool{
    ["mysql","sys","information_schema","performance_schema"]
        .iter().any(|x|x.eq_ignore_ascii_case(name))
}

fn quoted(name:&str)->Result<String,String>{
    if name.is_empty() || name.len()>192 || name.chars().any(char::is_control){
        return Err("Ungültiger Datenbank- oder Tabellenname.".into())
    }
    let quote=char::from(96);
    Ok(format!("{quote}{}{quote}",name.replace(quote,&format!("{quote}{quote}"))))
}

fn with_conn<T>(state:State<'_,MariaManager>, f:impl FnOnce(&mut Conn)->Result<T,String>)->Result<T,String>{
    let mut lock=state.0.lock().map_err(|_|"Verbindungsstatus nicht verfügbar.")?;
    let current=lock.as_mut().ok_or("Nicht mit MariaDB verbunden.")?;
    f(&mut current.conn)
}

#[tauri::command]
pub fn maria_connect(
    state:State<'_,MariaManager>,host:String,port:u16,username:String,password:String
)->Result<MariaStatus,String>{
    let host=local_host(&host).ok_or("Nur lokale MariaDB-Server (127.0.0.1 oder ::1) sind erlaubt.")?;
    if port==0 || username.trim().is_empty() || username.len()>128 ||
        username.chars().any(char::is_control) || password.len()>1024 {
        return Err("Ungültiger Port oder Benutzername.".into())
    }
    let opts=OptsBuilder::new()
        .ip_or_hostname(Some(host)).tcp_port(port).prefer_socket(false)
        .user(Some(username.as_str())).pass(Some(password.as_str()))
        .tcp_connect_timeout(Some(Duration::from_secs(4)))
        .read_timeout(Some(Duration::from_secs(5)))
        .write_timeout(Some(Duration::from_secs(5)));
    let mut conn=Conn::new(opts).map_err(|e|format!("Verbindung fehlgeschlagen: {e}"))?;
    let version:Option<String>=conn.query_first("SELECT VERSION()").map_err(|e|e.to_string())?;
    let info=MariaStatus{host:host.into(),port,username,version:version.unwrap_or_default()};
    let mut lock=state.0.lock().map_err(|_|"Verbindungsstatus nicht verfügbar.")?;
    *lock=Some(Connected{conn,info:info.clone()});
    Ok(info)
}

#[tauri::command]
pub fn maria_status(state:State<'_,MariaManager>)->Result<Option<MariaStatus>,String>{
    let lock=state.0.lock().map_err(|_|"Verbindungsstatus nicht verfügbar.")?;
    Ok(lock.as_ref().map(|x|x.info.clone()))
}

#[tauri::command]
pub fn maria_disconnect(state:State<'_,MariaManager>)->Result<(),String>{
    *state.0.lock().map_err(|_|"Verbindungsstatus nicht verfügbar.")?=None;
    Ok(())
}

#[tauri::command]
pub fn maria_list_databases(state:State<'_,MariaManager>)->Result<Vec<String>,String>{
    with_conn(state,|conn|{
        let mut names:Vec<String>=conn.query("SHOW DATABASES").map_err(|e|e.to_string())?;
        names.retain(|name|!system_name(name));
        names.sort_by_key(|name|name.to_ascii_lowercase());
        Ok(names)
    })
}

#[tauri::command]
pub fn maria_create_database(state:State<'_,MariaManager>,name:String)->Result<(),String>{
    if !safe_new_name(&name){
        return Err("Name: 1–64 Zeichen (Buchstaben, Zahlen, _); Systemdatenbanken sind ausgeschlossen.".into())
    }
    with_conn(state,|conn|conn.query_drop(format!(
        "CREATE DATABASE {} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",quoted(&name)?
    )).map_err(|e|e.to_string()))
}

#[tauri::command]
pub fn maria_list_tables(state:State<'_,MariaManager>,database:String)->Result<Vec<String>,String>{
    if system_name(&database){return Err("Systemdatenbank nicht erlaubt.".into())}
    quoted(&database)?;
    with_conn(state,|conn|conn.exec(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
        (database,)
    ).map_err(|e|e.to_string()))
}



#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MariaColumn {
    name: String,
    data_type: String,
    not_null: bool,
}

fn valid_column(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty() && b.len() <= 64 &&
        (b[0].is_ascii_alphabetic() || b[0] == b'_') &&
        b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_')
}

fn maria_column_type(name: &str) -> Result<&'static str, String> {
    match name {
        "TEXT" => Ok("TEXT"),
        "VARCHAR(255)" => Ok("VARCHAR(255)"),
        "INTEGER" => Ok("INT"),
        "BIGINT" => Ok("BIGINT"),
        "DOUBLE" => Ok("DOUBLE"),
        "DATETIME" => Ok("DATETIME"),
        "BOOLEAN" => Ok("BOOLEAN"),
        _ => Err("Unbekannter SQL-Datentyp.".into())
    }
}

#[tauri::command]
pub fn maria_create_table(
    state: State<'_,MariaManager>, database:String, table:String, columns:Vec<MariaColumn>
) -> Result<(),String> {
    if system_name(&database) || !valid_column(&table)
        || columns.is_empty() || columns.len()>24 {
        return Err("Ungültige Tabelle oder Spaltenanzahl (1–24).".into());
    }
    let mut names=std::collections::HashSet::new();
    names.insert("id".to_string());
    let mut definitions=vec![format!("{} BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY", quoted("id")?)];
    for c in columns {
        if !valid_column(&c.name) || !names.insert(c.name.to_ascii_lowercase()) {
            return Err("Spaltennamen dürfen nicht leer oder doppelt sein.".into());
        }
        let typ=maria_column_type(&c.data_type)?;
        definitions.push(format!("{} {}{}",quoted(&c.name)?,typ,if c.not_null{" NOT NULL"}else{""}));
    }
    let sql=format!("CREATE TABLE {}.{} ({}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        quoted(&database)?,quoted(&table)?,definitions.join(", "));
    with_conn(state,|conn|conn.query_drop(sql).map_err(|e|format!("Tabelle konnte nicht erstellt werden: {e}")))
}

#[tauri::command]
pub fn maria_delete_database(
    state: State<'_,MariaManager>,database:String,confirmation:String
) -> Result<(),String> {
    if database!=confirmation || system_name(&database) {
        return Err("Bestätigung stimmt nicht überein oder Systemdatenbank ist geschützt.".into());
    }
    let ident=quoted(&database)?;
    with_conn(state,|conn|conn.query_drop(format!("DROP DATABASE {ident}"))
        .map_err(|e|format!("Datenbank konnte nicht gelöscht werden: {e}")))
}

fn editable_key(conn:&mut Conn, database:&str, table:&str)->Result<Option<String>,String>{
    let keys:Vec<String>=conn.exec(
        "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION",
        (database,table)
    ).map_err(|e|e.to_string())?;
    if keys.len()!=1 {return Ok(None);}
    let kinds:Vec<String>=conn.exec(
        "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?",
        (database,table, &keys[0])
    ).map_err(|e|e.to_string())?;
    if !matches!(kinds.first().map(String::as_str),
        Some("bigint"|"int"|"integer"|"smallint"|"tinyint"|"mediumint"|"varchar"|"char")) {
        return Ok(None);
    }
    Ok(keys.into_iter().next())
}

#[tauri::command]
pub fn maria_update_cell(
    state: State<'_,MariaManager>,database:String,table:String,
    key_value:String,column:String,value:Option<String>
) -> Result<(),String> {
    if system_name(&database) || key_value.len()>255 || key_value.is_empty()
        || value.as_ref().is_some_and(|v|v.len()>16_384) {
        return Err("Ungültige Datenbank, Schlüssel oder Wert.".into());
    }
    let schema=quoted(&database)?;
    let table_sql=quoted(&table)?;
    let column_sql=quoted(&column)?;
    with_conn(state, |conn|{
        let key=editable_key(conn,&database,&table)?
            .ok_or("Diese Tabelle benötigt einen einzelnen unterstützten Primärschlüssel, um Daten zu bearbeiten.")?;
        if key==column {return Err("Primärschlüssel dürfen nicht geändert werden.".into());}
        let column_exists:Option<i64>=conn.exec_first(
            "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?",
            (&database,&table,&column)
        ).map_err(|e|e.to_string())?;
        if column_exists.is_none() {return Err("Spalte nicht gefunden.".into());}
        conn.exec_drop(format!(
            "UPDATE {schema}.{table_sql} SET {column_sql}=? WHERE {}=? LIMIT 1",quoted(&key)?
        ), (value.as_deref(), key_value.as_str()))
            .map_err(|e|format!("Datensatz konnte nicht bearbeitet werden: {e}"))
    })
}


#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct MariaEditableColumn {
    name:String,
    data_type:String,
    not_null:bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MariaInsertValue {
    name:String,
    value:Option<String>,
}

fn column_definitions(conn:&mut Conn, db:&str, table:&str)->Result<Vec<MariaEditableColumn>,String>{
    let columns:Vec<(String,String,String,String)>=conn.exec(
        "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
        (db,table)
    ).map_err(|e|e.to_string())?;
    let fields=columns.into_iter().filter(|(name,_,_,extra)| {
        name!="id" && !extra.contains("auto_increment") && !extra.contains("GENERATED")
    }).map(|(name,kind,nullable,_)|MariaEditableColumn {
        name,data_type:kind,not_null:nullable=="NO"
    }).collect();
    Ok(fields)
}

#[tauri::command]
pub fn maria_editable_columns(
    state:State<'_,MariaManager>,database:String,table:String
)->Result<Vec<MariaEditableColumn>,String>{
    if system_name(&database) {return Err("Systemdatenbank ist geschützt.".into());}
    quoted(&database)?;quoted(&table)?;
    with_conn(state,|conn|column_definitions(conn,&database,&table))
}

#[tauri::command]
pub fn maria_insert_row(
    state:State<'_,MariaManager>,database:String,table:String,values:Vec<MariaInsertValue>
)->Result<(),String>{
    if system_name(&database) || values.is_empty() || values.len()>32 {
        return Err("Ungültige Datenbank oder Spaltenanzahl (1–32).".into());
    }
    let schema=quoted(&database)?;
    let tbl=quoted(&table)?;
    with_conn(state,|conn|{
        let allowed:std::collections::HashSet<String>=column_definitions(conn,&database,&table)?
            .into_iter().map(|c|c.name).collect();
        let mut seen=std::collections::HashSet::new();
        for item in &values {
            if !allowed.contains(&item.name) || !seen.insert(&item.name) ||
                item.value.as_ref().is_some_and(|x|x.len()>16_384) {
                return Err("Ungültige oder doppelte Spalte oder Zelle größer als 16 KiB.".into());
            }
        }
        let columns=values.iter().map(|v|quoted(&v.name)).collect::<Result<Vec<_>,_>>()?.join(", ");
        let placeholders=vec!["?";values.len()].join(", ");
        let sql=format!("INSERT INTO {schema}.{tbl} ({columns}) VALUES ({placeholders})");
        let params=values.iter().map(|v|match &v.value{
            Some(text)=>Value::Bytes(text.clone().into_bytes()),
            None=>Value::NULL
        }).collect::<Vec<_>>();
        conn.exec_drop(sql, mysql::Params::Positional(params))
            .map_err(|e|format!("Zeile konnte nicht hinzugefügt werden: {e}"))
    })
}

fn projection(columns:&[(String,String)])->Result<String,String>{
    let mut expressions=Vec::with_capacity(columns.len());
    for (name,kind) in columns {
        let col=quoted(name)?;
        let binary=matches!(kind.to_ascii_lowercase().as_str(),
            "binary"|"varbinary"|"tinyblob"|"blob"|"mediumblob"|"longblob"|"bit"|"geometry");
        if binary {
            expressions.push(format!(
                "IF({col} IS NULL, NULL, CONCAT('[Binärdaten: ', OCTET_LENGTH({col}), ' Bytes]')) AS {col}"
            ));
        }else{
            expressions.push(format!("LEFT(CAST({col} AS CHAR CHARACTER SET utf8mb4), 800) AS {col}"));
        }
    }
    Ok(expressions.join(", "))
}

fn value_json(v:Value)->serde_json::Value{
    match v{
        Value::NULL=>serde_json::Value::Null,
        Value::Int(x)=>if x.unsigned_abs()>9_007_199_254_740_991 {serde_json::json!(x.to_string())} else {serde_json::json!(x)},
        Value::UInt(x)=>if x>9_007_199_254_740_991 {serde_json::json!(x.to_string())} else {serde_json::json!(x)},
        Value::Float(x)=>serde_json::json!(x),
        Value::Double(x)=>serde_json::json!(x),
        Value::Bytes(bytes)=>match std::str::from_utf8(&bytes){
            Ok(text)=>{
                let snippet:String=text.chars().take(800).collect();
                serde_json::Value::String(if text.chars().count()>800 {format!("{snippet}…")}else{snippet})
            },
            Err(_)=>serde_json::Value::String(format!("[Binärdaten: {} Bytes]",bytes.len())),
        },
        Value::Date(y,m,d,h,min,s,micros)=>serde_json::json!(
            format!("{y:04}-{m:02}-{d:02} {h:02}:{min:02}:{s:02}.{micros:06}")
        ),
        Value::Time(negative,days,h,min,s,micros)=>serde_json::json!(
            format!("{}{}:{min:02}:{s:02}.{micros:06}",if negative{"-"}else{""},days*24+u32::from(h))
        ),
    }
}

#[tauri::command]
pub fn maria_read_table(state:State<'_,MariaManager>,database:String,table:String)->Result<MariaTableData,String>{
    if system_name(&database){return Err("Systemdatenbank nicht erlaubt.".into())}
    let schema=quoted(&database)?;
    let tbl=quoted(&table)?;
    with_conn(state,|conn|{
        let schema_columns:Vec<(String,String)>=conn.exec(
            "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
            (&database,&table)
        ).map_err(|e|e.to_string())?;
        if schema_columns.is_empty(){return Err("Tabelle nicht gefunden oder keine Berechtigung.".into())}
        if schema_columns.len()>64{return Err("Maximal 64 Spalten können angezeigt werden.".into())}
        // Bound result payload per cell, including for multi-MiB BLOB columns.
        let primary_key=editable_key(conn,&database,&table)?;
        let projection=projection(&schema_columns)?;
        let rows:Vec<Row>=conn.query(format!("SELECT {projection} FROM {schema}.{tbl} LIMIT {}",MAX_ROWS+1))
            .map_err(|e|e.to_string())?;
        let truncated=rows.len()>MAX_ROWS;
        Ok(MariaTableData{
            columns:schema_columns.into_iter().map(|(name,_)|name).collect(),
            rows:rows.into_iter().take(MAX_ROWS).map(|r|r.unwrap().into_iter().map(value_json).collect()).collect(),
            truncated,
            primary_key,
        })
    })
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn enforces_loopback(){
        assert_eq!(local_host("localhost"),Some("127.0.0.1"));
        assert_eq!(local_host("::1"),Some("::1"));
        for host in ["0.0.0.0","10.0.0.3","127.0.0.1.evil.test","example.com"]{
            assert!(local_host(host).is_none());
        }
    }
    #[test] fn rejects_sql_injection_names(){
        assert!(safe_new_name("test_db_1"));
        for value in ["../../x","test; DROP TABLE users","mysql","sys","bad name"]{
            assert!(!safe_new_name(value));
        }
        assert!(quoted("bad\nquery").is_err());
        assert_eq!(quoted("a").unwrap(),format!("{0}a{0}",char::from(96)));
    }
    #[test] fn preview_never_fetches_entire_blob() {
        let query=projection(&[("picture".into(),"longblob".into()),("body".into(),"longtext".into())]).unwrap();
        assert!(query.contains("OCTET_LENGTH"));
        assert!(query.contains("LEFT(CAST"));
    }
    #[test] fn real_mariadb_integration_when_configured(){
        let Ok(port)=std::env::var("LOOPSITE_CI_MARIA_PORT") else {return};
        let port:u16=port.parse().expect("CI port must be numeric");
        let password=std::env::var("LOOPSITE_CI_MARIA_PASSWORD").expect("CI test password required");
        let options=OptsBuilder::new()
            .ip_or_hostname(Some("127.0.0.1")).tcp_port(port).prefer_socket(false)
            .user(Some("root")).pass(Some(password.as_str()))
            .tcp_connect_timeout(Some(Duration::from_secs(5)));
        let mut conn=Conn::new(options).expect("CI MariaDB instance unavailable");
        let name=format!("loopsite_ci_{}",std::process::id());
        conn.query_drop(format!("CREATE DATABASE {}",quoted(&name).unwrap())).unwrap();
        let result=(|| -> mysql::Result<()> {
            conn.query_drop(format!("CREATE TABLE {}.sample(id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80))",quoted(&name).unwrap()))?;
            conn.exec_drop(format!("INSERT INTO {}.sample(name) VALUES (?)",quoted(&name).unwrap()),("LoopSite",))?;
            let row:Option<String>=conn.query_first(format!("SELECT name FROM {}.sample LIMIT 1",quoted(&name).unwrap()))?;
            assert_eq!(row.as_deref(),Some("LoopSite"));
            Ok(())
        })();
        conn.query_drop(format!("DROP DATABASE {}",quoted(&name).unwrap())).unwrap();
        result.unwrap();
    }
    #[test] fn create_columns_validate_types_and_names(){
        assert!(valid_column("username"));
        assert!(!valid_column("x;DROP"));
        assert_eq!(maria_column_type("VARCHAR(255)").unwrap(),"VARCHAR(255)");
        assert!(maria_column_type("VARCHAR(999999)").is_err());
        assert!(maria_column_type("DROP TABLE").is_err());
    }
    #[test] fn masks_binary_values(){
        assert_eq!(value_json(Value::NULL),serde_json::Value::Null);
        assert_eq!(value_json(Value::Bytes(vec![0xff,0])),serde_json::json!("[Binärdaten: 2 Bytes]"));
    }
}