// ── Persistent storage ─────────────────────────────────────────────
// localStorage を実行時ストアとして使い（複数ウィンドウ間で共有される）、
// 同期対象キーは OneDrive 等の同期フォルダ上の JSON ファイルへミラーする。
// 起動時（main ウィンドウのみ）にファイルとローカルの新旧を比較して取り込む。
const _cache = {};

// 複数PCで共有するキー
const SYNC_KEYS = [
  'mt_theme', 'mt_tasks', 'mt_current_task', 'mt_current_detail',
  'mt_logs', 'mt_sheets_url', 'mt_excel_path',
  'mt_template', 'mt_active_items', 'mt_active_set',
];
// このPC固有のキー（ウィンドウ位置・カメラ設定など）
const LOCAL_KEYS = [
  'mt_window_size', 'mt_window_pos',
  'mt_timelapse_enabled', 'mt_timelapse_camera_id', 'mt_timelapse_interval_sec',
  'mt_timelapse_fps', 'mt_timelapse_resolution',
  'mt_data_path', 'mt_data_synced_at', 'mt_data_modified_at',
];

function invoke(cmd, args) {
  return window.__TAURI__?.core?.invoke?.(cmd, args);
}

function readLocal(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

function writeLocal(key, value) {
  _cache[key] = value;
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export async function initStorage({ syncFile = false } = {}) {
  for (const key of [...SYNC_KEYS, ...LOCAL_KEYS]) {
    const v = readLocal(key);
    if (v !== undefined) _cache[key] = v;
  }
  if (syncFile) {
    try {
      await syncFromFile();
    } catch (e) {
      // ファイル同期に失敗してもローカルデータで動作を続ける
      console.warn('[store] データファイル同期に失敗', e);
    }
  }
}

export function storageGet(key, def = null) {
  const v = _cache[key];
  return v !== undefined ? v : def;
}

// localStorage から常に最新値を読む（他ウィンドウでの変更を取り込む）。
// mt_logs のように複数ウィンドウが書き込むキーは、変更前にこれで再取得しないと
// 古いキャッシュで上書きして他ウィンドウの編集を消してしまう。
export function storageGetFresh(key, def = null) {
  const v = readLocal(key);
  if (v === undefined) return def;
  _cache[key] = v;
  return v;
}

export async function storageSet(key, value) {
  writeLocal(key, value);
  if (SYNC_KEYS.includes(key)) {
    writeLocal('mt_data_modified_at', Date.now());
    scheduleFileWrite();
  }
}

export async function storageClear(key) {
  delete _cache[key];
  localStorage.removeItem(key);
  if (SYNC_KEYS.includes(key)) {
    writeLocal('mt_data_modified_at', Date.now());
    scheduleFileWrite();
  }
}

// ── Synced data file ───────────────────────────────────────────────

export async function getDataFilePath() {
  const saved = readLocal('mt_data_path');
  if (typeof saved === 'string' && saved.trim()) return saved.trim();
  const path = await invoke('get_default_data_path');
  if (path) writeLocal('mt_data_path', path);
  return path || '';
}

// 保存先を変更する。変更先に既存ファイルがあればログを統合して取り込む
export async function setDataFilePath(path) {
  const trimmed = String(path || '').trim();
  const resolved = trimmed || (await invoke('get_default_data_path')) || '';
  if (!resolved) throw new Error('保存先を決定できません');
  // 旧保存先への未書き込み分を確定させてから切り替える
  await flushStorage();
  writeLocal('mt_data_path', resolved);
  // 新しいファイルは未知の状態として扱い、ローカルデータと統合させる
  writeLocal('mt_data_synced_at', 0);
  writeLocal('mt_data_modified_at', Date.now());
  await syncFromFile();
  return resolved;
}

async function syncFromFile() {
  const path = await getDataFilePath();
  if (!path) return;
  const raw = await invoke('read_data_file', { path });
  const syncedAt = Number(readLocal('mt_data_synced_at')) || 0;
  const modifiedAt = Number(readLocal('mt_data_modified_at')) || 0;
  // 一度も同期していない環境に既存ログがある場合（旧バージョンからの移行）は
  // 「ローカルに変更あり」として扱い、ファイル側で上書きせず必ず統合する
  const localLogs = readLocal('mt_logs');
  const neverSyncedWithData = syncedAt === 0 && Array.isArray(localLogs) && localLogs.length > 0;
  const localDirty = modifiedAt > syncedAt || neverSyncedWithData;

  if (raw == null) {
    // ファイル未作成（初回移行）→ 現在のローカルデータで作成
    await flushStorage();
    return;
  }
  let file;
  try {
    file = JSON.parse(raw);
  } catch {
    console.warn('[store] データファイルが壊れています。ローカルデータで作り直します');
    await flushStorage();
    return;
  }
  const fileSavedAt = Number(file?.savedAt) || 0;
  const data = file?.data ?? {};

  if (fileSavedAt <= syncedAt) {
    // ファイルは既知の状態のまま → ローカル優先。未書き込みの変更があれば反映
    if (localDirty) await flushStorage();
    return;
  }
  if (localDirty) {
    // 両方に変更あり → ログはID単位・タスクは名前単位で統合、
    // その他はファイル側を優先しつつ、ファイルに無いキーはローカル値を残す
    data.mt_logs = mergeLogs(readLocal('mt_logs'), data.mt_logs);
    data.mt_tasks = mergeTasks(readLocal('mt_tasks'), data.mt_tasks);
    for (const key of SYNC_KEYS) {
      if (data[key] === undefined && readLocal(key) !== undefined) data[key] = readLocal(key);
    }
    adoptFileData(data);
    await flushStorage();
  } else {
    adoptFileData(data);
    writeLocal('mt_data_synced_at', fileSavedAt);
  }
}

function adoptFileData(data) {
  for (const key of SYNC_KEYS) {
    if (data[key] !== undefined) {
      writeLocal(key, data[key]);
    } else {
      delete _cache[key];
      localStorage.removeItem(key);
    }
  }
}

function mergeLogs(a, b) {
  const byId = new Map();
  for (const s of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!s || typeof s !== 'object') continue;
    // id を持たない旧形式エントリは時刻+タスク+長さで同一判定する
    const id = s.id
      ?? `${s.startedAt ?? s.timestamp ?? ''}-${s.endedAt ?? s.timestamp ?? ''}-${s.task ?? ''}-${s.duration ?? ''}`;
    if (!byId.has(id)) byId.set(id, s);
  }
  return [...byId.values()].sort(
    (x, y) => (x.endedAt ?? x.timestamp ?? 0) - (y.endedAt ?? y.timestamp ?? 0),
  );
}

function mergeTasks(a, b) {
  const norm = (raw) => (Array.isArray(raw) ? raw : []).map((t) =>
    typeof t === 'string'
      ? { name: t, details: [] }
      : {
          name: String(t?.name ?? '').trim(),
          details: Array.isArray(t?.details) ? t.details.map(String).filter(Boolean) : [],
        },
  ).filter((t) => t.name);
  const out = new Map();
  // ファイル側の並びを優先し、ローカルのみのタスクは後ろに追加
  for (const t of [...norm(b), ...norm(a)]) {
    const cur = out.get(t.name);
    if (!cur) {
      out.set(t.name, { name: t.name, details: [...t.details] });
    } else {
      for (const d of t.details) if (!cur.details.includes(d)) cur.details.push(d);
    }
  }
  return [...out.values()];
}

let _writeTimer = null;

function scheduleFileWrite() {
  clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    writeFileNow();
  }, 800);
}

async function writeFileNow() {
  try {
    const path = await getDataFilePath();
    if (!path) return;
    const data = {};
    for (const key of SYNC_KEYS) {
      // 他ウィンドウの変更も含めるため localStorage から直接読む
      const v = readLocal(key);
      if (v !== undefined) data[key] = v;
    }
    const savedAt = Date.now();
    await invoke('write_data_file', {
      path,
      contents: JSON.stringify({ version: 1, savedAt, data }),
    });
    writeLocal('mt_data_synced_at', savedAt);
  } catch (e) {
    console.warn('[store] データファイル書き込みに失敗', e);
  }
}

// 保留中の書き込みを即時実行する（アプリ終了時用）
export async function flushStorage() {
  clearTimeout(_writeTimer);
  _writeTimer = null;
  await writeFileNow();
}
