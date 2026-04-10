import { initStorage, storageGet, storageSet } from './store.js';

// ── State ───────────────────────────────────────────────────────────────────
let logs = [];
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0-based

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
let selectedDate = todayStr();

// ── DOM refs ────────────────────────────────────────────────────────────────
const calendarGrid   = document.getElementById('calendar-grid');
const headerMonth    = document.getElementById('header-month');
const headerTotal    = document.getElementById('header-total');
const dayDetailHeader = document.getElementById('day-detail-header');
const taskBarsEl     = document.getElementById('task-bars');
const detailSep      = document.getElementById('detail-sep');
const sessionList    = document.getElementById('session-list');
const addInlineBtn   = document.getElementById('add-inline-btn');
const closeBtn       = document.getElementById('close-btn');

// ── Utilities ────────────────────────────────────────────────────────────────
const DAY_NAMES = ['月', '火', '水', '木', '金', '土', '日'];

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return '< 1m';
}

function fmtDurationShort(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return '';
}

function fmtTime(ms) {
  if (!ms) return '--:--';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function taskFontSize(text) {
  const len = text.length;
  if (len <= 22) return '12px';
  if (len <= 27) return '11px';
  if (len <= 33) return '10px';
  return '9px';
}

function readLatestStorageValue(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getAddFormTaskOptions() {
  const rawTasks = readLatestStorageValue('mt_tasks', []);
  const storedTasks = (Array.isArray(rawTasks) ? rawTasks : [])
    .map((task) => typeof task === 'string' ? task : String(task?.name ?? '').trim())
    .filter((task) => task && task !== '休憩');
  const loggedTasks = logs
    .filter((log) => !log.isBreak && log.task && log.task !== '休憩')
    .map((log) => log.task);
  return [...new Set([...storedTasks, ...loggedTasks])];
}

// ── Count-up animation ───────────────────────────────────────────────────────
function animateCount(el, targetSec) {
  if (targetSec === 0) { el.textContent = ''; return; }
  const dur = 800;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `月計 ${fmtDuration(Math.floor(eased * targetSec))}`;
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = `月計 ${fmtDuration(targetSec)}`;
  }
  requestAnimationFrame(step);
}

// ── Data ─────────────────────────────────────────────────────────────────────
function getMonthData(year, month) {
  const startMs = new Date(year, month, 1).getTime();
  const endMs   = new Date(year, month + 1, 1).getTime();
  const result  = new Map();

  logs.filter(l => {
    const t = l.endedAt ?? l.timestamp;
    return t >= startMs && t < endMs;
  }).forEach(l => {
    const d = new Date(l.endedAt ?? l.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!result.has(key)) result.set(key, { sec: 0, sessions: [] });
    const entry = result.get(key);
    if (!l.isBreak) entry.sec += l.duration;
    entry.sessions.push(l);
  });

  return result;
}

function heatLevel(sec) {
  if (sec <= 0)    return 0;
  if (sec < 1800)  return 1; // ~30分
  if (sec < 3600)  return 2; // ~1時間
  if (sec < 10800) return 3; // ~3時間
  return 4;
}

// ── Render Calendar ──────────────────────────────────────────────────────────
function renderCalendar() {
  headerMonth.textContent = `${viewYear}年${viewMonth + 1}月`;

  const monthMap = getMonthData(viewYear, viewMonth);

  // 月合計
  let monthTotal = 0;
  monthMap.forEach(({ sec }) => { monthTotal += sec; });
  if (monthTotal > 0) {
    animateCount(headerTotal, monthTotal);
  } else {
    headerTotal.textContent = '';
  }

  // カレンダーグリッド再描画
  calendarGrid.innerHTML = '';

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const startOffset = (firstDow + 6) % 7; // 月曜始まり

  const today = todayStr();
  let cellIndex = 0;

  // 前月の空セル
  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    calendarGrid.appendChild(empty);
    cellIndex++;
  }

  // 各日のセル
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const data = monthMap.get(dateStr);
    const sec  = data?.sec ?? 0;
    const level = heatLevel(sec);
    const dow   = (startOffset + day - 1) % 7; // 0=月, 5=土, 6=日

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.dataset.date = dateStr;
    if (level > 0) cell.classList.add(`heat-${level}`);
    if (dateStr === today) cell.classList.add('today');
    if (dateStr === selectedDate) cell.classList.add('selected');
    if (dow === 5) cell.classList.add('sat');
    if (dow === 6) cell.classList.add('sun');

    const delayMs = cellIndex * 11;
    cell.style.animationDelay = `${delayMs}ms`;

    const dateEl = document.createElement('span');
    dateEl.className = 'cal-date';
    dateEl.textContent = day;
    cell.appendChild(dateEl);

    if (sec > 0) {
      const hoursEl = document.createElement('span');
      hoursEl.className = 'cal-hours';
      hoursEl.textContent = fmtDurationShort(sec);
      cell.appendChild(hoursEl);
    }

    cell.addEventListener('click', () => selectDate(dateStr));
    calendarGrid.appendChild(cell);
    cellIndex++;
  }

  // 後月の空セル（7の倍数になるまで）
  const remaining = (7 - (cellIndex % 7)) % 7;
  for (let i = 0; i < remaining; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    calendarGrid.appendChild(empty);
  }
}

