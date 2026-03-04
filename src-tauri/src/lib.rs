use tauri::Manager;

#[tauri::command]
fn open_records(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("records") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let _ = tauri::WebviewWindowBuilder::new(
        &app,
        "records",
        tauri::WebviewUrl::App("records.html".into()),
    )
    .title("記録")
    .inner_size(360.0, 460.0)
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .shadow(false)
    .build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_records])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
