import { initStorage, storageGet, storageGetFresh, storageSet, flushStorage, getDataFilePath, setDataFilePath } from './store.js';
import { initWater, resetWater, ensureLoop as waterEnsureLoop } from './water.js';
import * as timelapse from './timelapse.js';
import * as tasks from './tasks.js';
import * as noteui from './noteui.js';

// ── Constants ──────────────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 126;
const THEMES = ['', 'light', 'sunset'];

// ── State ──────────────────────────────────────────────────────────────────
const st = {
  mode: 'countdown',
  elapsed: 0,
  total: 25 * 60,
  themeIdx: 0,
  pinned: true,
  sessionStart: null,
  breakMode: false,
};

// st.running は他のコードから単純な代入で更新されるが、
// タイムラプス記録の開始/停止フックのため setter で監視する
let _running = false;
Object.defineProperty(st, 'running', {
  get() { return _running; },
  set(v) {
    const next = Boolean(v);
    if (next === _running) return;
    _running = next;
    onRunningChanged(next);
  },
});

function onRunningChanged(running) {
  if (running) {
    const label = currentTask
      ? (currentDetail ? `${currentTask}_${currentDetail}` : currentTask)
      : (st.breakMode ? '休憩' : 'session');
    timelapse.start({ task: label }).catch((e) => console.warn('[timelapse] start failed', e));
  } else {
    timelapse.stop({ save: true }).catch((e) => console.warn('[timelapse] stop failed', e));
  }
}

// ── Window size (classic / circle) ──────────────────────────────────────────
let currentWindowSize = 280;
let classicOpen = false;                 // 円テンプレートで作業リストのドロワーを開いているか
const CLASSIC_DRAWER_MAX = 260;          // ドロワーの最大高さ（超えるとリスト内スクロール）
const CLASSIC_DRAWER_GAP = 6;            // 円とドロワーの隙間

async function applyWindowSize(size) {
  currentWindowSize = Math.max(140, Math.min(560, size));
  circle.style.zoom = currentWindowSize / 280;
  storageSet('mt_window_size', currentWindowSize);
  await applyClassicGeometry();
}

// 円 + （開いていれば）作業リストのドロワーに合わせてウィンドウ矩形を決める。
// 円は上部の正方形に固定し、ドロワーはその下へ展開する。
async function applyClassicGeometry() {
  const size = currentWindowSize;
  let h = size;
  if (classicOpen && classicTasksEl) {
    classicTasksEl.style.display = 'flex';
    classicTasksEl.style.width = size + 'px';
    classicTasksEl.style.top = (size + CLASSIC_DRAWER_GAP) + 'px';
    const drawerH = measureClassicDrawer();
    h = size + CLASSIC_DRAWER_GAP + drawerH;
  } else if (classicTasksEl) {
    classicTasksEl.style.display = 'none';
  }
  document.documentElement.style.width = size + 'px';
  document.body.style.width = size + 'px';
  document.documentElement.style.height = h + 'px';
  document.body.style.height = h + 'px';
  await window.__TAURI__?.core?.invoke?.('resize_window_rect', { width: size, height: h });
}

// ドロワーの中身に合わせた高さを求め、上限を超える分はリストをスクロールさせる。
function measureClassicDrawer() {
  const listEl = classicList;
  const prevMax = listEl.style.maxHeight, prevOv = listEl.style.overflowY;
  listEl.style.maxHeight = 'none';
  listEl.style.overflowY = 'visible';
  const naturalH = classicTasksEl.offsetHeight;
  const listNaturalH = listEl.scrollHeight;
  const nonListH = Math.max(0, naturalH - listNaturalH);
  let drawerH, listMax = 'none';
  if (naturalH <= CLASSIC_DRAWER_MAX) {
    drawerH = naturalH;
  } else {
    drawerH = CLASSIC_DRAWER_MAX;
    listMax = Math.max(48, CLASSIC_DRAWER_MAX - nonListH) + 'px';
  }
  listEl.style.maxHeight = listMax;
  listEl.style.overflowY = listMax === 'none' ? '' : 'auto';
  return drawerH;
}