// ── Select Date ──────────────────────────────────────────────────────────────
function selectDate(dateStr) {
  selectedDate = dateStr;
  // selected クラスを付け替え（カレンダー全再描画なし）
  calendarGrid.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('selected'));
  const target = calendarGrid.querySelector(`[data-date="${dateStr}"]`);
  if (target) target.classList.add('selected');
  renderDayDetail(dateStr);
}

// ── Render Day Detail ────────────────────────────────────────────────────────
function renderDayDetail(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=月
  const dayLabel = `${m}月${d}日（${DAY_NAMES[dow]}）`;

  const monthMap = getMonthData(viewYear, viewMonth);

  // 選択日が今表示中の月と異なる場合も考慮
  let data = monthMap.get(dateStr);
  if (!data) {
    // 別月の日付の場合は直接ログから取得
    const startMs = new Date(y, m - 1, d).getTime();
    const endMs   = new Date(y, m - 1, d + 1).getTime();
    const dayLogs = logs.filter(l => {
      const t = l.endedAt ?? l.timestamp;
      return t >= startMs && t < endMs;
    });
    const workSec = dayLogs.filter(l => !l.isBreak).reduce((s, l) => s + l.duration, 0);
    data = { sec: workSec, sessions: dayLogs };
  }

  const { sec: workSec, sessions } = data;

  // ── ヘッダー ──
  dayDetailHeader.innerHTML = '';
  const dateSpan = document.createElement('span');
  dateSpan.className = 'day-detail-date';
  dateSpan.textContent = dayLabel;
  dayDetailHeader.appendChild(dateSpan);

  if (workSec > 0) {
    const totalSpan = document.createElement('span');
    totalSpan.className = 'day-detail-total';
    totalSpan.textContent = fmtDuration(workSec);
    dayDetailHeader.appendChild(totalSpan);
  }

  // ── タスクバー集計 ──
  taskBarsEl.innerHTML = '';
  const taskTotals = {};
  sessions.filter(l => !l.isBreak).forEach(l => {
    const name = l.detail ? `${l.task} / ${l.detail}` : l.task;
    taskTotals[name] = (taskTotals[name] || 0) + l.duration;
  });
  const taskEntries = Object.entries(taskTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const fills = [];
  taskEntries.forEach(([name, sec], i) => {
    const maxSec = taskEntries[0][1];
    const pct = (sec / maxSec) * 100;

    const row = document.createElement('div');
    row.className = 'task-bar-row';
    row.style.animationDelay = `${i * 55}ms`;
    row.innerHTML = `
      <span class="task-bar-name" title="${name}">${name}</span>
      <div class="task-bar-track"><div class="task-bar-fill" data-pct="${pct.toFixed(1)}"></div></div>
      <span class="task-bar-time">${fmtDuration(sec)}</span>
    `;
    taskBarsEl.appendChild(row);
    fills.push(row.querySelector('.task-bar-fill'));
  });

  // バーアニメーション
  if (fills.length > 0) {
    setTimeout(() => {
      fills.forEach(el => { el.style.width = el.dataset.pct + '%'; });
    }, taskEntries.length * 55 + 100);
  }

  // ── セパレーター ──
  if (workSec > 0 && sessions.length > 0) {
    detailSep.classList.remove('hidden');
  } else {
    detailSep.classList.add('hidden');
  }

  // ── セッション一覧 ──
  sessionList.innerHTML = '';

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'day-empty';
    empty.textContent = '記録がありません';
    sessionList.appendChild(empty);
  } else {
    const sorted = [...sessions].sort((a, b) => {
      const ta = a.startedAt ?? ((a.endedAt ?? a.timestamp) - a.duration * 1000);
      const tb = b.startedAt ?? ((b.endedAt ?? b.timestamp) - b.duration * 1000);
      return ta - tb;
    });

    sorted.forEach((l, i) => {
      const endMs   = l.endedAt ?? l.timestamp;
      const startMs = l.startedAt ?? (endMs - l.duration * 1000);
      const taskLabel = l.detail ? `${l.task} / ${l.detail}` : l.task;

      const row = document.createElement('div');
      row.className = 'session-row' + (l.isBreak ? ' break' : '');
      row.style.animationDelay = `${i * 38}ms`;
      row.innerHTML = `
        <span class="session-range">${fmtTime(startMs)} → ${fmtTime(endMs)}</span>
        <span class="session-task" style="font-size:${taskFontSize(taskLabel)}">${l.isBreak ? '☕ ' : ''}${taskLabel}</span>
        <span class="session-dur">${fmtDuration(l.duration)}</span>
        <button class="session-del" title="削除">×</button>
      `;
      row.querySelector('.session-del').addEventListener('click', e => {
        e.stopPropagation();
        deleteSession(l);
      });
      sessionList.appendChild(row);
    });
  }
}

