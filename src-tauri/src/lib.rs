use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

/// records ウィンドウを取得または再作成して返す
fn get_or_create_records(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    // 既存のウィンドウがあればそれを返す
    if let Some(win) = app.get_webview_window("records") {
        let _ = win.eval("window.refreshRecords && window.refreshRecords()");
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
    .inner_size(480.0, 660.0)
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
fn append_excel_records(
    workbook_path: String,
    records: Vec<IntegrationRecord>,
) -> Result<usize, String> {
    if records.is_empty() {
        return Ok(0);
    }

    let workbook_path = workbook_path
        .trim()
        .trim_matches(|c| matches!(c, '"' | '\'' | '“' | '”'))
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
    let result = run_excel_append_script(&workbook_path, temp_path.to_string_lossy().as_ref());
    let _ = fs::remove_file(&temp_path);

    result.map(|_| records.len())
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

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
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
        .invoke_handler(tauri::generate_handler![
            open_records,
            open_records_devtools,
            hide_records,
            notify_completion,
            dismiss_completion,
            resize_window,
            get_window_position,
            set_window_position,
            append_excel_records,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "records" {
                    // records ウィンドウの閉じるイベントを横取りして hide に変換
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
