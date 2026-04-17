import { initStorage, storageGet, storageSet } from './store.js';
import { initWater, resetWater, ensureLoop as waterEnsureLoop } from './water.js';

// ── Constants ──────────────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 126;
const THEMES = ['', 'light', 'sunset'];

// ── State ──────────────────────────────────────────────────────────────────
const st = {
  mode: 'countdown',
  running: false,
  elapsed: 0,
  total: 25 * 60,
  themeIdx: 0,
  pinned: true,
  sessionStart: null,
  breakMode: false,
};

// ── Window size ────────────────────────────────────────────────────────────
let currentWindowSize = 280;

async function applyWindowSize(size) {
  currentWindowSize = size;
  const scale = size / 280;
  document.documentElement.style.width = size + 'px';
  document.documentElement.style.height = size + 'px';
  document.body.style.width = size + 'px';
  document.body.style.height = size + 'px';
  circle.style.zoom = scale;
  storageSet('mt_window_size', size);
  await window.__TAURI__?.core?.invoke?.('resize_window', { size });
}

// ポモドーロ状態
const pomo = {
  active: false,
  totalSets: 4,
  currentSet: 1,
};

// 休憩モード切替時に退避する値
let savedTask = '';
let savedDetail = '';
let savedTotal = 25 * 60;

// ── DOM refs ───────────────────────────────────────────────────────────────
const timerEl = document.getElementById('timer');
const timerInputEl = document.getElementById('timer-input');
const clockEl = document.getElementById('clock');
const ringEl = document.getElementById('ring');
const circle = document.getElementById('circle');
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');
const btnMode = document.getElementById('btn-mode');
const btnTheme = document.getElementById('btn-theme');
const btnPin = document.getElementById('btn-pin');
const btnTask = document.getElementById('btn-task');
const btnRecords = document.getElementById('btn-records');
const btnBreak = document.getElementById('btn-break');
const btnPomo = document.getElementById('btn-pomo');
const pomoStatusEl = document.getElementById('pomo-status');
const syncStatusEl = document.getElementById('sync-status');
const taskNameEl = document.getElementById('task-name');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');

// ── Water animation ────────────────────────────────────────────────────────
initWater(
  document.getElementById('water-canvas'),
  () => ({ fill: Math.min(1, st.elapsed / st.total), running: st.running }),
);

// ── Tauri window API ───────────────────────────────────────────────────────
function tauriWin() {
  return window.__TAURI__?.window?.getCurrentWindow?.();
}

// ── Ring draw ──────────────────────────────────────────────────────────────
function draw() {
  let ratio;
  if (st.mode === 'countdown') {
    ratio = Math.max(0, 1 - st.elapsed / st.total);
  } else {
    ratio = (st.elapsed % 3600) / 3600;
  }
  ringEl.style.strokeDashoffset = CIRCUMFERENCE * (1 - ratio);
  if (st.mode === 'countdown' && !st.breakMode && st.elapsed > 0.01) {
    waterEnsureLoop();
  } else if (st.elapsed <= 0.01) {
    resetWater();
  }
}

// ── Text refresh ───────────────────────────────────────────────────────────
function refreshText() {
  if (st.mode === 'countdown') {
    const rem = Math.max(0, st.total - st.elapsed);
    const m = Math.floor(rem / 60);
    const s = Math.floor(rem % 60);
    timerEl.textContent = `${pad(m)}:${pad(s)}`;
  } else {
    const total = Math.floor(st.elapsed);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    timerEl.textContent = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  clockEl.textContent = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit',
  });
}

const pad = n => String(n).padStart(2, '0');

// ── Tick loop ──────────────────────────────────────────────────────────────
let lastTime = performance.now();
let lastSecond = -1;
let tickId = null;
let clockTickInterval = null;

function startTick() {
  if (clockTickInterval !== null) {
    clearInterval(clockTickInterval);
    clockTickInterval = null;
  }
  if (tickId !== null) return;
  lastTime = performance.now();
  tickId = requestAnimationFrame(tick);
}

