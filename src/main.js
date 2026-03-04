// ── Constants ──────────────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 126;
const THEMES = ['', 'light', 'sunset'];

// ── State ──────────────────────────────────────────────────────────────────
const st = {
  mode:         'countdown',
  running:      false,
  elapsed:      0,
  total:        25 * 60,
  themeIdx:     0,
  pinned:       false,
  sessionStart: null,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const timerEl      = document.getElementById('timer');
const timerInputEl = document.getElementById('timer-input');
const clockEl      = document.getElementById('clock');
const ringEl       = document.getElementById('ring');
const circle       = document.getElementById('circle');
const btnPlay      = document.getElementById('btn-play');
const btnPause     = document.getElementById('btn-pause');
const btnReset     = document.getElementById('btn-reset');
const btnMode      = document.getElementById('btn-mode');
const btnTheme     = document.getElementById('btn-theme');
const btnPin       = document.getElementById('btn-pin');
const btnTask      = document.getElementById('btn-task');
const btnRecords   = document.getElementById('btn-records');
const taskNameEl      = document.getElementById('task-name');
const taskPanel       = document.getElementById('task-panel');
const taskPanelList   = document.getElementById('task-panel-list');
const taskPanelInput  = document.getElementById('task-panel-input');
const taskPanelAddBtn = document.getElementById('task-panel-add-btn');
const iconPlay        = document.getElementById('icon-play');
const iconPause       = document.getElementById('icon-pause');

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
let lastTime   = performance.now();
let lastSecond = -1;

function tick(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (st.running) {
    st.elapsed += dt;
    if (st.mode === 'countdown' && st.elapsed >= st.total) {
      st.elapsed = st.total;
      st.running = false;
      setPlayIcon(false);
      logSession();
    }
  }

  draw();

  const sec = Math.floor(st.elapsed);
  if (sec !== lastSecond) {
    lastSecond = sec;
    refreshText();
  }

  requestAnimationFrame(tick);
}

// ── Play icon helper ───────────────────────────────────────────────────────
const iconStop = document.getElementById('icon-stop');

function setPlayIcon(playing) {
  iconPlay.style.display  = playing ? 'none' : '';
  iconStop.style.display  = playing ? ''     : 'none';
  btnPause.style.display  = playing ? ''     : 'none';
}

// ── Button handlers ────────────────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  if (st.running) logSession();
  st.running = !st.running;
  if (st.running && st.sessionStart === null) st.sessionStart = Date.now();
  setPlayIcon(st.running);
});

btnPause.addEventListener('click', () => {
  st.running = false;
  setPlayIcon(false);
  // sessionStart は保持（再開時に継続）
});

btnReset.addEventListener('click', () => {
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
  if (st.running) logSession();
  st.mode    = st.mode === 'countdown' ? 'countup' : 'countdown';
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
  localStorage.setItem('mt_theme', THEMES[st.themeIdx]);
});

btnPin.addEventListener('click', async () => {
  st.pinned = !st.pinned;
  btnPin.classList.toggle('pinned', st.pinned);
  await tauriWin()?.setAlwaysOnTop(st.pinned);
});

btnRecords.addEventListener('click', async () => {
  await window.__TAURI__?.core?.invoke?.('open_records');
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
  if (st.running) logSession();
  st.running = !st.running;
  if (st.running && st.sessionStart === null) st.sessionStart = Date.now();
  setPlayIcon(st.running);
});

// ── Task management ────────────────────────────────────────────────────────
let tasks       = JSON.parse(localStorage.getItem('mt_tasks') || '[]');
let currentTask = localStorage.getItem('mt_current_task') || '';

function saveTaskState() {
  localStorage.setItem('mt_tasks', JSON.stringify(tasks));
  localStorage.setItem('mt_current_task', currentTask);
}

function renderTaskName() {
  taskNameEl.textContent = currentTask;
}

function renderTaskPanel() {
  taskPanelList.innerHTML = '';

  const noneEl = document.createElement('div');
  noneEl.className = 'task-item' + (currentTask === '' ? ' active' : '');
  noneEl.textContent = 'なし';
  noneEl.addEventListener('click', () => {
    currentTask = '';
    saveTaskState();
    renderTaskName();
    closeTaskPanel();
  });
  taskPanelList.appendChild(noneEl);

  tasks.forEach((task, i) => {
    const el = document.createElement('div');
    el.className = 'task-item' + (currentTask === task ? ' active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = task;
    el.appendChild(nameSpan);

    const del = document.createElement('span');
    del.className = 'task-item-del';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      tasks.splice(i, 1);
      if (currentTask === task) currentTask = '';
      saveTaskState();
      renderTaskName();
      renderTaskPanel();
    });
    el.appendChild(del);

    el.addEventListener('click', () => {
      currentTask = task;
      saveTaskState();
      renderTaskName();
      closeTaskPanel();
    });
    taskPanelList.appendChild(el);
  });
}

function openTaskPanel() {
  renderTaskPanel();
  taskPanel.classList.add('open');
  taskPanelInput.focus();
}

function closeTaskPanel() {
  taskPanel.classList.remove('open');
  taskPanelInput.value = '';
}

function addTask() {
  const name = taskPanelInput.value.trim();
  if (name && !tasks.includes(name)) {
    tasks.push(name);
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
  if (taskPanel.classList.contains('open')) closeTaskPanel();
});

// ── Session logging ────────────────────────────────────────────────────────
let logs = JSON.parse(localStorage.getItem('mt_logs') || '[]');

function logSession() {
  const duration = Math.floor(st.elapsed);
  if (duration < 5) return;
  const endedAt = Date.now();
  const startedAt = st.sessionStart ?? (endedAt - duration * 1000);
  st.sessionStart = null;
  logs.push({
    id:        Math.random().toString(36).slice(2),
    task:      currentTask || '(タスクなし)',
    duration,
    startedAt,
    endedAt,
    mode:      st.mode,
  });
  localStorage.setItem('mt_logs', JSON.stringify(logs));
}

// ── Scroll → adjust countdown total (when stopped) ────────────────────────
circle.addEventListener('wheel', (e) => {
  if (st.running) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? 60 : -60;
  st.total = Math.max(60, Math.min(5400, st.total + delta));
  refreshText();
  draw();
}, { passive: false });

// ── Init ───────────────────────────────────────────────────────────────────
const savedTheme = localStorage.getItem('mt_theme') || '';
document.body.className = savedTheme;
st.themeIdx = THEMES.indexOf(savedTheme);
if (st.themeIdx < 0) st.themeIdx = 0;

refreshText();
renderTaskName();
requestAnimationFrame(tick);
