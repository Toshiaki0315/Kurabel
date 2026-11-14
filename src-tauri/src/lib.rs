pub mod archive;
pub mod binary;
pub mod commands;
pub mod compare;
pub mod dirdiff;
pub mod fileops;
pub mod merge3;
pub mod textcodec;
pub mod textdiff;

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// 日本語のメニューバー。テキスト編集のショートカット (Cmd/Ctrl+Z, X, C, V, A) は「編集」メニュー経由で有効になる。
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let settings = MenuItemBuilder::with_id("settings", "設定…").accelerator("CmdOrCtrl+,").build(app)?;
    // 標準の「終了」はウインドウを閉じる処理を通らず、未保存の確認が出ない。メインウインドウを閉じる形にして確認を通す
    let quit = MenuItemBuilder::with_id("quit", "クラベルを終了").accelerator("CmdOrCtrl+Q").build(app)?;
    let app_menu = SubmenuBuilder::new(app, "クラベル")
        .item(&PredefinedMenuItem::about(app, Some("クラベルについて"), None)?)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("クラベルを隠す"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("ほかを隠す"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("すべてを表示"))?)
        .separator()
        .item(&quit)
        .build()?;
    let edit = SubmenuBuilder::new(app, "編集")
        .item(&PredefinedMenuItem::undo(app, Some("元に戻す"))?)
        .item(&PredefinedMenuItem::redo(app, Some("やり直す"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("切り取り"))?)
        .item(&PredefinedMenuItem::copy(app, Some("コピー"))?)
        .item(&PredefinedMenuItem::paste(app, Some("ペースト"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("すべてを選択"))?)
        .build()?;
    let window = SubmenuBuilder::new(app, "ウインドウ")
        .item(&PredefinedMenuItem::minimize(app, Some("しまう"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("拡大/縮小"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("ウインドウを閉じる"))?)
        .build()?;
    MenuBuilder::new(app).items(&[&app_menu, &edit, &window]).build()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(build_menu)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "settings" => {
                    let _ = app.emit("open-settings", ());
                }
                "quit" => match app.get_webview_window("main") {
                    Some(window) => {
                        let _ = window.close();
                    }
                    None => app.exit(0),
                },
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::compare_paths,
            commands::diff_text,
            commands::path_kind,
            commands::save_text,
            commands::copy_entry,
            commands::delete_entry,
            commands::make_patch,
            commands::write_patch,
            commands::write_report,
            commands::check_regex,
            commands::compare_archive_entry,
            commands::initial_paths,
            commands::merge3,
            commands::create_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