function tick(now) {
  tickId = null;
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (st.running) {
    st.elapsed += dt;
    if (st.mode === 'countdown' && st.elapsed >= st.total) {
      st.elapsed = st.total;
      st.running = false;
      setPlayIcon(false);
      logSession();
      if (pomo.active) {
        handlePomoTransition();
      } else {
        startCompletion();
      }
    }
  }

  draw();

  const sec = Math.floor(st.elapsed);
  if (sec !== lastSecond) {
    lastSecond = sec;
    refreshText();
  }

  if (st.running) {
    tickId = requestAnimationFrame(tick);
  } else if (clockTickInterval === null) {
    // 停止中は rAF を止め、時計表示のみ定期更新
    clockTickInterval = setInterval(() => {
      clockEl.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }, 30_000);
  }
}

// ── Play icon helper ───────────────────────────────────────────────────────
const iconStop = document.getElementById('icon-stop');

function setPlayIcon(playing) {
  iconPlay.style.display = playing ? 'none' : '';
  iconStop.style.display = playing ? '' : 'none';
  btnPause.style.display = playing ? '' : 'none';
}

// ── Completion notification ─────────────────────────────────────────────────
let completionActive = false;
let completionStartTime = null;
let completionIntervalId = null;

function updateCompletionDisplay() {
  const elapsed = Math.floor((Date.now() - completionStartTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  timerEl.textContent = `+${pad(m)}:${pad(s)}`;
}

async function startCompletion() {
  if (completionActive) return;
  completionActive = true;
  completionStartTime = Date.now();
  updateCompletionDisplay();
  completionIntervalId = setInterval(updateCompletionDisplay, 1000);
  // 通知時は zoom をリセット（Rust 側が 400px に拡大するため）
  circle.style.zoom = '';
  document.documentElement.classList.add('completion');
  await window.__TAURI__?.core?.invoke?.('notify_completion');
}

async function dismissCompletion() {
  if (!completionActive) return;
  completionActive = false;

  // カウントアップを止めて記録
  if (completionIntervalId !== null) {
    clearInterval(completionIntervalId);
    completionIntervalId = null;
  }
  logOvertimeSession();
  completionStartTime = null;
  st.elapsed = 0;
  st.sessionStart = null;

  document.documentElement.classList.remove('completion');
  await window.__TAURI__?.core?.invoke?.('dismiss_completion');
  // カスタムサイズを復元
  const scale = currentWindowSize / 280;
  document.documentElement.style.width = currentWindowSize + 'px';
  document.documentElement.style.height = currentWindowSize + 'px';
  document.body.style.width = currentWindowSize + 'px';
  document.body.style.height = currentWindowSize + 'px';
  circle.style.zoom = scale;
  // ピン留め状態を復元
  await tauriWin()?.setAlwaysOnTop(st.pinned);
  // タイマー表示を元に戻す
  refreshText();
  draw();
}

// ── Pomodoro ────────────────────────────────────────────────────────────────
function renderPomoStatus() {
  if (!pomo.active) {
    pomoStatusEl.classList.remove('active');
    return;
  }
  pomoStatusEl.classList.add('active');
  let html = '';
  for (let i = 1; i <= pomo.totalSets; i++) {
    const cls = i < pomo.currentSet ? ' done' : i === pomo.currentSet ? ' current' : '';
    html += `<span class="pomo-dot${cls}"></span>`;
  }
  pomoStatusEl.innerHTML = html;
}

function handlePomoTransition() {
  if (!st.breakMode) {
    // 作業フェーズ終了
    if (pomo.currentSet >= pomo.totalSets) {
      // 全セット完了
      pomo.active = false;
      renderPomoStatus();
      btnPomo.classList.remove('active');
      startCompletion();
    } else {
      // 休憩へ
      enterBreak();
      renderPomoStatus();
    }
  } else {
    // 休憩フェーズ終了 → 次の作業セットへ
    exitBreak();
    pomo.currentSet++;
    st.total = 25 * 60;
    st.elapsed = 0;
    st.running = true;
    st.sessionStart = Date.now();
    lastSecond = -1;
    setPlayIcon(true);
    startTick();
    draw();
    renderPomoStatus();
  }
}

function exitPomo() {
  if (!pomo.active) return;
  pomo.active = false;
  renderPomoStatus();
  btnPomo.classList.remove('active');
}

async function openPomoWindow() {
  await window.__TAURI__?.core?.invoke?.('open_pomo_window');
}

// ── Button handlers ────────────────────────────────────────────────────────
// ── Break mode ─────────────────────────────────────────────────────────────
function enterBreak() {
  if (st.breakMode) return;
  // 一時停止中でも、開始済みの作業時間があれば休憩前に記録する
  if (st.sessionStart !== null && st.elapsed >= 5) logSession();
  // 現在のタスクとタイマー設定を退避
  savedTask = currentTask;
  savedDetail = currentDetail;
  savedTotal = st.total;
  // 休憩モードに切替
  st.breakMode = true;
  currentTask = '休憩';
  st.mode = 'countdown';
  st.total = 5 * 60;
  st.elapsed = 0;
  st.running = true;
  st.sessionStart = Date.now();
  lastSecond = -1;
  setPlayIcon(true);
  startTick();
  refreshText();
  renderTaskName();
  draw();
  circle.classList.add('break-mode');
  btnBreak.classList.add('active');
}

function exitBreak() {
  if (!st.breakMode) return;
  st.breakMode = false;
  currentTask = savedTask;
  currentDetail = savedDetail;
  st.total = savedTotal;
  renderTaskName();
  circle.classList.remove('break-mode');
  btnBreak.classList.remove('active');
}

btnBreak.addEventListener('click', () => {
  if (st.breakMode) {
    // 休憩中にもう一度押したら休憩終了
    if (st.running) logSession();
    st.running = false;
    st.elapsed = 0;
    st.sessionStart = null;
    exitBreak();
    lastSecond = -1;
    setPlayIcon(false);
    refreshText();
    draw();
  } else {
    enterBreak();
  }
});

// ── Pomodoro button & panel handlers ───────────────────────────────────────
btnPomo.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (pomo.active) {
    // ポモドーロ停止
    if (st.running) logSession();
    st.running = false;
    st.elapsed = 0;
    st.sessionStart = null;
    lastSecond = -1;
    setPlayIcon(false);
    if (st.breakMode) exitBreak();
    exitPomo();
    refreshText();
    draw();
  } else {
    await openPomoWindow();
  }
});