function toggleClassicDrawer() {
  classicOpen = !classicOpen;
  storageSet('mt_classic_open', classicOpen);
  classicListToggle?.classList.toggle('open', classicOpen);
  classicTasksEl?.setAttribute('aria-hidden', String(!classicOpen));
  applyClassicGeometry();
}

// ドロワー見出しの件数バッジを更新する
function updateClassicCount() {
  if (!classicCount) return;
  const { done, total } = tasks.leafProgress();
  classicCount.textContent = total ? `${done}/${total}` : '';
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

// ── Note / Chalk template refs ───────────────────────────────────────────────
const noteTpl = document.getElementById('note-tpl');
const noteTimer = document.getElementById('note-timer');
const noteTimerInput = document.getElementById('note-timer-input');
const noteClock = document.getElementById('note-clock');
const noteDate = document.getElementById('note-date');
const noteProgress = document.getElementById('note-progress');
const noteTally = document.getElementById('note-tally');
const noteChev = document.getElementById('note-chev');
const noteList = document.getElementById('note-list');
const noteAddInput = document.getElementById('note-add-input');
const notePin = document.getElementById('note-pin');
const notePlayBtn = document.getElementById('note-play');
const notePauseBtn = document.getElementById('note-pause');

// ── Classic (circle) task drawer refs ────────────────────────────────────────
const classicTasksEl = document.getElementById('classic-tasks');
const classicList = document.getElementById('classic-list');
const classicAddInput = document.getElementById('classic-add-input');
const classicCount = document.getElementById('classic-count');
const classicListToggle = document.getElementById('classic-list-toggle');

// テンプレート状態（'note' | 'chalk' | 'classic'）
// ノート/黒板のウィンドウ幾何（自動高さ・リサイズ・拡大縮小・開閉）は noteui.js が担当する。
let template = 'note';

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
  if (noteProgress) {
    const fill = st.mode === 'countdown' ? Math.min(1, st.elapsed / st.total) : ratio;
    noteProgress.style.width = (fill * 100) + '%';
  }
  if (st.mode === 'countdown' && !st.breakMode && st.elapsed > 0.01) {
    waterEnsureLoop();
  } else if (st.elapsed <= 0.01) {
    resetWater();
  }
}

