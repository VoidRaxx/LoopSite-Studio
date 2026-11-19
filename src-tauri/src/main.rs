#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod projects;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            projects::load_projects,
            projects::save_projects
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start LoopSite Studio");
}