function startPomo(sets) {
  if (st.running) logSession();
  if (st.breakMode) exitBreak();
  dismissCompletion();
  // ポモドーロ開始
  pomo.active = true;
  pomo.totalSets = sets;
  pomo.currentSet = 1;
  st.mode = 'countdown';
  st.total = 25 * 60;
  st.elapsed = 0;
  st.running = true;
  st.sessionStart = Date.now();
  lastSecond = -1;
  setPlayIcon(true);
  startTick();
  refreshText();
  draw();
  renderPomoStatus();
  btnPomo.classList.add('active');
}

// ── Button handlers ────────────────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  dismissCompletion();
  exitBreak();
  if (st.running) logSession();
  st.running = !st.running;
  if (st.running && st.sessionStart === null) st.sessionStart = Date.now();
  setPlayIcon(st.running);
  if (st.running) startTick();
});

btnPause.addEventListener('click', () => {
  st.running = false;
  setPlayIcon(false);
  // sessionStart は保持（再開時に継続）
});

btnReset.addEventListener('click', () => {
  dismissCompletion();
  exitBreak();
  exitPomo();
  if (st.running) logSession();
  st.running = false;
  st.elapsed = 0;
  st.sessionStart = null;
  lastSecond = -1;
  setPlayIcon(false);
  refreshText();
  draw();
});

btnMode.addEventListener('click', () => {
  dismissCompletion();
  exitBreak();
  exitPomo();
  if (st.running) logSession();
  st.mode = st.mode === 'countdown' ? 'countup' : 'countdown';
  st.running = false;
  st.elapsed = 0;
  st.sessionStart = null;
  lastSecond = -1;
  setPlayIcon(false);
  refreshText();
  draw();
});