// ── Text refresh ───────────────────────────────────────────────────────────
function refreshText() {
  let timeStr;
  if (st.mode === 'countdown') {
    const rem = Math.max(0, st.total - st.elapsed);
    const m = Math.floor(rem / 60);
    const s = Math.floor(rem % 60);
    timeStr = `${pad(m)}:${pad(s)}`;
  } else {
    const total = Math.floor(st.elapsed);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    timeStr = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  timerEl.textContent = timeStr;
  if (noteTimer && !completionActive) noteTimer.textContent = timeStr;
  const clockStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  clockEl.textContent = clockStr;
  if (noteClock) noteClock.textContent = clockStr;
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
  if (notePlayBtn) notePlayBtn.textContent = playing ? '■' : '▶';
  if (notePauseBtn) notePauseBtn.style.display = playing ? '' : 'none';
  syncNoteButtons();
}

// ノートのトグルボタン状態（休憩/ポモ/ピン）を円側の状態に同期
function syncNoteButtons() {
  document.getElementById('note-break')?.classList.toggle('active', st.breakMode);
  document.getElementById('note-pomo')?.classList.toggle('active', pomo.active);
  notePin?.classList.toggle('pinned', st.pinned);
}

// ノートのタリー（ポモドーロのセット進捗）を描画
function renderNoteTally() {
  if (!noteTally) return;
  if (pomo.active) {
    let marks = '';
    for (let i = 1; i <= pomo.totalSets; i++) marks += `<i class="${i <= pomo.currentSet ? 'on' : ''}"></i>`;
    noteTally.innerHTML = `<span>セット</span><span class="marks">${marks}</span><span>${pomo.currentSet} / ${pomo.totalSets}</span>`;
  } else {
    noteTally.innerHTML = '';
  }
}

// ── Completion notification ─────────────────────────────────────────────────
let completionActive = false;
let completionStartTime = null;
let completionIntervalId = null;

function updateCompletionDisplay() {
  const elapsed = Math.floor((Date.now() - completionStartTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const str = `+${pad(m)}:${pad(s)}`;
  timerEl.textContent = str;
  if (noteTimer) noteTimer.textContent = str;
}

async function startCompletion() {
  if (completionActive) return;
  // 1 セット終了 → 未完了の作業を次セットへ持ち越し、完了はアーカイブ
  tasks.carryOverNewSet();
  renderNoteTally();
  completionActive = true;
  completionStartTime = Date.now();
  updateCompletionDisplay();
  completionIntervalId = setInterval(updateCompletionDisplay, 1000);
  // 円テンプレートのみウィンドウを拡大する演出（縦長では行わない）
  if (template === 'classic') {
    circle.style.zoom = '';
    document.documentElement.classList.add('completion');
    await window.__TAURI__?.core?.invoke?.('notify_completion');
  }
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
  if (template === 'classic') {
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
  }
  // タイマー表示を元に戻す
  refreshText();
  draw();
}

// ── Pomodoro ────────────────────────────────────────────────────────────────
function renderPomoStatus() {
  renderNoteTally();
  syncNoteButtons();
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
  // 休憩に入る時は進行中の作業計測を止める（記録は確定）
  tasks.flushAllRunning();
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
  syncNoteButtons();
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
  syncNoteButtons();
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
  if (st.running) {
    logSession();
    st.elapsed = 0;
    lastSecond = -1;
  }
  st.running = !st.running;
  if (st.running && st.sessionStart === null) st.sessionStart = Date.now();
  setPlayIcon(st.running);
  if (st.running) startTick();
  refreshText();
  draw();
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
  tasks.flushAllRunning();
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

document.getElementById('ctx-template')?.addEventListener('click', () => {
  closeCtxMenu();
  cycleTemplate();
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

// ── Data file path panel ───────────────────────────────────────────
const ctxDatapathSetup = document.getElementById('ctx-datapath-setup');
const dpPanel = document.getElementById('datapath-panel');
const dpInput = document.getElementById('datapath-input');
const dpStatus = document.getElementById('datapath-status');
const dpCancelBtn = document.getElementById('datapath-cancel-btn');
const dpSaveBtn = document.getElementById('datapath-save-btn');

async function openDatapathPanel() {
  dpInput.value = await getDataFilePath();
  dpStatus.textContent = '';
  dpPanel.classList.add('open');
  dpInput.focus();
}

function closeDatapathPanel() {
  dpPanel.classList.add('closing');
  dpPanel.addEventListener('animationend', () => {
    dpPanel.classList.remove('open', 'closing');
  }, { once: true });
}

ctxDatapathSetup.addEventListener('click', () => {
  closeCtxMenu();
  if (sheetsPanel.classList.contains('open')) closeSheetsPanel();
  const tlPanelEl = document.getElementById('timelapse-panel');
  if (tlPanelEl.classList.contains('open')) {
    tlPanelEl.classList.add('closing');
    tlPanelEl.addEventListener('animationend', () => {
      tlPanelEl.classList.remove('open', 'closing');
    }, { once: true });
  }
  openDatapathPanel();
});

dpCancelBtn.addEventListener('click', () => closeDatapathPanel());

dpSaveBtn.addEventListener('click', async () => {
  dpStatus.textContent = '切り替え中...';
  try {
    const resolved = await setDataFilePath(dpInput.value);
    dpInput.value = resolved;
    // 既存ファイルからの統合結果をメモリ上のログへ反映
    logs = storageGet('mt_logs', []);
    dpStatus.textContent = '保存しました';
    setTimeout(() => closeDatapathPanel(), 800);
  } catch (e) {
    dpStatus.textContent = `保存に失敗: ${e}`;
  }
});

dpInput.addEventListener('mousedown', (e) => e.stopPropagation());
dpInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); dpSaveBtn.click(); }
  if (e.key === 'Escape') closeDatapathPanel();
});
dpPanel.addEventListener('mousedown', (e) => e.stopPropagation());

// ── Timelapse settings panel ───────────────────────────────────────
const ctxTimelapseSetup = document.getElementById('ctx-timelapse-setup');
const tlPanel        = document.getElementById('timelapse-panel');
const tlEnabledEl    = document.getElementById('tl-enabled');
const tlCameraEl     = document.getElementById('tl-camera');
const tlIntervalEl   = document.getElementById('tl-interval');
const tlFpsEl        = document.getElementById('tl-fps');
const tlResolutionEl = document.getElementById('tl-resolution');
const tlStatusEl     = document.getElementById('tl-status');
const tlCancelBtn    = document.getElementById('tl-cancel-btn');
const tlSaveBtn      = document.getElementById('tl-save-btn');
const tlOpenFolderBtn= document.getElementById('tl-open-folder-btn');
const tlIndicator    = document.getElementById('tl-indicator');

function tlPanelOpen() { return tlPanel.classList.contains('open'); }

async function openTimelapsePanel() {
  const settings = timelapse.getSettings();
  tlEnabledEl.checked    = !!settings.enabled;
  tlIntervalEl.value     = settings.intervalSec;
  tlFpsEl.value          = settings.fps;
  tlResolutionEl.value   = settings.resolution;
  tlStatusEl.textContent = '';
  tlCameraEl.innerHTML   = `<option value="">読み込み中...</option>`;
  tlPanel.classList.add('open');

  try {
    const cams = await timelapse.listCameras();
    if (cams.length === 0) {
      tlCameraEl.innerHTML = `<option value="">カメラが見つかりません</option>`;
    } else {
      tlCameraEl.innerHTML = `<option value="">自動選択</option>` +
        cams.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
      tlCameraEl.value = settings.cameraId || '';
    }
  } catch (e) {
    tlCameraEl.innerHTML = `<option value="">アクセス不可</option>`;
    tlStatusEl.textContent = 'カメラアクセスが許可されていません';
  }
}

function closeTimelapsePanel() {
  tlPanel.classList.add('closing');
  tlPanel.addEventListener('animationend', () => {
    tlPanel.classList.remove('open', 'closing');
  }, { once: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

ctxTimelapseSetup.addEventListener('click', () => {
  closeCtxMenu();
  if (sheetsPanel.classList.contains('open')) closeSheetsPanel();
  if (dpPanel.classList.contains('open')) closeDatapathPanel();
  openTimelapsePanel();
});

tlCancelBtn.addEventListener('click', () => closeTimelapsePanel());

tlSaveBtn.addEventListener('click', () => {
  timelapse.saveSettings({
    enabled:     tlEnabledEl.checked,
    cameraId:    tlCameraEl.value,
    intervalSec: tlIntervalEl.value,
    fps:         tlFpsEl.value,
    resolution:  tlResolutionEl.value,
  });
  tlStatusEl.textContent = '保存しました';
  setTimeout(() => closeTimelapsePanel(), 600);
});

tlOpenFolderBtn.addEventListener('click', async () => {
  try { await timelapse.openFolder(); } catch (e) {
    tlStatusEl.textContent = 'フォルダを開けませんでした';
  }
});

tlPanel.addEventListener('mousedown', (e) => e.stopPropagation());
[tlIntervalEl, tlFpsEl].forEach((el) => {
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); tlSaveBtn.click(); }
    if (e.key === 'Escape') closeTimelapsePanel();
  });
});
tlCameraEl.addEventListener('mousedown', (e) => e.stopPropagation());
tlResolutionEl.addEventListener('mousedown', (e) => e.stopPropagation());

timelapse.onStatusChange((s) => {
  if (s.recording) {
    tlIndicator.classList.add('active');
  } else {
    tlIndicator.classList.remove('active');
  }
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
  if (noteTimerInput.style.display === 'block') return;
  e.preventDefault();
  if (completionActive) { dismissCompletion(); return; }
  if (st.running) {
    logSession();
    st.elapsed = 0;
    lastSecond = -1;
  }
  st.running = !st.running;
  if (st.running && st.sessionStart === null) st.sessionStart = Date.now();
  setPlayIcon(st.running);
  if (st.running) startTick();
  refreshText();
  draw();
});

// ── Keyboard: T でデザインテンプレートを循環（円↔ノート↔黒板） ─────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 't' && e.key !== 'T') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (timerInputEl.style.display === 'block' || noteTimerInput.style.display === 'block') return;
  e.preventDefault();
  cycleTemplate();
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
  // 記録ウィンドウでの削除・追加を上書きしないよう最新値へ追記する
  logs = storageGetFresh('mt_logs', []);
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
  logs = storageGetFresh('mt_logs', []);
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
  // 保留中のデータファイル書き込みを終了前に確定させる
  await flushStorage();
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

// ── Design template (note / chalk / classic) ───────────────────────────────
async function applyTemplate(tpl) {
  template = (tpl === 'classic' || tpl === 'chalk') ? tpl : 'note';
  document.documentElement.dataset.template = template;
  storageSet('mt_template', template);
  if (template === 'classic') {
    // 円テンプレート: 正方形の円 + 下に展開する作業リストのドロワー
    noteui.setActive(false);
    tasks.setContainer(classicList, classicAddInput);
    updateClassicCount();
    await applyWindowSize(currentWindowSize);   // circle zoom + drawer geometry
  } else {
    // ノート/黒板: 中身に合わせた縦長長方形（幾何は noteui.js が管理）
    circle.style.zoom = '';
    tasks.setContainer(noteList, noteAddInput);
    noteui.setActive(true);
  }
  refreshText();
  draw();
  syncNoteButtons();
}

function cycleTemplate() {
  const order = ['note', 'chalk', 'classic'];
  applyTemplate(order[(order.indexOf(template) + 1) % order.length]);
}

// 作業リストの行数が変わるたびに呼ばれ、表示中テンプレートの高さを調整する。
function onTaskLayoutChanged() {
  if (template === 'classic') {
    updateClassicCount();
    if (classicOpen) applyClassicGeometry();
  } else {
    noteui.refit({ animate: false });
  }
}

// ノートのタイマー編集（円の openEdit/closeEdit と同じ挙動）
function openNoteEdit() {
  const m = Math.floor(st.total / 60);
  const s = st.total % 60;
  noteTimerInput.value = s === 0 ? String(m) : `${pad(m)}:${pad(s)}`;
  noteTimer.style.display = 'none';
  noteTimerInput.style.display = 'block';
  noteTimerInput.focus();
  noteTimerInput.select();
}
function closeNoteEdit(commit) {
  if (commit) {
    const parsed = parseTimeInput(noteTimerInput.value);
    if (parsed !== null) { st.total = parsed; st.elapsed = 0; lastSecond = -1; }
  }
  noteTimerInput.style.display = 'none';
  noteTimer.style.display = '';
  refreshText();
  draw();
}

// 進行中タスクの計測区間を記録（mt_logs へ。records / Excel / Sheets 連携もそのまま流れる）
function logTaskSpan(span) {
  const duration = Math.floor(span.duration);
  if (duration < 5) return;
  const session = {
    id: Math.random().toString(36).slice(2),
    task: span.text || '(タスクなし)',
    detail: null,
    duration,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    mode: 'countup',
    isBreak: false,
  };
  logs = storageGetFresh('mt_logs', []);
  logs.push(session);
  storageSet('mt_logs', logs);
  syncSessionIntegrations(session);
}

// ── Note template event wiring ──────────────────────────────────────────────
notePin?.addEventListener('click', (e) => { e.stopPropagation(); btnPin.click(); syncNoteButtons(); });
noteChev?.addEventListener('click', (e) => { e.stopPropagation(); noteui.toggleCollapse(); });
notePlayBtn?.addEventListener('click', (e) => { e.stopPropagation(); btnPlay.click(); });
notePauseBtn?.addEventListener('click', (e) => { e.stopPropagation(); btnPause.click(); });
document.getElementById('note-reset')?.addEventListener('click', (e) => { e.stopPropagation(); btnReset.click(); });
document.getElementById('note-break')?.addEventListener('click', (e) => { e.stopPropagation(); btnBreak.click(); });
document.getElementById('note-pomo')?.addEventListener('click', (e) => { e.stopPropagation(); btnPomo.click(); });
document.getElementById('note-template-btn')?.addEventListener('click', (e) => { e.stopPropagation(); cycleTemplate(); });

// 円テンプレート: 作業リストのドロワー開閉
classicListToggle?.addEventListener('click', (e) => { e.stopPropagation(); toggleClassicDrawer(); });

noteTimer?.addEventListener('click', () => {
  if (completionActive) { dismissCompletion(); return; }
  if (st.running || st.mode !== 'countdown') return;
  openNoteEdit();
});
// 完了通知中はノートのどこをクリックしても解除
noteTpl?.addEventListener('click', () => {
  if (completionActive) dismissCompletion();
});
noteTimerInput?.addEventListener('mousedown', (e) => e.stopPropagation());
noteTimerInput?.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); closeNoteEdit(true); }
  if (e.key === 'Escape') closeNoteEdit(false);
});
noteTimerInput?.addEventListener('blur', () => closeNoteEdit(true));

