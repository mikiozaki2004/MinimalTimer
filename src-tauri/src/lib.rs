use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// records ウィンドウを取得または再作成して返す
fn get_or_create_records(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    // 既存のウィンドウがあればそれを返す
    if let Some(win) = app.get_webview_window("records") {
        let _ = win.show();
        let _ = win.set_focus();
        return Some(win);
    }

    // ウィンドウが破棄済みの場合は再作成する
    WebviewWindowBuilder::new(
        app,
        "records",
        WebviewUrl::App("records.html".into()),
    )
    .title("記録")
    .inner_size(360.0, 460.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .build()
    .ok()
    .map(|win| {
        let _ = win.set_focus();
        win
    })
}

#[tauri::command]
fn open_records(app: tauri::AppHandle) {
    get_or_create_records(&app);
}

#[tauri::command]
fn open_records_devtools(app: tauri::AppHandle) {
    if let Some(win) = get_or_create_records(&app) {
        #[cfg(debug_assertions)]
        win.open_devtools();
        #[cfg(not(debug_assertions))]
        let _ = win;
    }
}

#[tauri::command]
fn hide_records(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("records") {
        let _ = win.hide();
    }
}

// ── Completion notification ────────────────────────────────────────
use std::sync::Mutex;

static SAVED_POS: Mutex<Option<(f64, f64)>> = Mutex::new(None);
static CURRENT_SIZE: Mutex<f64> = Mutex::new(280.0);
const COMPLETION_SIZE: f64 = 400.0;

#[tauri::command]
fn resize_window(app: tauri::AppHandle, size: u32) {
    let Some(win) = app.get_webview_window("main") else { return };
    let size_f = size as f64;
    *CURRENT_SIZE.lock().unwrap() = size_f;
    let _ = win.set_size(tauri::LogicalSize::new(size_f, size_f));
}

#[tauri::command]
fn notify_completion(app: tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };

    // 元のウィンドウ位置を保存
    if let Ok(pos) = win.outer_position() {
        if let Ok(Some(monitor)) = win.current_monitor() {
            let s = monitor.scale_factor();
            *SAVED_POS.lock().unwrap() = Some((pos.x as f64 / s, pos.y as f64 / s));
        }
    }

    // ウィンドウを拡大
    let _ = win.set_size(tauri::LogicalSize::new(COMPLETION_SIZE, COMPLETION_SIZE));

    // 画面中央に移動
    if let Ok(Some(monitor)) = win.current_monitor() {
        let s = monitor.scale_factor();
        let sw = monitor.size().width as f64 / s;
        let sh = monitor.size().height as f64 / s;
        let mx = monitor.position().x as f64 / s;
        let my = monitor.position().y as f64 / s;
        let x = mx + (sw - COMPLETION_SIZE) / 2.0;
        let y = my + (sh - COMPLETION_SIZE) / 2.0;
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    }

    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

#[tauri::command]
fn dismiss_completion(app: tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };

    // 元のサイズに戻す
    let current = *CURRENT_SIZE.lock().unwrap();
    let _ = win.set_size(tauri::LogicalSize::new(current, current));

    // 元の位置に戻す
    if let Some((x, y)) = SAVED_POS.lock().unwrap().take() {
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_records,
            open_records_devtools,
            hide_records,
            notify_completion,
            dismiss_completion,
            resize_window,
        ])
        .on_window_event(|window, event| {
            // records ウィンドウの閉じるイベントを横取りして hide に変換
            if window.label() == "records" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