btnTheme.addEventListener('click', () => {
  st.themeIdx = (st.themeIdx + 1) % THEMES.length;
  document.body.className = THEMES[st.themeIdx];
  storageSet('mt_theme', THEMES[st.themeIdx]);
  void window.__TAURI__?.event?.emitTo?.('pomo', 'theme-changed', { theme: THEMES[st.themeIdx] });
  void window.__TAURI__?.event?.emitTo?.('task', 'theme-changed', { theme: THEMES[st.themeIdx] });
});

btnPin.addEventListener('click', async () => {
  st.pinned = !st.pinned;
  btnPin.classList.toggle('pinned', st.pinned);
  await tauriWin()?.setAlwaysOnTop(st.pinned);
});

btnRecords.addEventListener('click', async () => {
  closeCtxMenu();
  await window.__TAURI__?.core?.invoke?.('open_records');
});

async function openTaskWindow() {
  closeCtxMenu();
  if (sheetsPanel.classList.contains('open')) closeSheetsPanel();
  await window.__TAURI__?.core?.invoke?.('open_task_window');
}

btnTask.addEventListener('click', async (e) => {
  e.stopPropagation();
  await openTaskWindow();
});

// ── Records context menu (right-click) ─────────────────────────────
const ctxMenu = document.getElementById('records-ctx-menu');
const ctxOpenDevtools = document.getElementById('ctx-open-devtools');

function closeCtxMenu() { ctxMenu.classList.remove('open'); }

btnRecords.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  ctxMenu.classList.toggle('open');
});

ctxMenu.addEventListener('mousedown', (e) => e.stopPropagation());

ctxOpenDevtools.addEventListener('click', async () => {
  closeCtxMenu();
  await window.__TAURI__?.core?.invoke?.('open_records_devtools');
});

// ── Excel / Google Sheets integration setup panel ──────────────────
const ctxSheetsSetup = document.getElementById('ctx-sheets-setup');
const sheetsPanel = document.getElementById('sheets-panel');
const sheetsUrlInput = document.getElementById('sheets-url-input');
const excelPathInput = document.getElementById('excel-path-input');
const sheetsPanelStatus = document.getElementById('sheets-panel-status');
const sheetsCancelBtn = document.getElementById('sheets-cancel-btn');
const sheetsSaveBtn = document.getElementById('sheets-save-btn');

function normalizeExcelPath(path) {
  return path.trim().replace(/^["'“”]+|["'“”]+$/g, '');
}

function saveIntegrationSettings({ showStatus = true } = {}) {
  const url = sheetsUrlInput.value.trim();
  const excelPath = normalizeExcelPath(excelPathInput.value);
  sheetsUrlInput.value = url;
  excelPathInput.value = excelPath;
  storageSet('mt_sheets_url', url);
  storageSet('mt_excel_path', excelPath);
  if (showStatus) {
    sheetsPanelStatus.textContent = (url || excelPath) ? '保存しました' : '設定を削除しました';
  }
  return { url, excelPath };
}

function openSheetsPanel() {
  // Keep the legacy storage key so existing Google Sheets setups stay configured.
  sheetsUrlInput.value = storageGet('mt_sheets_url', '');
  excelPathInput.value = storageGet('mt_excel_path', '');
  const hasIntegration = storageGet('mt_sheets_url', '') || storageGet('mt_excel_path', '');
  sheetsPanelStatus.textContent = hasIntegration ? '設定済み' : '';
  sheetsPanel.classList.add('open');
  sheetsUrlInput.focus();
  sheetsUrlInput.select();
}

function closeSheetsPanel() {
  sheetsPanel.classList.add('closing');
  sheetsPanel.addEventListener('animationend', () => {
    sheetsPanel.classList.remove('open', 'closing');
  }, { once: true });
}

ctxSheetsSetup.addEventListener('click', () => {
  closeCtxMenu();
  openSheetsPanel();
});

sheetsCancelBtn.addEventListener('click', () => closeSheetsPanel());

sheetsSaveBtn.addEventListener('click', () => {
  saveIntegrationSettings();
  setTimeout(() => closeSheetsPanel(), 800);
});

sheetsUrlInput.addEventListener('mousedown', (e) => e.stopPropagation());
excelPathInput.addEventListener('mousedown', (e) => e.stopPropagation());
sheetsUrlInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); sheetsSaveBtn.click(); }
  if (e.key === 'Escape') closeSheetsPanel();
});
excelPathInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); sheetsSaveBtn.click(); }
  if (e.key === 'Escape') closeSheetsPanel();
});
sheetsPanel.addEventListener('mousedown', (e) => e.stopPropagation());

