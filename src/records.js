import { initStorage, storageGet, storageSet } from './store.js';

// ── State ───────────────────────────────────────────────────────────────────
let logs = [];
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0-based
const MAX_HEAT_SECONDS = 12 * 60 * 60;

// ── Categories ──────────────────────────────────────────────────────────────
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;
const MIN_GAP_MS = 5 * 60 * 1000; // ギャップとして表示する下限 (5分)
const SLEEP_DEFAULT_MS = 6 * HOUR_MS; // この長さ以上のギャップは「睡眠」を初期選択

const CATEGORIES = [
  { id: 'sleep',    name: '睡眠',   emoji: '😴', color: '#6366F1' },
  { id: 'meal',     name: '食事',   emoji: '🍽',  color: '#F59E0B' },
  { id: 'work',     name: '作業',   emoji: '💼', color: '#3B82F6' },
  { id: 'move',     name: '移動',   emoji: '🚶', color: '#10B981' },
  { id: 'exercise', name: '運動',   emoji: '🏃', color: '#EF4444' },
  { id: 'leisure',  name: '余暇',   emoji: '🎮', color: '#A855F7' },
  { id: 'study',    name: '学習',   emoji: '📚', color: '#0EA5E9' },
  { id: 'other',    name: 'その他', emoji: '📌', color: '#94A3B8' },
];
const BREAK_CATEGORY = { id: 'break', name: '休憩', emoji: '☕', color: '#4ADE80' };

function categoryById(id) {
  if (id === 'break') return BREAK_CATEGORY;
  return CATEGORIES.find(c => c.id === id) || CATEGORIES.find(c => c.id === 'work');
}

function logCategory(log) {
  if (log.category) return log.category;
  if (log.isBreak)  return 'break';
  return 'work';
}

// タイムラインのギャップから追加された記録は作業時間集計の対象外
// (旧データ互換: source='manual' + category も該当)
function isTimelineEntry(log) {
  if (log.source === 'timeline') return true;
  if (log.source === 'manual' && log.category) return true;
  return false;
}

function countsAsWork(log) {
  return !log.isBreak && !isTimelineEntry(log);
}

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
const timelineBar    = document.getElementById('timeline-bar');
const timelineTicks  = document.getElementById('timeline-ticks');
const timelineTotals = document.getElementById('timeline-totals');
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
    .filter((log) => countsAsWork(log) && log.task && log.task !== '休憩')
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
    if (countsAsWork(l)) entry.sec += l.duration;
    entry.sessions.push(l);
  });

  return result;
}

function heatAlpha(sec) {
  if (sec <= 0) return 0;
  const ratio = Math.min(sec / MAX_HEAT_SECONDS, 1);
  const eased = Math.sqrt(ratio);
  return 0.08 + eased * 0.67;
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
    const alpha = heatAlpha(sec);
    const dow   = (startOffset + day - 1) % 7; // 0=月, 5=土, 6=日

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.dataset.date = dateStr;
    if (alpha > 0) {
      cell.classList.add('has-heat');
      cell.style.setProperty('--heat-alpha', alpha.toFixed(3));
    }
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

// ── Day Window / Segments ───────────────────────────────────────────────────
function getDayWindow(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0).getTime();
  return { start, end: start + DAY_MS };
}

function getSessionRange(log) {
  const endMs = log.endedAt ?? log.timestamp;
  const startMs = log.startedAt ?? (endMs - log.duration * 1000);
  return { startMs, endMs };
}

function getDaySegments(dateStr) {
  const { start: ws, end: we } = getDayWindow(dateStr);
  const segments = [];
  logs.forEach(l => {
    const { startMs, endMs } = getSessionRange(l);
    const s = Math.max(startMs, ws);
    const e = Math.min(endMs, we);
    if (e > s) {
      segments.push({
        log: l,
        startMs: s,
        endMs: e,
        category: logCategory(l),
      });
    }
  });
  segments.sort((a, b) => a.startMs - b.startMs);
  return { segments, windowStart: ws, windowEnd: we };
}

