import { initStorage, storageGet, storageSet } from './store.js';

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
  pinned: false,
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
let pomoSetsCount = 4; // パネル上のステージング値

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
const pomoPanel = document.getElementById('pomo-panel');
const pomoSetsDisplay = document.getElementById('pomo-sets-display');
const pomoSetsDecBtn = document.getElementById('pomo-sets-dec');
const pomoSetsIncBtn = document.getElementById('pomo-sets-inc');
const pomoStartBtn = document.getElementById('pomo-start-btn');
const taskNameEl = document.getElementById('task-name');
const taskPanel = document.getElementById('task-panel');
const taskPanelList = document.getElementById('task-panel-list');
const taskPanelInput = document.getElementById('task-panel-input');
const taskPanelAddBtn = document.getElementById('task-panel-add-btn');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');

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

async function startCompletion() {
  if (completionActive) return;
  completionActive = true;
  // 通知時は zoom をリセット（Rust 側が 400px に拡大するため）
  circle.style.zoom = '';
  document.documentElement.classList.add('completion');
  await window.__TAURI__?.core?.invoke?.('notify_completion');
}

async function dismissCompletion() {
  if (!completionActive) return;
  completionActive = false;
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

function openPomoPanel() {
  pomoSetsDisplay.textContent = pomoSetsCount;
  pomoPanel.classList.add('open');
}

function closePomoPanel() {
  pomoPanel.classList.add('closing');
  pomoPanel.addEventListener('animationend', () => {
    pomoPanel.classList.remove('open', 'closing');
  }, { once: true });
}

// ── Button handlers ────────────────────────────────────────────────────────
// ── Break mode ─────────────────────────────────────────────────────────────
function enterBreak() {
  if (st.breakMode) return;
  // 実行中なら作業セッションを記録
  if (st.running) logSession();
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
btnPomo.addEventListener('click', (e) => {
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
    closeTaskPanel();
    pomoPanel.classList.contains('open') ? closePomoPanel() : openPomoPanel();
  }
});

pomoSetsDecBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  pomoSetsCount = Math.max(1, pomoSetsCount - 1);
  pomoSetsDisplay.textContent = pomoSetsCount;
});

pomoSetsIncBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  pomoSetsCount = Math.min(12, pomoSetsCount + 1);
  pomoSetsDisplay.textContent = pomoSetsCount;
});

pomoStartBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  closePomoPanel();
  if (st.running) logSession();
  if (st.breakMode) exitBreak();
  dismissCompletion();
  // ポモドーロ開始
  pomo.active = true;
  pomo.totalSets = pomoSetsCount;
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
});

pomoPanel.addEventListener('mousedown', (e) => e.stopPropagation());

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

circle.addEventListener('mousedown', () => closeCtxMenu());
document.addEventListener('click', (e) => {
  if (!ctxMenu.contains(e.target) && e.target !== btnRecords) closeCtxMenu();
});

// ── Timer click → edit mode ────────────────────────────────────────────────
function parseTimeInput(s) {
  s = s.trim();
  if (/^\d+$/.test(s)) {
    const m = Math.max(1, Math.min(90, parseInt(s)));
    return m * 60;
  }
  const match = s.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const m = parseInt(match[1]);
    const sec = parseInt(match[2]);
    if (sec >= 60) return null;
    const total = m * 60 + sec;
    return Math.max(60, Math.min(5400, total));
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

// ── Task management ────────────────────────────────────────────────────────
let tasks = [];
let currentTask = '';
let currentDetail = '';
let expandedTaskName = null;

function saveTaskState() {
  storageSet('mt_tasks', tasks);
  storageSet('mt_current_task', currentTask);
  storageSet('mt_current_detail', currentDetail);
}

function renderTaskName() {
  taskNameEl.textContent = currentDetail ? `${currentTask} / ${currentDetail}` : currentTask;
}

function renderTaskPanel() {
  taskPanelList.innerHTML = '';

  const noneEl = document.createElement('div');
  noneEl.className = 'task-item' + (currentTask === '' ? ' active' : '');
  noneEl.innerHTML = `<span class="task-item-toggle" style="opacity:0"></span><span class="task-item-name">なし</span>`;
  noneEl.addEventListener('click', () => {
    currentTask = '';
    currentDetail = '';
    saveTaskState();
    renderTaskName();
    closeTaskPanel();
  });
  taskPanelList.appendChild(noneEl);

  tasks.forEach((task, i) => {
    const taskName = task.name;
    const isExpanded = expandedTaskName === taskName;
    const isActive = currentTask === taskName && currentDetail === '';

    const el = document.createElement('div');
    el.className = 'task-item' + (isActive ? ' active' : '');

    const toggle = document.createElement('span');
    toggle.className = 'task-item-toggle';
    toggle.textContent = isExpanded ? '▾' : '▸';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      expandedTaskName = isExpanded ? null : taskName;
      renderTaskPanel();
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'task-item-name';
    nameSpan.textContent = taskName;

    const del = document.createElement('span');
    del.className = 'task-item-del';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      tasks.splice(i, 1);
      if (currentTask === taskName) { currentTask = ''; currentDetail = ''; }
      if (expandedTaskName === taskName) expandedTaskName = null;
      saveTaskState();
      renderTaskName();
      renderTaskPanel();
    });

    el.appendChild(toggle);
    el.appendChild(nameSpan);
    el.appendChild(del);
    el.addEventListener('click', () => {
      currentTask = taskName;
      currentDetail = '';
      saveTaskState();
      renderTaskName();
      closeTaskPanel();
    });
    taskPanelList.appendChild(el);

    if (isExpanded) {
      task.details.forEach((detail, j) => {
        const isDetailActive = currentTask === taskName && currentDetail === detail;
        const detailEl = document.createElement('div');
        detailEl.className = 'task-item detail-item' + (isDetailActive ? ' active' : '');

        const indent = document.createElement('span');
        indent.className = 'detail-indent';
        indent.textContent = '└';

        const detailName = document.createElement('span');
        detailName.className = 'task-item-name';
        detailName.textContent = detail;

        const detailDel = document.createElement('span');
        detailDel.className = 'task-item-del';
        detailDel.textContent = '✕';
        detailDel.addEventListener('click', (e) => {
          e.stopPropagation();
          task.details.splice(j, 1);
          if (currentTask === taskName && currentDetail === detail) currentDetail = '';
          saveTaskState();
          renderTaskName();
          renderTaskPanel();
        });

        detailEl.appendChild(indent);
        detailEl.appendChild(detailName);
        detailEl.appendChild(detailDel);
        detailEl.addEventListener('click', () => {
          currentTask = taskName;
          currentDetail = detail;
          saveTaskState();
          renderTaskName();
          closeTaskPanel();
        });
        taskPanelList.appendChild(detailEl);
      });

      const addRow = document.createElement('div');
      addRow.className = 'detail-add-row';
      addRow.innerHTML = `<span class="detail-indent">└</span><input class="detail-add-input" type="text" maxlength="20" placeholder="詳細を追加..."><button class="detail-add-btn">＋</button>`;

      const addInput = addRow.querySelector('.detail-add-input');
      const addBtn = addRow.querySelector('.detail-add-btn');
      const addDetail = () => {
        const name = addInput.value.trim();
        if (name && !task.details.includes(name)) {
          task.details.push(name);
          saveTaskState();
          renderTaskPanel();
        }
        addInput.value = '';
      };
      addRow.addEventListener('click', (e) => e.stopPropagation());
      addInput.addEventListener('mousedown', (e) => e.stopPropagation());
      addInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); addDetail(); }
        if (e.key === 'Escape') closeTaskPanel();
      });
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); addDetail(); });
      taskPanelList.appendChild(addRow);
    }
  });
}