const sheetsBulkBtn = document.getElementById('sheets-bulk-btn');
const excelBulkBtn = document.getElementById('excel-bulk-btn');
let integrationSyncPending = 0;
let integrationSyncHideTimer = null;

function showIntegrationSyncStatus(text, state = 'active') {
  clearTimeout(integrationSyncHideTimer);
  syncStatusEl.className = 'sync-status';
  syncStatusEl.textContent = text;
  if (!text) return;
  syncStatusEl.classList.add('active');
  if (state === 'error') syncStatusEl.classList.add('error');
  if (state === 'success') syncStatusEl.classList.add('success');
}

function hideIntegrationSyncStatus(delay = 0) {
  clearTimeout(integrationSyncHideTimer);
  integrationSyncHideTimer = setTimeout(() => {
    syncStatusEl.className = 'sync-status';
    syncStatusEl.textContent = '';
  }, delay);
}

async function runWithIntegrationSyncStatus(text, fn, { successText = '', errorText = '' } = {}) {
  integrationSyncPending++;
  showIntegrationSyncStatus(text);
  try {
    const result = await fn();
    integrationSyncPending = Math.max(0, integrationSyncPending - 1);
    if (integrationSyncPending === 0) {
      if (successText) {
        showIntegrationSyncStatus(successText, 'success');
        hideIntegrationSyncStatus(1200);
      } else {
        hideIntegrationSyncStatus(150);
      }
    }
    return result;
  } catch (err) {
    integrationSyncPending = Math.max(0, integrationSyncPending - 1);
    if (integrationSyncPending === 0) {
      if (errorText) {
        showIntegrationSyncStatus(errorText, 'error');
        hideIntegrationSyncStatus(1800);
      } else {
        hideIntegrationSyncStatus(150);
      }
    }
    throw err;
  }
}

