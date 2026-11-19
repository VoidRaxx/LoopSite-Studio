#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod projects;
mod servers;

fn main() {
    let manager = servers::ServerManager::default();
    tauri::Builder::default()
        .manage(manager)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            projects::load_projects,
            projects::save_projects,
            servers::start_server,
            servers::stop_server,
            servers::list_running_servers,
            servers::read_server_log
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager;
                window.app_handle().state::<servers::ServerManager>().stop_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to start LoopSite Studio");
}