// ── Delete Session ────────────────────────────────────────────────────────────
function deleteSession(entry) {
  const idx = logs.indexOf(entry);
  if (idx === -1) return;
  logs.splice(idx, 1);
  storageSet('mt_logs', logs);
  renderAll();
}

// ── Render All ───────────────────────────────────────────────────────────────
function renderAll() {
  renderCalendar();
  renderDayDetail(selectedDate);
}

// ── Month navigation ─────────────────────────────────────────────────────────
document.getElementById('prev-month-btn').addEventListener('click', () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  // 前月の最終日を選択
  const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
  selectedDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  renderCalendar();
  renderDayDetail(selectedDate);
});

document.getElementById('next-month-btn').addEventListener('click', () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  // 翌月の1日を選択
  selectedDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
  renderCalendar();
  renderDayDetail(selectedDate);
});

// ── Add form ─────────────────────────────────────────────────────────────────
function openAddForm() {
  document.getElementById('add-date').value = selectedDate;

  const taskSelect = document.getElementById('add-task');
  const tasks = getAddFormTaskOptions();
  taskSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = tasks.length ? 'タスクを選択' : '先にタスクを追加してください';
  taskSelect.appendChild(placeholder);

  tasks.forEach((task) => {
    const option = document.createElement('option');
    option.value = task;
    option.textContent = task;
    taskSelect.appendChild(option);
  });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('add-end').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const startH = Math.max(0, now.getHours() - 1);
  document.getElementById('add-start').value = `${pad(startH)}:${pad(now.getMinutes())}`;
  const currentTask = String(readLatestStorageValue('mt_current_task', '') || '');
  taskSelect.value = tasks.includes(currentTask) ? currentTask : (tasks[0] || '');

  document.getElementById('add-form').classList.remove('hidden');
  updateDurationPreview();
  taskSelect.focus();
}

function closeAddForm() {
  document.getElementById('add-form').classList.add('hidden');
}

async function submitAddForm() {
  const dateStr  = document.getElementById('add-date').value;
  const startStr = document.getElementById('add-start').value;
  const endStr   = document.getElementById('add-end').value;
  const task     = document.getElementById('add-task').value.trim();

  if (!dateStr || !startStr || !endStr || !task) return;

  const [y, m, d] = dateStr.split('-').map(Number);
  const [sh, sm]  = startStr.split(':').map(Number);
  const [eh, em]  = endStr.split(':').map(Number);
  const startMs   = new Date(y, m - 1, d, sh, sm, 0).getTime();
  const endMs     = new Date(y, m - 1, d, eh, em, 0).getTime();
  const durationSec = Math.round((endMs - startMs) / 1000);

  if (durationSec <= 0) return;

  logs.push({
    id: Math.random().toString(36).slice(2),
    task,
    duration: durationSec,
    timestamp: endMs,
    endedAt: endMs,
    startedAt: startMs,
    isManual: true,
  });
  await storageSet('mt_logs', logs);

  // 追加した日付に移動
  selectedDate = dateStr;
  const [ny, nm] = dateStr.split('-').map(Number);
  viewYear  = ny;
  viewMonth = nm - 1;

  closeAddForm();
  renderAll();
}

function updateDurationPreview() {
  const startStr = document.getElementById('add-start').value;
  const endStr   = document.getElementById('add-end').value;
  const preview  = document.getElementById('add-duration-preview');
  if (!startStr || !endStr) { preview.textContent = ''; return; }
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  const sec = (eh * 60 + em - (sh * 60 + sm)) * 60;
  preview.textContent = sec > 0 ? fmtDuration(sec) : '—';
  preview.style.color   = sec > 0 ? 'var(--ring)' : 'var(--fg)';
  preview.style.opacity = sec > 0 ? '1' : '0.3';
}

document.getElementById('add-start').addEventListener('input', updateDurationPreview);
document.getElementById('add-end').addEventListener('input', updateDurationPreview);

addInlineBtn.addEventListener('click', openAddForm);
document.getElementById('add-cancel-btn').addEventListener('click', closeAddForm);
document.getElementById('add-submit-btn').addEventListener('click', submitAddForm);

// ── Close ─────────────────────────────────────────────────────────────────────
closeBtn.addEventListener('mousedown', e => e.stopPropagation());
closeBtn.addEventListener('click', async () => {
  await window.__TAURI__?.core?.invoke?.('hide_records');
});

// ── Init ─────────────────────────────────────────────────────────────────────
window.refreshRecords = () => {
  logs = JSON.parse(localStorage.getItem('mt_logs') ?? '[]');
  document.body.className = localStorage.getItem('mt_theme') ?? '';
  renderAll();
};

(async () => {
  await initStorage();
  logs = storageGet('mt_logs', []);
  document.body.className = storageGet('mt_theme', '');
  renderAll();
})();