function openTaskPanel() {
  renderTaskPanel();
  taskPanel.classList.add('open');
  taskPanelInput.focus();
}

function closeTaskPanel() {
  taskPanelInput.value = '';
  taskPanel.classList.add('closing');
  taskPanel.addEventListener('animationend', () => {
    taskPanel.classList.remove('open', 'closing');
  }, { once: true });
}

function addTask() {
  const name = taskPanelInput.value.trim();
  if (name && !tasks.some(t => t.name === name)) {
    tasks.push({ name, details: [] });
    saveTaskState();
    renderTaskPanel();
  }
  taskPanelInput.value = '';
}

btnTask.addEventListener('click', (e) => {
  e.stopPropagation();
  taskPanel.classList.contains('open') ? closeTaskPanel() : openTaskPanel();
});

taskPanel.addEventListener('mousedown', (e) => e.stopPropagation());
taskPanel.addEventListener('wheel', (e) => e.stopPropagation());

taskPanelInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); addTask(); }
  if (e.key === 'Escape') closeTaskPanel();
});

taskPanelAddBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  addTask();
});

circle.addEventListener('click', () => {
  if (completionActive) { dismissCompletion(); return; }
  if (taskPanel.classList.contains('open')) closeTaskPanel();
  if (pomoPanel.classList.contains('open')) closePomoPanel();
});

// ── Session logging ────────────────────────────────────────────────────────
let logs = [];

function logSession() {
  const duration = Math.floor(st.elapsed);
  if (duration < 5) return;
  const endedAt = Date.now();
  const startedAt = st.sessionStart ?? (endedAt - duration * 1000);
  st.sessionStart = null;
  logs.push({
    id: Math.random().toString(36).slice(2),
    task: currentTask || '(タスクなし)',
    detail: currentDetail || null,
    duration,
    startedAt,
    endedAt,
    mode: st.mode,
    isBreak: st.breakMode,
  });
  storageSet('mt_logs', logs);
}

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
  st.total = Math.max(60, Math.min(5400, st.total + delta));
  refreshText();
  draw();
}, { passive: false });

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  await initStorage();

  tasks = storageGet('mt_tasks', []).map(t => typeof t === 'string' ? { name: t, details: [] } : t);
  currentTask = storageGet('mt_current_task', '');
  currentDetail = storageGet('mt_current_detail', '');
  logs = storageGet('mt_logs', []);

  const savedTheme = storageGet('mt_theme', '');
  document.body.className = savedTheme;
  st.themeIdx = THEMES.indexOf(savedTheme);
  if (st.themeIdx < 0) st.themeIdx = 0;

  currentWindowSize = storageGet('mt_window_size', 280);

  refreshText();
  renderTaskName();
  if (currentWindowSize !== 280) applyWindowSize(currentWindowSize);
  // 停止状態で起動するため rAF は使わず、時計のみ定期更新
  clockTickInterval = setInterval(() => {
    clockEl.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }, 30_000);
})();
