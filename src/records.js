// ── Theme ──────────────────────────────────────────────────────────────────
document.body.className = localStorage.getItem('mt_theme') || '';

// ── Data ───────────────────────────────────────────────────────────────────
let logs = JSON.parse(localStorage.getItem('mt_logs') || '[]');
let period = 'today';
let view = 'summary';

function getFiltered() {
  const now = new Date();
  let startMs;
  if (period === 'today') {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    startMs = d.getTime();
  } else if (period === 'week') {
    const d = new Date(now);
    const day = d.getDay() || 7; // Sun=0→7, Mon=1
    d.setDate(d.getDate() - (day - 1));
    d.setHours(0, 0, 0, 0);
    startMs = d.getTime();
  } else if (period === 'month') {
    startMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  } else {
    return logs;
  }
  return logs.filter(l => (l.endedAt ?? l.timestamp) >= startMs);
}

function getAggregated() {
  const totals = {};
  getFiltered().filter(l => !l.isBreak).forEach(l => {
    totals[l.task] = (totals[l.task] || 0) + l.duration;
  });
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

function getBreakTotal() {
  return getFiltered().filter(l => l.isBreak).reduce((s, l) => s + l.duration, 0);
}

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `< 1m`;
}

function fmtTime(ms) {
  if (!ms) return '--:--';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDateLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return `${ymd}（今日）`;
  if (d.toDateString() === yesterday.toDateString()) return `${ymd}（昨日）`;
  return ymd;
}

// ── Count-up animation ─────────────────────────────────────────────────────
function animateCount(el, targetSec) {
  if (targetSec === 0) { el.textContent = '—'; return; }
  const dur = 900;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmtDuration(Math.floor(eased * targetSec));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmtDuration(targetSec);
  }
  requestAnimationFrame(step);
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const listEl = document.getElementById('list');
const footerTime = document.getElementById('footer-time');
const footerBreak = document.getElementById('footer-break');

// ── Render: summary ────────────────────────────────────────────────────────
function renderSummary() {
  const entries = getAggregated();
  const grandTotal = entries.reduce((s, [, v]) => s + v, 0);
  const maxDuration = entries[0]?.[1] ?? 1;

  listEl.innerHTML = '';

  if (entries.length === 0) {
    const el = document.createElement('div');
    el.className = 'empty';
    el.textContent = '記録がありません';
    listEl.appendChild(el);
    footerTime.textContent = '—';
    footerBreak.textContent = '';
    return;
  }

  const fills = [];

  entries.forEach(([name, sec], i) => {
    const pct = (sec / maxDuration) * 100;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.animationDelay = `${i * 55}ms`;
    row.innerHTML = `
      <div class="row-meta">
        <span class="row-name">${name}</span>
        <span class="row-time">${fmtDuration(sec)}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" data-pct="${pct}"></div>
      </div>
    `;
    listEl.appendChild(row);
    fills.push(row.querySelector('.bar-fill'));
  });

  setTimeout(() => {
    fills.forEach(el => { el.style.width = el.dataset.pct + '%'; });
  }, entries.length * 55 + 120);

  setTimeout(() => { animateCount(footerTime, grandTotal); }, 200);

  const breakSec = getBreakTotal();
  footerBreak.textContent = breakSec > 0 ? `休憩 ${fmtDuration(breakSec)}` : '';
}

// ── Render: session list ───────────────────────────────────────────────────
function renderList() {
  const filtered = getFiltered()
    .slice()
    .sort((a, b) => (b.endedAt ?? b.timestamp) - (a.endedAt ?? a.timestamp));

  const grandTotal = filtered.reduce((s, l) => s + l.duration, 0);
  listEl.innerHTML = '';

  if (filtered.length === 0) {
    const el = document.createElement('div');
    el.className = 'empty';
    el.textContent = '記録がありません';
    listEl.appendChild(el);
    footerTime.textContent = '—';
    footerBreak.textContent = '';
    return;
  }

  // Group by date
  const groups = new Map();
  filtered.forEach(l => {
    const key = fmtDateLabel(l.endedAt ?? l.timestamp);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  });

  let delay = 0;
  groups.forEach((sessions, dateLabel) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'date-group';
    groupEl.style.animationDelay = `${delay}ms`;
    delay += 50;

    const labelEl = document.createElement('div');
    labelEl.className = 'date-label';
    labelEl.textContent = dateLabel;
    groupEl.appendChild(labelEl);

    sessions.forEach(l => {
      const endMs = l.endedAt ?? l.timestamp;
      const startMs = l.startedAt ?? (endMs - l.duration * 1000);
      const row = document.createElement('div');
      row.className = 'session-row' + (l.isBreak ? ' break' : '');
      row.innerHTML = `
        <span class="session-range">${fmtTime(startMs)} → ${fmtTime(endMs)}</span>
        <span class="session-task">${l.isBreak ? '☕ ' : ''}${l.task}</span>
        <span class="session-dur">${fmtDuration(l.duration)}</span>
      `;
      groupEl.appendChild(row);
    });

    listEl.appendChild(groupEl);
  });

  const workTotal = filtered.filter(l => !l.isBreak).reduce((s, l) => s + l.duration, 0);
  const breakTotal = filtered.filter(l => l.isBreak).reduce((s, l) => s + l.duration, 0);
  footerTime.textContent = fmtDuration(workTotal);
  footerBreak.textContent = breakTotal > 0 ? `休憩 ${fmtDuration(breakTotal)}` : '';
}

// ── Render dispatcher ──────────────────────────────────────────────────────
function render() {
  if (view === 'summary') renderSummary();
  else renderList();
}

// ── Period tabs ────────────────────────────────────────────────────────────
['tab-today', 'tab-week', 'tab-month', 'tab-all'].forEach(id => {
  document.getElementById(id).addEventListener('click', function () {
    period = id.replace('tab-', '');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    render();
  });
});

// ── View tabs ──────────────────────────────────────────────────────────────
document.getElementById('view-summary').addEventListener('click', function () {
  view = 'summary';
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  this.classList.add('active');
  render();
});

document.getElementById('view-list').addEventListener('click', function () {
  view = 'list';
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  this.classList.add('active');
  render();
});

// ── Reset ──────────────────────────────────────────────────────────────────
document.getElementById('reset-btn').addEventListener('click', () => {
  const btn = document.getElementById('reset-btn');
  if (btn.dataset.confirm === '1') {
    logs = [];
    localStorage.removeItem('mt_logs');
    render();
    btn.textContent = 'リセット';
    delete btn.dataset.confirm;
  } else {
    btn.textContent = '確認 →';
    btn.dataset.confirm = '1';
    setTimeout(() => {
      btn.textContent = 'リセット';
      delete btn.dataset.confirm;
    }, 2500);
  }
});

// ── Close ──────────────────────────────────────────────────────────────────
const closeBtn = document.getElementById('close-btn');
closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
closeBtn.addEventListener('click', async () => {
  await window.__TAURI__?.core?.invoke?.('hide_records');
});

// ── Init ───────────────────────────────────────────────────────────────────
render();
