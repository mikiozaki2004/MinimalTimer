use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    process::Command,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// カーソルがメインウィンドウの円外にある間、マウスイベントを透過させるフラグ
static CURSOR_PASSTHROUGH: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationRecord {
    date: String,
    task: String,
    detail: String,
    start_time: String,
    end_time: String,
    duration_min: f64,
    #[serde(default)]
    is_break: bool,
}

const TASK_WINDOW_WIDTH: f64 = 300.0;
const TASK_WINDOW_HEIGHT: f64 = 400.0;
const RECORDS_WINDOW_WIDTH: f64 = 480.0;
const RECORDS_WINDOW_HEIGHT: f64 = 660.0;
const POMO_WINDOW_WIDTH: f64 = 240.0;
const POMO_WINDOW_HEIGHT: f64 = 160.0;
const WINDOW_GAP: f64 = 16.0;

fn clamp_position(value: f64, min: f64, max: f64) -> f64 {
    if max <= min {
        min
    } else {
        value.max(min).min(max)
    }
}

fn position_window_near_main(app: &tauri::AppHandle, win: &tauri::WebviewWindow, win_w: f64, win_h: f64) {
    let Some(main_win) = app.get_webview_window("main") else {
        return;
    };
    let Ok(main_pos) = main_win.outer_position() else {
        return;
    };
    let Ok(main_size) = main_win.outer_size() else {
        return;
    };
    let Ok(Some(monitor)) = main_win.current_monitor() else {
        return;
    };

    let scale = monitor.scale_factor();
    let monitor_x = monitor.position().x as f64 / scale;
    let monitor_y = monitor.position().y as f64 / scale;
    let monitor_w = monitor.size().width as f64 / scale;
    let monitor_h = monitor.size().height as f64 / scale;
    let main_x = main_pos.x as f64 / scale;
    let main_y = main_pos.y as f64 / scale;
    let main_w = main_size.width as f64 / scale;
    let main_h = main_size.height as f64 / scale;

    let right_x = main_x + main_w + WINDOW_GAP;
    let left_x = main_x - win_w - WINDOW_GAP;
    let centered_x = main_x + (main_w - win_w) / 2.0;
    let centered_y = main_y + (main_h - win_h) / 2.0;
    let max_x = monitor_x + monitor_w - win_w;
    let max_y = monitor_y + monitor_h - win_h;

    let x = if right_x <= max_x {
        right_x
    } else if left_x >= monitor_x {
        left_x
    } else {
        clamp_position(centered_x, monitor_x, max_x)
    };
    let y = clamp_position(centered_y, monitor_y, max_y);

    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
}

fn position_task_window_near_main(app: &tauri::AppHandle, task_win: &tauri::WebviewWindow) {
    position_window_near_main(app, task_win, TASK_WINDOW_WIDTH, TASK_WINDOW_HEIGHT);
}