function sessionToIntegrationRecord(session) {
  const duration = Number(session.duration ?? 0);
  const endedAt = session.endedAt ?? session.timestamp ?? Date.now();
  const startedAt = session.startedAt ?? (endedAt - duration * 1000);
  return {
    date: new Date(startedAt).toLocaleDateString('ja-JP'),
    task: session.task || '(タスクなし)',
    detail: session.detail || '',
    startTime: new Date(startedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    endTime: new Date(endedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    durationMin: Math.round(duration / 60 * 10) / 10,
    isBreak: Boolean(session.isBreak),
  };
}

async function postIntegrationRecords(url, records) {
  await fetch(url, { method: 'POST', body: JSON.stringify(records) });
}

async function appendIntegrationRecordsToExcel(records) {
  const workbookPath = normalizeExcelPath(storageGet('mt_excel_path', ''));
  if (!workbookPath) return 0;
  storageSet('mt_excel_path', workbookPath);
  return await window.__TAURI__?.core?.invoke?.('append_excel_records', { workbookPath, records });
}

async function syncSessionIntegrations(session) {
  const hasUrl = Boolean(storageGet('mt_sheets_url', ''));
  const hasExcel = Boolean(storageGet('mt_excel_path', ''));
  const jobs = [];
  if (hasUrl) jobs.push(syncToIntegrationUrl(session));
  if (hasExcel) jobs.push(syncToLocalExcel(session));
  if (jobs.length === 0) return;
  const statusText = hasExcel ? 'Excel追記中...' : '送信中...';
  await runWithIntegrationSyncStatus(statusText, async () => {
    await Promise.allSettled(jobs);
  }, { successText: hasExcel ? '追記完了' : '送信完了' });
}

sheetsBulkBtn.addEventListener('click', async () => {
  saveIntegrationSettings({ showStatus: false });
  const url = storageGet('mt_sheets_url', '');
  if (!url) {
    sheetsPanelStatus.textContent = '先に URL を保存してください';
    return;
  }
  const allLogs = storageGet('mt_logs', []);
  if (allLogs.length === 0) {
    sheetsPanelStatus.textContent = '送信する記録がありません';
    return;
  }
  sheetsBulkBtn.classList.add('sending');
  sheetsBulkBtn.innerHTML = `送信中<span class="sheets-sending-dots"><span></span><span></span><span></span></span>`;
  sheetsPanelStatus.textContent = `${allLogs.length}件`;
  const body = allLogs.map(sessionToIntegrationRecord);
  try {
    await runWithIntegrationSyncStatus('送信中...', async () => {
      await postIntegrationRecords(url, body);
    }, { successText: '送信完了', errorText: '送信失敗' });
    sheetsPanelStatus.textContent = `✓ ${allLogs.length}件 送信しました`;
  } catch (_) {
    sheetsPanelStatus.textContent = '送信に失敗しました';
  }
  sheetsBulkBtn.classList.remove('sending');
  sheetsBulkBtn.textContent = 'URLへ過去の記録を送信';
});

excelBulkBtn.addEventListener('click', async () => {
  const { excelPath } = saveIntegrationSettings({ showStatus: false });
  const workbookPath = storageGet('mt_excel_path', '');
  if (!workbookPath || !excelPath) {
    sheetsPanelStatus.textContent = '先に Excel パスを保存してください';
    return;
  }
  const allLogs = storageGet('mt_logs', []);
  if (allLogs.length === 0) {
    sheetsPanelStatus.textContent = '追記する記録がありません';
    return;
  }
  excelBulkBtn.classList.add('sending');
  excelBulkBtn.innerHTML = `追記中<span class="sheets-sending-dots"><span></span><span></span><span></span></span>`;
  sheetsPanelStatus.textContent = `${allLogs.length}件`;
  const body = allLogs.map(sessionToIntegrationRecord);
  try {
    await runWithIntegrationSyncStatus('Excel追記中...', async () => {
      await appendIntegrationRecordsToExcel(body);
    }, { successText: '追記完了', errorText: '追記失敗' });
    sheetsPanelStatus.textContent = `✓ ${allLogs.length}件 追記しました`;
  } catch (err) {
    sheetsPanelStatus.textContent = `追記に失敗しました: ${String(err)}`;
  }
  excelBulkBtn.classList.remove('sending');
  excelBulkBtn.textContent = 'Excelへ過去の記録を追記';
});

circle.addEventListener('mousedown', () => closeCtxMenu());
document.addEventListener('click', (e) => {
  if (!ctxMenu.contains(e.target) && e.target !== btnRecords) closeCtxMenu();
});

// ── Timer click → edit mode ────────────────────────────────────────────────
function parseTimeInput(s) {
  s = s.trim();
  // 数字のみ → 分として解釈（最大480分 = 8時間）
  if (/^\d+$/.test(s)) {
    const m = Math.max(1, Math.min(480, parseInt(s)));
    return m * 60;
  }
  // H:MM:SS 形式
  const matchHMS = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (matchHMS) {
    const h = parseInt(matchHMS[1]);
    const m = parseInt(matchHMS[2]);
    const sec = parseInt(matchHMS[3]);
    if (m >= 60 || sec >= 60) return null;
    const total = h * 3600 + m * 60 + sec;
    return Math.max(60, Math.min(28800, total));
  }
  // MM:SS 形式（分:秒）
  const match = s.match(/^(\d{1,3}):(\d{2})$/);
  if (match) {
    const m = parseInt(match[1]);
    const sec = parseInt(match[2]);
    if (sec >= 60) return null;
    const total = m * 60 + sec;
    return Math.max(60, Math.min(28800, total));
  }
  return null;
}

function openEdit() {
  const m = Math.floor(st.total / 60);
  const s = st.total % 60;
  timerInputEl.value = s === 0 ? String(m) : `${pad(m)}:${pad(s)}`;
  timerEl.style.display = 'none';
  timerInputEl.style.display = 'block';
  timerInputEl.focus();
  timerInputEl.select();
}

function closeEdit(commit) {
  if (commit) {
    const parsed = parseTimeInput(timerInputEl.value);
    if (parsed !== null) {
      st.total = parsed;
      st.elapsed = 0;
      lastSecond = -1;
    }
  }
  timerInputEl.style.display = 'none';
  timerEl.style.display = '';
  refreshText();
  draw();
}

circle.addEventListener('mouseenter', () => {
  if (!st.running && st.mode === 'countdown') timerEl.classList.add('editable');
});
circle.addEventListener('mouseleave', () => {
  timerEl.classList.remove('editable');
});

timerEl.addEventListener('click', () => {
  if (st.running || st.mode !== 'countdown') return;
  openEdit();
});

timerInputEl.addEventListener('mousedown', (e) => e.stopPropagation());
timerInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); closeEdit(true); }
  if (e.key === 'Escape') closeEdit(false);
});
timerInputEl.addEventListener('blur', () => closeEdit(true));

