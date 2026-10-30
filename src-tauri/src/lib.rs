pub mod binary;
pub mod commands;
pub mod compare;
pub mod dirdiff;
pub mod textdiff;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::compare_paths,
            commands::diff_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