/// records ウィンドウを取得または再作成して返す
fn get_or_create_records(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    // 既存のウィンドウがあればそれを返す
    if let Some(win) = app.get_webview_window("records") {
        let _ = win.eval("window.refreshRecords && window.refreshRecords()");
        position_window_near_main(app, &win, RECORDS_WINDOW_WIDTH, RECORDS_WINDOW_HEIGHT);
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
    .inner_size(RECORDS_WINDOW_WIDTH, RECORDS_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .build()
    .ok()
    .map(|win| {
        position_window_near_main(app, &win, RECORDS_WINDOW_WIDTH, RECORDS_WINDOW_HEIGHT);
        let _ = win.set_focus();
        win
    })
}

#[tauri::command]
fn open_records(app: tauri::AppHandle) {
  get_or_create_records(&app);
}

/// task ウィンドウを取得または再作成して返す
fn get_or_create_task(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("task") {
        let _ = win.eval("window.refreshTasks && window.refreshTasks()");
        position_task_window_near_main(app, &win);
        let _ = win.show();
        let _ = win.set_focus();
        return Some(win);
    }

    WebviewWindowBuilder::new(app, "task", WebviewUrl::App("task.html".into()))
        .title("タスク")
        .inner_size(TASK_WINDOW_WIDTH, TASK_WINDOW_HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .build()
        .ok()
        .map(|win| {
            position_task_window_near_main(app, &win);
            let _ = win.set_focus();
            win
        })
}

#[tauri::command]
fn open_task_window(app: tauri::AppHandle) {
    get_or_create_task(&app);
}

/// pomo ウィンドウを取得または再作成して返す
fn get_or_create_pomo(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("pomo") {
        position_window_near_main(app, &win, POMO_WINDOW_WIDTH, POMO_WINDOW_HEIGHT);
        let _ = win.show();
        let _ = win.set_focus();
        return Some(win);
    }

    WebviewWindowBuilder::new(app, "pomo", WebviewUrl::App("pomo.html".into()))
        .title("ポモドーロ")
        .inner_size(POMO_WINDOW_WIDTH, POMO_WINDOW_HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .build()
        .ok()
        .map(|win| {
            position_window_near_main(app, &win, POMO_WINDOW_WIDTH, POMO_WINDOW_HEIGHT);
            let _ = win.set_focus();
            win
        })
}

#[tauri::command]
fn open_pomo_window(app: tauri::AppHandle) {
    get_or_create_pomo(&app);
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

// ── Cursor passthrough (transparent corner click-through) ─────────

/// カーソルがメインウィンドウの円内にあるか判定（物理ピクセル座標で比較）
#[cfg(target_os = "windows")]
fn cursor_in_circle(win: &tauri::WebviewWindow) -> bool {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut pt = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut pt) } == 0 {
        return false;
    }
    let Ok(pos)  = win.outer_position() else { return false };
    let Ok(size) = win.outer_size()     else { return false };

    let w        = size.width as f64;
    let center_x = pos.x as f64 + w / 2.0;
    let center_y = pos.y as f64 + w / 2.0; // ウィンドウは正方形
    let radius   = w / 2.0;
    let dx = pt.x as f64 - center_x;
    let dy = pt.y as f64 - center_y;
    dx * dx + dy * dy <= radius * radius
}

#[tauri::command]
fn set_cursor_passthrough(app: tauri::AppHandle, ignore: bool) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_ignore_cursor_events(ignore);
        CURSOR_PASSTHROUGH.store(ignore, Ordering::Relaxed);
    }
}

// ── Completion notification ────────────────────────────────────────

static SAVED_POS: Mutex<Option<(f64, f64)>> = Mutex::new(None);
static CURRENT_SIZE: Mutex<f64> = Mutex::new(280.0);
const COMPLETION_SIZE: f64 = 400.0;

#[tauri::command]
fn get_window_position(app: tauri::AppHandle) -> Option<[f64; 2]> {
    let win = app.get_webview_window("main")?;
    let pos = win.outer_position().ok()?;
    let monitor = win.current_monitor().ok()??;
    let scale = monitor.scale_factor();
    Some([pos.x as f64 / scale, pos.y as f64 / scale])
}

#[tauri::command]
fn set_window_position(app: tauri::AppHandle, x: f64, y: f64) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    }
}

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

#[tauri::command]
async fn append_excel_records(
    workbook_path: String,
    records: Vec<IntegrationRecord>,
) -> Result<usize, String> {
    if records.is_empty() {
        return Ok(0);
    }

    let workbook_path = workbook_path
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_string();

    if !Path::new(&workbook_path).exists() {
        return Err(format!("Excelファイルが見つかりません: {}", workbook_path));
    }

    let json = serde_json::to_string(&records).map_err(|e| e.to_string())?;
    let temp_path = std::env::temp_dir().join(format!(
        "minimal_timer_excel_{}_{}.json",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    ));

    fs::write(&temp_path, json).map_err(|e| e.to_string())?;
    let count = records.len();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let r = run_excel_append_script(&workbook_path, temp_path.to_string_lossy().as_ref());
        let _ = fs::remove_file(&temp_path);
        r
    })
    .await
    .map_err(|e| e.to_string())?;

    result.map(|_| count)
}

#[cfg(target_os = "windows")]
fn run_excel_append_script(workbook_path: &str, json_path: &str) -> Result<(), String> {
    let script = r#"
param(
  [string]$workbookPath,
  [string]$jsonPath,
  [string]$sheetName,
  [string]$breakLabel,
  [string]$headerDate,
  [string]$headerTask,
  [string]$headerDetail,
  [string]$headerStart,
  [string]$headerEnd,
  [string]$headerDuration,
  [string]$headerBreak
)
$ErrorActionPreference = 'Stop'
$records = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $records) { $records = @() }
if ($records -isnot [System.Array]) { $records = @($records) }
$headers = @($headerDate, $headerTask, $headerDetail, $headerStart, $headerEnd, $headerDuration, $headerBreak)

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $null
$ws = $null
$table = $null

