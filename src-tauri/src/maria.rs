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
pub struct MariaTableData { columns:Vec<String>, rows:Vec<Vec<serde_json::Value>>, truncated:bool }

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

fn value_json(v:Value)->serde_json::Value{
    match v{
        Value::NULL=>serde_json::Value::Null,
        Value::Int(x)=>serde_json::json!(x),
        Value::UInt(x)=>serde_json::json!(x),
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
        let columns:Vec<String>=conn.exec(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
            (&database,&table)
        ).map_err(|e|e.to_string())?;
        if columns.is_empty(){return Err("Tabelle nicht gefunden oder keine Berechtigung.".into())}
        if columns.len()>64{return Err("Maximal 64 Spalten können angezeigt werden.".into())}
        let rows:Vec<Row>=conn.query(format!("SELECT * FROM {schema}.{tbl} LIMIT {}",MAX_ROWS+1))
            .map_err(|e|e.to_string())?;
        let truncated=rows.len()>MAX_ROWS;
        Ok(MariaTableData{
            columns,
            rows:rows.into_iter().take(MAX_ROWS).map(|r|r.unwrap().into_iter().map(value_json).collect()).collect(),
            truncated,
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
    #[test] fn masks_binary_values(){
        assert_eq!(value_json(Value::NULL),serde_json::Value::Null);
        assert_eq!(value_json(Value::Bytes(vec![0xff,0])),serde_json::json!("[Binärdaten: 2 Bytes]"));
    }
}