// ── Enter key → start / stop ───────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (timerInputEl.style.display === 'block') return;
  e.preventDefault();
  if (completionActive) { dismissCompletion(); return; }
  if (st.running) logSession();
  st.running = !st.running;
  if (st.running && st.sessionStart === null) st.sessionStart = Date.now();
  setPlayIcon(st.running);
  if (st.running) startTick();
});

// ── Task state ─────────────────────────────────────────────────────────────
let currentTask = '';
let currentDetail = '';

function renderTaskName() {
  taskNameEl.textContent = currentDetail ? `${currentTask} / ${currentDetail}` : currentTask;
}

function applyTaskState(payload = {}) {
  const nextTask = payload.task || '';
  const nextDetail = payload.detail || '';
  const shouldLog = Boolean(payload.logPrevious);
  const changed = currentTask !== nextTask || currentDetail !== nextDetail;

  if (st.breakMode) {
    savedTask = nextTask;
    savedDetail = nextDetail;
    return;
  }

  if (changed && st.running && shouldLog) {
    logSession();
    st.sessionStart = Date.now();
  }

  currentTask = nextTask;
  currentDetail = nextDetail;
  renderTaskName();
}

circle.addEventListener('click', () => {
  if (completionActive) { dismissCompletion(); return; }
});

// ── Session logging ────────────────────────────────────────────────────────
let logs = [];

function logSession({ sync = true } = {}) {
  const duration = Math.floor(st.elapsed);
  if (duration < 5) return null;
  const endedAt = Date.now();
  const startedAt = st.sessionStart ?? (endedAt - duration * 1000);
  st.sessionStart = null;
  const session = {
    id: Math.random().toString(36).slice(2),
    task: currentTask || '(タスクなし)',
    detail: currentDetail || null,
    duration,
    startedAt,
    endedAt,
    mode: st.mode,
    isBreak: st.breakMode,
  };
  logs.push(session);
  storageSet('mt_logs', logs);
  if (sync) syncSessionIntegrations(session);
  return session;
}

function logOvertimeSession({ sync = true } = {}) {
  if (completionStartTime === null) return null;
  const overDuration = Math.floor((Date.now() - completionStartTime) / 1000);
  if (overDuration < 5) return null;
  const session = {
    id: Math.random().toString(36).slice(2),
    task: currentTask || '(タスクなし)',
    detail: currentDetail || null,
    duration: overDuration,
    startedAt: completionStartTime,
    endedAt: Date.now(),
    mode: 'countup',
    isBreak: false,
  };
  logs.push(session);
  storageSet('mt_logs', logs);
  if (sync) syncSessionIntegrations(session);
  return session;
}

