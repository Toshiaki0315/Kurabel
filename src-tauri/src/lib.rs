pub mod binary;
pub mod commands;
pub mod compare;
pub mod dirdiff;
pub mod textcodec;
pub mod textdiff;

use tauri::menu::{MenuBuilder, SubmenuBuilder};

pub fn run() {
    tauri::Builder::default()
        // テキスト編集のショートカット (Cmd/Ctrl+Z, X, C, V, A) は「編集」メニュー経由で有効になる
        .menu(|app| {
            let app_menu = SubmenuBuilder::new(app, "Kurabel").about(None).separator().quit().build()?;
            let edit = SubmenuBuilder::new(app, "編集")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            MenuBuilder::new(app).items(&[&app_menu, &edit]).build()
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::compare_paths,
            commands::diff_text,
            commands::path_kind,
            commands::save_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