// ノート上のホイール操作。
//   Ctrl+ホイール → ウィンドウ全体の拡大縮小（noteui）
//   通常ホイール → カウントダウン時間の調整（停止中のみ）
noteTpl?.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) { noteui.nudgeScale(e.deltaY > 0 ? -1 : 1); return; }  // 下スクロールで縮小（円テンプレートと同じ向き）
  if (st.running || st.mode !== 'countdown') return;
  const delta = e.deltaY > 0 ? 60 : -60;
  st.total = Math.max(60, Math.min(28800, st.total + delta));
  refreshText();
  draw();
}, { passive: false });

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  // main ウィンドウのみ同期ファイルとの取り込み・書き出しを行う
  await initStorage({ syncFile: true });

  timelapse.loadSettings();

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
  classicOpen = Boolean(storageGet('mt_classic_open', false));
  classicListToggle?.classList.toggle('open', classicOpen);

  // ノートのウィンドウ幾何（自動高さ・リサイズ・拡大縮小・開閉）を初期化
  noteui.initNoteUI({ noteTpl, invoke: (cmd, args) => window.__TAURI__?.core?.invoke?.(cmd, args) });

  // 進行中タスク（作業リスト）を初期化
  noteDate.textContent = new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  tasks.initTasks({ container: noteList, addInput: noteAddInput, log: logTaskSpan, onLayoutChange: onTaskLayoutChanged });
  renderNoteTally();

  refreshText();
  renderTaskName();
  // デザインテンプレートを適用（形状・ウィンドウサイズを含む）
  template = storageGet('mt_template', 'note');
  await applyTemplate(template);
  // 前回のウィンドウ位置を復元
  const savedPos = storageGet('mt_window_pos', null);
  if (savedPos) {
    await window.__TAURI__?.core?.invoke?.('set_window_position', { x: savedPos[0], y: savedPos[1] });
  }
  // デフォルトで前面固定
  btnPin.classList.add('pinned');
  await tauriWin()?.setAlwaysOnTop(true);
  syncNoteButtons();

  // 停止状態で起動するため rAF は使わず、時計のみ定期更新
  clockTickInterval = setInterval(() => {
    clockEl.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }, 30_000);
})();

// ── Cursor passthrough for transparent corners ──────────────────────
// 円の外（透明コーナー部分）ではクリックを背後のウィンドウに通す
let _cursorPassthrough = false;
document.addEventListener('mousemove', (e) => {
  // 円テンプレートのみ透明コーナーの透過処理を行う（ノートは矩形で全面が有効）
  if (template !== 'classic') {
    if (_cursorPassthrough) {
      _cursorPassthrough = false;
      window.__TAURI__?.core?.invoke?.('set_cursor_passthrough', { ignore: false });
    }
    return;
  }
  const rect = circle.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const r  = rect.width / 2;
  const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  // 円の下に作業リストのドロワーがある場合、その領域は不透明なので透過させない。
  // 透過するのは上部正方形の透明コーナー（円の外）だけに限定する。
  const inTopSquare = y <= rect.bottom - rect.top && x >= 0 && x <= rect.width;
  const shouldPassthrough = inTopSquare && !inCircle;
  if (shouldPassthrough !== _cursorPassthrough) {
    _cursorPassthrough = shouldPassthrough;
    window.__TAURI__?.core?.invoke?.('set_cursor_passthrough', { ignore: shouldPassthrough });
  }
});