function findGaps(segments, windowStart, windowEnd) {
  const gaps = [];
  let cursor = windowStart;
  segments.forEach(seg => {
    if (seg.startMs > cursor + MIN_GAP_MS) {
      gaps.push({ startMs: cursor, endMs: seg.startMs });
    }
    cursor = Math.max(cursor, seg.endMs);
  });
  if (windowEnd > cursor + MIN_GAP_MS) {
    gaps.push({ startMs: cursor, endMs: windowEnd });
  }
  return gaps;
}

// ── Render Day Detail ────────────────────────────────────────────────────────
function renderDayDetail(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=月
  const dayLabel = `${m}月${d}日（${DAY_NAMES[dow]}）`;

  const { segments, windowStart, windowEnd } = getDaySegments(dateStr);

  // 表示用のセッションリスト (タイムライン窓と重なるログ全体)
  const sessions = [...new Set(segments.map(s => s.log))];

  // ヘッダー総計: タイマー記録 + 「作業を追加」の手動入力のみ (タイムライン入力は除外)
  const workSec = segments
    .filter(s => countsAsWork(s.log))
    .reduce((sum, s) => sum + (s.endMs - s.startMs) / 1000, 0);

  // ── ヘッダー ──
  dayDetailHeader.innerHTML = '';
  const dateSpan = document.createElement('span');
  dateSpan.className = 'day-detail-date';
  dateSpan.textContent = dayLabel;
  dayDetailHeader.appendChild(dateSpan);

  if (workSec > 0) {
    const totalSpan = document.createElement('span');
    totalSpan.className = 'day-detail-total';
    totalSpan.textContent = fmtDuration(Math.round(workSec));
    dayDetailHeader.appendChild(totalSpan);
  }

  // ── タイムライン ──
  renderTimelineBar(dateStr, segments, windowStart);
  renderTimelineTicks();
  renderTimelineTotals(segments);

  // ── セパレーター ──
  if (sessions.length > 0) {
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
      const ta = getSessionRange(a).startMs;
      const tb = getSessionRange(b).startMs;
      return ta - tb;
    });

    sorted.forEach((l, i) => {
      const { startMs, endMs } = getSessionRange(l);
      const taskLabel = l.detail ? `${l.task} / ${l.detail}` : l.task;
      const cat = categoryById(logCategory(l));

      const row = document.createElement('div');
      row.className = 'session-row' + (l.isBreak ? ' break' : '');
      row.style.animationDelay = `${i * 38}ms`;
      row.innerHTML = `
        <span class="session-range">${fmtTime(startMs)} → ${fmtTime(endMs)}</span>
        <span class="session-task" style="font-size:${taskFontSize(taskLabel)}">${cat.emoji} ${taskLabel}</span>
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

// ── Render Timeline ──────────────────────────────────────────────────────────
function renderTimelineBar(dateStr, segments, windowStart) {
  timelineBar.innerHTML = '';

  // ギャップ (背景に表示)
  const gaps = findGaps(segments, windowStart, windowStart + DAY_MS);
  gaps.forEach((g, i) => {
    const left  = ((g.startMs - windowStart) / DAY_MS) * 100;
    const width = ((g.endMs - g.startMs) / DAY_MS) * 100;
    const durMs = g.endMs - g.startMs;
    const btn = document.createElement('button');
    btn.className = 'tl-gap';
    btn.style.left  = `${left}%`;
    btn.style.width = `${width}%`;
    btn.title = `${fmtTime(g.startMs)} – ${fmtTime(g.endMs)} (${fmtDuration(durMs / 1000)})`;
    if (width > 4) btn.textContent = '?';
    btn.addEventListener('click', () => openTimelineModal(dateStr, g));
    timelineBar.appendChild(btn);
  });

  // セグメント (前景)
  segments.forEach(s => {
    const cat   = categoryById(s.category);
    const left  = ((s.startMs - windowStart) / DAY_MS) * 100;
    const width = ((s.endMs - s.startMs) / DAY_MS) * 100;
    const el = document.createElement('div');
    el.className = 'tl-seg';
    el.style.left  = `${left}%`;
    el.style.width = `${width}%`;
    el.style.setProperty('--seg-color', cat.color);
    const taskLabel = s.log.task ? ` ${s.log.task}` : '';
    el.title = `${cat.emoji} ${cat.name}${taskLabel}\n${fmtTime(s.startMs)} – ${fmtTime(s.endMs)} (${fmtDuration((s.endMs - s.startMs) / 1000)})`;
    timelineBar.appendChild(el);
  });
}

function renderTimelineTicks() {
  timelineTicks.innerHTML = '';
  for (let h = 0; h <= 24; h += 3) {
    const tick = document.createElement('span');
    tick.className = 'tl-tick';
    tick.style.left = `${(h / 24) * 100}%`;
    tick.textContent = h === 24 ? '24' : String(h);
    timelineTicks.appendChild(tick);
  }
}

function renderTimelineTotals(segments) {
  timelineTotals.innerHTML = '';
  const totals = {};
  segments.forEach(s => {
    totals[s.category] = (totals[s.category] || 0) + (s.endMs - s.startMs);
  });
  Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .forEach(([catId, ms]) => {
      const cat = categoryById(catId);
      const item = document.createElement('span');
      item.className = 'tl-stat';
      item.innerHTML = `<span class="tl-stat-dot" style="--stat-color:${cat.color}"></span>${cat.name} ${fmtDuration(Math.round(ms / 1000))}`;
      timelineTotals.appendChild(item);
    });
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

// ── Timeline Modal ──────────────────────────────────────────────────────────
let pendingGap = null;
let pendingDate = null;
let selectedCategoryId = null;

const tmModal       = document.getElementById('timeline-modal');
const tmTimeEl      = document.getElementById('tm-time');
const tmDurationEl  = document.getElementById('tm-duration');
const tmCategoriesEl = document.getElementById('tm-categories');
const tmMemoEl      = document.getElementById('tm-memo');
const tmStartEl     = document.getElementById('tm-start');
const tmEndEl       = document.getElementById('tm-end');
const tmDurEditEl   = document.getElementById('tm-duration-edit');
const tmSubmitEl    = document.getElementById('tm-submit-btn');

function openTimelineModal(dateStr, gap) {
  pendingGap = gap;
  pendingDate = dateStr;
  selectedCategoryId = null;

  // ヘッダー
  tmTimeEl.textContent     = `${fmtTime(gap.startMs)} – ${fmtTime(gap.endMs)}`;
  tmDurationEl.textContent = `(${fmtDuration(Math.round((gap.endMs - gap.startMs) / 1000))})`;

  // カテゴリボタン
  tmCategoriesEl.innerHTML = '';
  CATEGORIES.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'tm-cat-btn';
    btn.dataset.id = c.id;
    btn.style.setProperty('--cat-color', c.color);
    btn.innerHTML = `<span class="tm-cat-emoji">${c.emoji}</span><span class="tm-cat-name">${c.name}</span>`;
    btn.addEventListener('click', () => selectCategory(c.id));
    tmCategoriesEl.appendChild(btn);
  });

  // 6時間以上のギャップは「睡眠」を初期選択
  const gapMs = gap.endMs - gap.startMs;
  if (gapMs >= SLEEP_DEFAULT_MS) {
    selectCategory('sleep');
  } else {
    updateSubmitState();
  }

  // メモ・時間
  tmMemoEl.value = '';
  const pad = n => String(n).padStart(2, '0');
  const sd = new Date(gap.startMs);
  const ed = new Date(gap.endMs);
  tmStartEl.value = `${pad(sd.getHours())}:${pad(sd.getMinutes())}`;
  tmEndEl.value   = `${pad(ed.getHours())}:${pad(ed.getMinutes())}`;
  updateModalDuration();

  tmModal.classList.remove('hidden');
}

function selectCategory(id) {
  selectedCategoryId = id;
  document.querySelectorAll('.tm-cat-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.id === id);
  });
  updateSubmitState();
}

function updateSubmitState() {
  tmSubmitEl.disabled = !selectedCategoryId;
}

function parseModalRange() {
  if (!pendingGap || !tmStartEl.value || !tmEndEl.value) return null;
  const [sh, sm] = tmStartEl.value.split(':').map(Number);
  const [eh, em] = tmEndEl.value.split(':').map(Number);
  // ギャップが日跨ぎだった場合は元の日付コンテキストを尊重
  const sd = new Date(pendingGap.startMs);
  const ed = new Date(pendingGap.endMs);
  sd.setHours(sh, sm, 0, 0);
  ed.setHours(eh, em, 0, 0);
  // 終了 < 開始の場合は同日扱いを翌日に補正
  if (ed.getTime() <= sd.getTime()) {
    ed.setDate(ed.getDate() + 1);
  }
  return { startMs: sd.getTime(), endMs: ed.getTime() };
}

function updateModalDuration() {
  const r = parseModalRange();
  if (!r) { tmDurEditEl.textContent = ''; return; }
  const ms = r.endMs - r.startMs;
  tmDurEditEl.textContent = ms > 0 ? fmtDuration(Math.round(ms / 1000)) : '—';
}

function closeTimelineModal() {
  tmModal.classList.add('hidden');
  pendingGap = null;
  pendingDate = null;
  selectedCategoryId = null;
}

async function submitTimelineModal() {
  if (!pendingGap || !selectedCategoryId) return;
  const range = parseModalRange();
  if (!range || range.endMs <= range.startMs) return;

  const cat = categoryById(selectedCategoryId);
  const memo = tmMemoEl.value.trim();
  const taskName = memo || cat.name;
  const durationSec = Math.round((range.endMs - range.startMs) / 1000);

  logs.push({
    id: Math.random().toString(36).slice(2),
    task: taskName,
    category: cat.id,
    duration: durationSec,
    timestamp: range.endMs,
    endedAt: range.endMs,
    startedAt: range.startMs,
    isManual: true,
    source: 'timeline',
  });
  await storageSet('mt_logs', logs);

  closeTimelineModal();
  renderAll();
}

tmStartEl.addEventListener('input', updateModalDuration);
tmEndEl.addEventListener('input', updateModalDuration);
document.getElementById('tm-cancel-btn').addEventListener('click', closeTimelineModal);
tmSubmitEl.addEventListener('click', submitTimelineModal);

// ── Excel Export ──────────────────────────────────────────────────────────────
function sessionToExportRecord(session) {
  const { task, detail, duration, endedAt, timestamp, startedAt } = session;
  const endMs = endedAt ?? timestamp;
  const startMs = startedAt ?? (endMs - duration * 1000);
  const d = new Date(endMs);
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    task: task || '(タスクなし)',
    detail: detail || '',
    startTime: `${pad(new Date(startMs).getHours())}:${pad(new Date(startMs).getMinutes())}`,
    endTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    durationMin: Math.round(duration / 60 * 10) / 10,
    isBreak: Boolean(session.isBreak),
  };
}

const exportExcelBtn = document.getElementById('export-excel-btn');
const exportStatus   = document.getElementById('export-status');

exportExcelBtn.addEventListener('click', async () => {
  if (logs.length === 0) {
    exportStatus.textContent = '記録がありません';
    setTimeout(() => { exportStatus.textContent = ''; }, 3000);
    return;
  }
  exportExcelBtn.disabled = true;
  exportStatus.textContent = '出力中...';
  const records = logs.map(sessionToExportRecord);
  try {
    const savedPath = await window.__TAURI__?.core?.invoke?.('export_excel_records', { records });
    if (savedPath) {
      exportStatus.textContent = '✓ 出力完了';
    } else {
      exportStatus.textContent = 'キャンセルしました';
    }
  } catch (err) {
    exportStatus.textContent = `エラー: ${String(err)}`;
  } finally {
    exportExcelBtn.disabled = false;
    setTimeout(() => { exportStatus.textContent = ''; }, 4000);
  }
});

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
