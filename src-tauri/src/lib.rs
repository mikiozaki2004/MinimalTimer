use tauri::Manager;

#[tauri::command]
fn open_records(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("records") {
        let _ = win.show();
        let _ = win.set_focus();
        #[cfg(debug_assertions)]
        win.open_devtools();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_records])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