// ── Excel / Google Sheets sync ─────────────────────────────────────────────
async function syncToIntegrationUrl(session) {
  const url = storageGet('mt_sheets_url', '');
  if (!url) return;
  try {
    await postIntegrationRecords(url, [sessionToIntegrationRecord(session)]);
  } catch (_) {
    // ネットワークエラーは無視（アプリの動作を止めない）
  }
}

async function syncToLocalExcel(session) {
  try {
    await appendIntegrationRecordsToExcel([sessionToIntegrationRecord(session)]);
  } catch (_) {
    // Excel追記エラーは無視（アプリの動作を止めない）
  }
}

// ── Save session on exit ───────────────────────────────────────────────────
window.__saveSessionOnExit = async () => {
  if (completionActive) {
    const session = logOvertimeSession({ sync: false });
    if (session) await syncSessionIntegrations(session);
  } else if (st.running) {
    const session = logSession({ sync: false });
    if (session) await syncSessionIntegrations(session);
  }
  const pos = await window.__TAURI__?.core?.invoke?.('get_window_position');
  if (pos) storageSet('mt_window_pos', pos);
};

// ── Scroll → resize window (Ctrl) or adjust countdown total ───────────────
circle.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    // Ctrl+スクロール: ウィンドウリサイズ
    const delta = e.deltaY > 0 ? -10 : 10;
    const newSize = Math.max(140, Math.min(560, currentWindowSize + delta));
    applyWindowSize(newSize);
    return;
  }
  // 通常スクロール: カウントダウン時間調整（停止中のみ）
  if (st.running) return;
  const delta = e.deltaY > 0 ? 60 : -60;
  st.total = Math.max(60, Math.min(28800, st.total + delta));
  refreshText();
  draw();
}, { passive: false });

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  await initStorage();

  applyTaskState({
    task: storageGet('mt_current_task', ''),
    detail: storageGet('mt_current_detail', ''),
    logPrevious: false,
  });
  logs = storageGet('mt_logs', []);
  await window.__TAURI__?.event?.listen?.('task-state-changed', ({ payload }) => {
    applyTaskState(payload ?? {});
  }, { target: 'main' });
  await window.__TAURI__?.event?.listen?.('pomo-start', ({ payload }) => {
    startPomo(payload?.sets ?? 4);
  }, { target: 'main' });

  const savedTheme = storageGet('mt_theme', '');
  document.body.className = savedTheme;
  st.themeIdx = THEMES.indexOf(savedTheme);
  if (st.themeIdx < 0) st.themeIdx = 0;

  currentWindowSize = storageGet('mt_window_size', 280);

  refreshText();
  renderTaskName();
  if (currentWindowSize !== 280) applyWindowSize(currentWindowSize);
  // 前回のウィンドウ位置を復元
  const savedPos = storageGet('mt_window_pos', null);
  if (savedPos) {
    await window.__TAURI__?.core?.invoke?.('set_window_position', { x: savedPos[0], y: savedPos[1] });
  }
  // デフォルトで前面固定
  btnPin.classList.add('pinned');
  await tauriWin()?.setAlwaysOnTop(true);

  // 停止状態で起動するため rAF は使わず、時計のみ定期更新
  clockTickInterval = setInterval(() => {
    clockEl.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }, 30_000);
})();

// ── Cursor passthrough for transparent corners ──────────────────────
// 円の外（透明コーナー部分）ではクリックを背後のウィンドウに通す
let _cursorPassthrough = false;
document.addEventListener('mousemove', (e) => {
  const rect = circle.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const r  = rect.width / 2;
  const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const shouldPassthrough = !inCircle;
  if (shouldPassthrough !== _cursorPassthrough) {
    _cursorPassthrough = shouldPassthrough;
    window.__TAURI__?.core?.invoke?.('set_cursor_passthrough', { ignore: shouldPassthrough });
  }
});
