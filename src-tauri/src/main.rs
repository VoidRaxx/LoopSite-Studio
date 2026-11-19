#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod projects;
mod servers;
mod proxy;
mod editor;

fn main() {
    let manager = servers::ServerManager::default();
    tauri::Builder::default()
        .manage(manager)
        .manage(proxy::ProxyManager::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            projects::load_projects,
            projects::save_projects,
            servers::start_server,
            servers::stop_server,
            servers::list_running_servers,
            servers::read_server_log,
            proxy::start_proxy,
            proxy::stop_proxy,
            proxy::proxy_status,
            proxy::read_proxy_log,
            editor::list_project_directory,
            editor::read_project_file,
            editor::save_project_file
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