try {
  $wb = $excel.Workbooks.Open($workbookPath)
  try {
    $ws = $wb.Worksheets.Item($sheetName)
  } catch {
    $ws = $wb.Worksheets.Item(1)
    $ws.Name = $sheetName
  }

  try {
    $table = $ws.ListObjects.Item('WorkLogs')
  } catch {
    for ($i = 0; $i -lt $headers.Count; $i++) {
      $ws.Cells.Item(1, $i + 1).Value2 = $headers[$i]
    }
    $range = $ws.Range('A1:G1')
    $table = $ws.ListObjects.Add(1, $range, $null, 1)
    $table.Name = 'WorkLogs'
    $table.TableStyle = 'TableStyleMedium2'
  }

  foreach ($record in $records) {
    $row = $table.ListRows.Add()
    $row.Range.Cells.Item(1, 1).Value2 = [string]$record.date
    $row.Range.Cells.Item(1, 2).Value2 = [string]$record.task
    $row.Range.Cells.Item(1, 3).Value2 = [string]$record.detail
    $row.Range.Cells.Item(1, 4).Value2 = [string]$record.startTime
    $row.Range.Cells.Item(1, 5).Value2 = [string]$record.endTime
    $row.Range.Cells.Item(1, 6).Value2 = [double]$record.durationMin
    $row.Range.Cells.Item(1, 7).Value2 = if ([bool]$record.isBreak) { $breakLabel } else { '' }
  }

  $ws.Columns.AutoFit() | Out-Null
  $wb.Save()
} finally {
  if ($null -ne $wb) { $wb.Close($false) | Out-Null }
  $excel.Quit() | Out-Null
  if ($null -ne $table) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($table) | Out-Null }
  if ($null -ne $ws) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ws) | Out-Null }
  if ($null -ne $wb) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
"#;

    let script_path = std::env::temp_dir().join(format!(
        "minimal_timer_excel_{}_{}.ps1",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    ));
    let mut script_bytes = vec![0xEF, 0xBB, 0xBF];
    script_bytes.extend_from_slice(script.as_bytes());
    fs::write(&script_path, script_bytes).map_err(|e| e.to_string())?;
    let script_path_arg = script_path.to_string_lossy().to_string();

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script_path_arg.as_str(),
            workbook_path,
            json_path,
            "作業記録",
            "休憩",
            "日付",
            "タスク",
            "詳細",
            "開始",
            "終了",
            "時間(分)",
            "休憩",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string());
    let _ = fs::remove_file(&script_path);
    let output = output?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

#[cfg(not(target_os = "windows"))]
fn run_excel_append_script(_workbook_path: &str, _json_path: &str) -> Result<(), String> {
    Err("ローカルExcel追記はWindows版のみ対応しています".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // 円外の透明部分でクリックが通らない問題の対策:
            // JS が passthrough=true にした後、カーソルが円に戻ったことを
            // Win32 GetCursorPos でポーリングして検知し、cursor events を再有効化する
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(32));
                    #[cfg(target_os = "windows")]
                    if CURSOR_PASSTHROUGH.load(Ordering::Relaxed) {
                        if let Some(win) = app_handle.get_webview_window("main") {
                            if cursor_in_circle(&win) {
                                let _ = win.set_ignore_cursor_events(false);
                                CURSOR_PASSTHROUGH.store(false, Ordering::Relaxed);
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_records,
            open_task_window,
            open_pomo_window,
            open_records_devtools,
            hide_records,
            notify_completion,
            dismiss_completion,
            resize_window,
            get_window_position,
            set_window_position,
            append_excel_records,
            set_cursor_passthrough,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "records" {
                    // records ウィンドウの閉じるイベントを横取りして hide に変換
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "task" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "pomo" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "main" {
                    // JS側でセッション保存してから終了
                    api.prevent_close();
                    if let Some(wv) = window.app_handle().get_webview_window("main") {
                        let _ = wv.eval("window.__saveSessionOnExit && window.__saveSessionOnExit()");
                    }
                    let app = window.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(200));
                        app.exit(0);
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
