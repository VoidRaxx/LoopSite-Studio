#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod projects;
mod servers;
mod proxy;
mod editor;
mod executables;
mod php;
mod sqlite;
mod maria;
mod install;

fn main() {
    let manager = servers::ServerManager::default();
    tauri::Builder::default()
        .manage(manager)
        .manage(proxy::ProxyManager::default())
        .manage(maria::MariaManager::default())
        .manage(install::InstallState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            projects::load_projects,
            projects::save_projects,
            servers::start_server,
            servers::stop_server,
            servers::list_running_servers,
            servers::read_server_log,
            servers::clear_server_log,
            proxy::start_proxy,
            proxy::stop_proxy,
            proxy::proxy_status,
            proxy::read_proxy_log,
            proxy::clear_proxy_log,
            editor::list_project_directory,
            editor::read_project_file,
            editor::save_project_file,
            php::list_php_runtimes,
            php::register_php_runtime,
            install::runtime_install_plan,
            install::install_runtime,
            sqlite::create_sqlite_database,
            sqlite::list_sqlite_databases,
            sqlite::create_sqlite_table,
            sqlite::list_sqlite_tables,
            sqlite::read_sqlite_table,
            sqlite::insert_sqlite_row,
            sqlite::import_sqlite_database,
            sqlite::export_sqlite_database,
            maria::maria_connect,
            maria::maria_status,
            maria::maria_disconnect,
            maria::maria_list_databases,
            maria::maria_create_database,
            maria::maria_list_tables,
            maria::maria_read_table
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager;
                window.app_handle().state::<servers::ServerManager>().stop_all();
                window.app_handle().state::<proxy::ProxyManager>().stop_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to start LoopSite Studio");
}
