import { initStorage, storageGet, storageSet, storageClear } from './store.js';

// ── Data ───────────────────────────────────────────────────────────────────
let logs = [];
let period = 'today';
let view = 'summary';
let selectedDate = null; // 'YYYY-MM-DD' — 今月タブでの日付ドリルダウン

function getFiltered() {
  if (selectedDate) {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const start = new Date(y, m - 1, d).getTime();
    const end = new Date(y, m - 1, d + 1).getTime();
    return logs.filter(l => { const t = l.endedAt ?? l.timestamp; return t >= start && t < end; });
  }
  const now = new Date();
  let startMs;
  if (period === 'today') {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    startMs = d.getTime();
  } else if (period === 'yesterday') {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    const endMs = d.getTime();
    d.setDate(d.getDate() - 1);
    return logs.filter(l => { const t = l.endedAt ?? l.timestamp; return t >= d.getTime() && t < endMs; });
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

function getMonthDailyTotals() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const days = {};
  logs
    .filter(l => !l.isBreak && (l.endedAt ?? l.timestamp) >= monthStart)
    .forEach(l => {
      const d = new Date(l.endedAt ?? l.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days[key] = (days[key] || 0) + l.duration;
    });
  return Object.entries(days)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, sec]) => {
      const [y, m, d] = key.split('-').map(Number);
      return { key, label: fmtDateLabel(new Date(y, m - 1, d).getTime()), sec };
    });
}

function getMonthly() {
  const months = {};
  logs.filter(l => !l.isBreak).forEach(l => {
    const d = new Date(l.endedAt ?? l.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months[key] = (months[key] || 0) + l.duration;
  });
  return Object.entries(months)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, sec]) => {
      const [y, m] = key.split('-');
      return { label: `${y}年${parseInt(m)}月`, sec };
    });
}

function getAggregated() {
  const totals = {};
  const details = {};
  getFiltered().filter(l => !l.isBreak).forEach(l => {
    totals[l.task] = (totals[l.task] || 0) + l.duration;
    if (l.detail) {
      if (!details[l.task]) details[l.task] = {};
      details[l.task][l.detail] = (details[l.task][l.detail] || 0) + l.duration;
    }
  });
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, sec]) => ({ name, sec, details: details[name] || {} }));
}

function getBreakTotal() {
  return getFiltered().filter(l => l.isBreak).reduce((s, l) => s + l.duration, 0);
}

function taskFontSize(text) {
  const len = text.length;
  if (len <= 22) return '12px';
  if (len <= 27) return '11px';
  if (len <= 33) return '10px';
  if (len <= 40) return '9px';
  return '8px';
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

// ── Render: daily summary (今月ドリルダウン用) ─────────────────────────────
function renderDailySummary() {
  const entries = getMonthDailyTotals();
  const grandTotal = entries.reduce((s, { sec }) => s + sec, 0);
  const maxSec = entries[0]?.sec ?? 1;

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

  entries.forEach(({ key, label, sec }, i) => {
    const pct = (sec / maxSec) * 100;
    const row = document.createElement('div');
    row.className = 'row row-clickable';
    row.style.animationDelay = `${i * 55}ms`;
    row.innerHTML = `
      <div class="row-meta">
        <span class="row-name">${label}</span>
        <span class="row-time">${fmtDuration(sec)}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" data-pct="${pct}"></div>
      </div>
    `;
    row.addEventListener('click', () => { selectedDate = key; render(); });
    listEl.appendChild(row);
    fills.push(row.querySelector('.bar-fill'));
  });

  setTimeout(() => {
    fills.forEach(el => { el.style.width = el.dataset.pct + '%'; });
  }, entries.length * 55 + 120);

  setTimeout(() => { animateCount(footerTime, grandTotal); }, 200);
  footerBreak.textContent = '';
}

// ── Render: summary ────────────────────────────────────────────────────────
function renderSummary() {
  if (period === 'all') { renderMonthlySummary(); return; }
  if (period === 'month' && !selectedDate) { renderDailySummary(); return; }

  const entries = getAggregated();
  const grandTotal = entries.reduce((s, { sec }) => s + sec, 0);
  const maxDuration = entries[0]?.sec ?? 1;

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

  entries.forEach(({ name, sec, details }, i) => {
    const pct = (sec / maxDuration) * 100;
    const hasDetails = Object.keys(details).length > 0;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.animationDelay = `${i * 55}ms`;

    const detailEntries = Object.entries(details).sort((a, b) => b[1] - a[1]);
    const detailsHtml = hasDetails ? `
      <div class="row-details">
        ${detailEntries.map(([dName, dSec]) => `
          <div class="row-detail-item">
            <span class="row-detail-name">${dName}</span>
            <span class="row-detail-time">${fmtDuration(dSec)}</span>
            <div class="bar-track bar-track-detail">
              <div class="bar-fill bar-fill-detail" style="width:${(dSec/sec*100).toFixed(1)}%"></div>
            </div>
          </div>`).join('')}
      </div>` : '';

    row.innerHTML = `
      <div class="row-meta">
        <span class="row-name" style="font-size:${taskFontSize(name)}">${name}</span>
        <span class="row-time">${fmtDuration(sec)}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" data-pct="${pct}"></div>
      </div>
      ${detailsHtml}
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

// ── Render: monthly summary (全期間) ───────────────────────────────────────
function renderMonthlySummary() {
  const entries = getMonthly();
  const grandTotal = entries.reduce((s, { sec }) => s + sec, 0);
  const maxSec = entries[0]?.sec ?? 1;

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

  entries.forEach(({ label, sec }, i) => {
    const pct = (sec / maxSec) * 100;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.animationDelay = `${i * 55}ms`;
    row.innerHTML = `
      <div class="row-meta">
        <span class="row-name">${label}</span>
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
  footerBreak.textContent = '';
}

// ── Render: session list ───────────────────────────────────────────────────
function renderList() {
  const filtered = getFiltered()
    .slice()
    .sort((a, b) => (b.endedAt ?? b.timestamp) - (a.endedAt ?? a.timestamp));

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

    const dayWorkTotal = sessions.filter(l => !l.isBreak).reduce((s, l) => s + l.duration, 0);
    const labelEl = document.createElement('div');
    labelEl.className = 'date-label';
    labelEl.innerHTML = `<span>${dateLabel}</span>${dayWorkTotal > 0 ? `<span class="date-total">${fmtDuration(dayWorkTotal)}</span>` : ''}`;
    groupEl.appendChild(labelEl);

    sessions.forEach(l => {
      const endMs = l.endedAt ?? l.timestamp;
      const startMs = l.startedAt ?? (endMs - l.duration * 1000);
      const row = document.createElement('div');
      row.className = 'session-row' + (l.isBreak ? ' break' : '');
      const taskLabel = l.detail ? `${l.task} / ${l.detail}` : l.task;
      row.innerHTML = `
        <span class="session-range">${fmtTime(startMs)} → ${fmtTime(endMs)}</span>
        <span class="session-task" style="font-size:${taskFontSize(taskLabel)}">${l.isBreak ? '☕ ' : ''}${taskLabel}</span>
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

// ── Back button (今月ドリルダウン時) ──────────────────────────────────────
function updateBackButton() {
  const subheader = document.querySelector('.subheader');
  let backBtn = document.getElementById('back-btn');
  if (period === 'month' && selectedDate) {
    if (!backBtn) {
      backBtn = document.createElement('button');
      backBtn.id = 'back-btn';
      backBtn.className = 'back-btn';
      backBtn.textContent = '← 今月';
      backBtn.addEventListener('click', () => { selectedDate = null; render(); });
      subheader.insertBefore(backBtn, subheader.firstChild);
    }
  } else {
    backBtn?.remove();
  }
}

// ── Graph ──────────────────────────────────────────────────────────────────
function getGraphData() {
  if (period === 'today' || period === 'yesterday' || selectedDate) {
    let filtered;
    if (selectedDate) {
      const [y, m, d] = selectedDate.split('-').map(Number);
      const s = new Date(y, m - 1, d).getTime();
      const e = new Date(y, m - 1, d + 1).getTime();
      filtered = logs.filter(l => !l.isBreak && (l.endedAt ?? l.timestamp) >= s && (l.endedAt ?? l.timestamp) < e);
    } else {
      filtered = getFiltered().filter(l => !l.isBreak);
    }
    const buckets = {};
    filtered.forEach(l => {
      const h = new Date(l.endedAt ?? l.timestamp).getHours();
      buckets[h] = (buckets[h] || 0) + l.duration;
    });
    const hours = Object.keys(buckets).map(Number);
    if (hours.length === 0) return [];
    const minH = Math.min(...hours), maxH = Math.max(...hours);
    const pts = [];
    for (let h = minH; h <= maxH; h++) {
      pts.push({ label: (h === minH || h === maxH || h % 3 === 0) ? `${h}:00` : '', sec: buckets[h] || 0 });
    }
    return pts;
  }
  if (period === 'week') {
    const now = new Date();
    const dow = now.getDay() || 7;
    const mon = new Date(now); mon.setDate(now.getDate() - (dow - 1)); mon.setHours(0, 0, 0, 0);
    const labels = ['月', '火', '水', '木', '金', '土', '日'];
    return labels.map((label, i) => {
      const s = new Date(mon); s.setDate(mon.getDate() + i);
      const e = new Date(s); e.setDate(s.getDate() + 1);
      const sec = logs.filter(l => !l.isBreak && (l.endedAt ?? l.timestamp) >= s.getTime() && (l.endedAt ?? l.timestamp) < e.getTime()).reduce((a, l) => a + l.duration, 0);
      return { label, sec };
    });
  }
  if (period === 'month') {
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const y = now.getFullYear(), mo = now.getMonth();
    return Array.from({ length: days }, (_, i) => {
      const d = i + 1;
      const s = new Date(y, mo, d).getTime(), e = new Date(y, mo, d + 1).getTime();
      const sec = logs.filter(l => !l.isBreak && (l.endedAt ?? l.timestamp) >= s && (l.endedAt ?? l.timestamp) < e).reduce((a, l) => a + l.duration, 0);
      return { label: (d === 1 || d % 7 === 1) ? String(d) : '', sec };
    });
  }
  // all
  const monthly = getMonthly().reverse();
  const step = Math.ceil(monthly.length / 6);
  return monthly.map(({ label, sec }, i) => ({
    label: (monthly.length <= 6 || i % step === 0 || i === monthly.length - 1) ? label.replace(/\d{4}年/, '') : '',
    sec,
  }));
}

function renderGraph() {
  listEl.innerHTML = '';
  const points = getGraphData();
  if (!points.length || points.every(p => p.sec === 0)) {
    const el = document.createElement('div');
    el.className = 'empty'; el.textContent = '記録がありません';
    listEl.appendChild(el);
    footerTime.textContent = '—'; footerBreak.textContent = '';
    return;
  }

  const W = 322, H = 200;
  const pad = { t: 16, r: 10, b: 30, l: 40 };
  const gW = W - pad.l - pad.r, gH = H - pad.t - pad.b;
  const n = points.length;
  const maxSec = Math.max(...points.map(p => p.sec));
  const f = v => v.toFixed(1);
  const toX = i => pad.l + (n > 1 ? (i / (n - 1)) * gW : gW / 2);
  const toY = s => pad.t + gH - (s / maxSec) * gH;

  const pts = points.map((p, i) => ({ x: toX(i), y: toY(p.sec), ...p }));

  let linePath = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], cx = f((a.x + b.x) / 2);
    linePath += ` C ${cx} ${f(a.y)} ${cx} ${f(b.y)} ${f(b.x)} ${f(b.y)}`;
  }
  const base = f(pad.t + gH);
  const areaPath = `${linePath} L ${f(pts[n - 1].x)} ${base} L ${f(pts[0].x)} ${base} Z`;

  const yTicks = [1, 2, 3].map(i => ({ label: fmtDuration(maxSec / 3 * i), y: f(toY(maxSec / 3 * i)) }));
  const gridSvg = yTicks.map(({ y }) =>
    `<line x1="${pad.l}" y1="${y}" x2="${pad.l + gW}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`
  ).join('');
  const dotsSvg = pts.filter(p => p.sec > 0).map(({ x, y }) =>
    `<circle cx="${f(x)}" cy="${f(y)}" r="2.5" fill="var(--ring)"/>`
  ).join('');
  const yLabelsSvg = yTicks.map(({ label, y }) =>
    `<text x="${pad.l - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" class="graph-label">${label}</text>`
  ).join('');
  const xLabelsSvg = pts.filter(p => p.label).map(({ x, label }) =>
    `<text x="${f(x)}" y="${pad.t + gH + 14}" text-anchor="middle" class="graph-label">${label}</text>`
  ).join('');

  const wrap = document.createElement('div');
  wrap.className = 'graph-wrap';
  wrap.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="graph-svg">
      <defs>
        <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--ring)" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="var(--ring)" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      ${gridSvg}
      <path d="${areaPath}" fill="url(#ag)"/>
      <path d="${linePath}" fill="none" stroke="var(--ring)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dotsSvg}
      ${yLabelsSvg}
      ${xLabelsSvg}
    </svg>`;
  listEl.appendChild(wrap);

  const total = getFiltered().filter(l => !l.isBreak).reduce((s, l) => s + l.duration, 0);
  setTimeout(() => animateCount(footerTime, total), 200);
  footerBreak.textContent = '';
}

// ── Render dispatcher ──────────────────────────────────────────────────────
function render() {
  updateBackButton();
  if (view === 'summary') renderSummary();
  else if (view === 'graph') renderGraph();
  else renderList();
}

// ── Period tabs ────────────────────────────────────────────────────────────
['tab-today', 'tab-yesterday', 'tab-week', 'tab-month', 'tab-all'].forEach(id => {
  document.getElementById(id).addEventListener('click', function () {
    period = id.replace('tab-', '');
    selectedDate = null;
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

document.getElementById('view-graph').addEventListener('click', function () {
  view = 'graph';
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  this.classList.add('active');
  render();
});

// ── Add entry form ─────────────────────────────────────────────────────────
function openAddForm() {
  // Default date from current period/selection
  let defaultDate = new Date();
  if (period === 'yesterday') {
    defaultDate.setDate(defaultDate.getDate() - 1);
  } else if (selectedDate) {
    const [y, m, d] = selectedDate.split('-').map(Number);
    defaultDate = new Date(y, m - 1, d);
  }
  const yyyy = defaultDate.getFullYear();
  const mm = String(defaultDate.getMonth() + 1).padStart(2, '0');
  const dd = String(defaultDate.getDate()).padStart(2, '0');
  document.getElementById('add-date').value = `${yyyy}-${mm}-${dd}`;

  // Populate task suggestions
  const datalist = document.getElementById('add-task-list');
  datalist.innerHTML = '';
  const tasks = [...new Set(logs.filter(l => !l.isBreak).map(l => l.task))];
  tasks.forEach(t => { const o = document.createElement('option'); o.value = t; datalist.appendChild(o); });

  // Reset fields
  document.getElementById('add-hours').value = '0';
  document.getElementById('add-minutes').value = '30';
  document.getElementById('add-task').value = tasks[0] || '';

  document.getElementById('add-form').classList.remove('hidden');
  document.getElementById('add-task').focus();
}

function closeAddForm() {
  document.getElementById('add-form').classList.add('hidden');
}

async function submitAddForm() {
  const dateStr = document.getElementById('add-date').value;
  const hours = Math.max(0, parseInt(document.getElementById('add-hours').value) || 0);
  const minutes = Math.max(0, Math.min(59, parseInt(document.getElementById('add-minutes').value) || 0));
  const task = document.getElementById('add-task').value.trim();

  if (!dateStr || (hours === 0 && minutes === 0) || !task) return;

  const durationSec = hours * 3600 + minutes * 60;
  const [y, m, d] = dateStr.split('-').map(Number);
  const endMs = new Date(y, m - 1, d, 12, 0, 0).getTime();

  logs.push({
    task,
    duration: durationSec,
    timestamp: endMs,
    endedAt: endMs,
    startedAt: endMs - durationSec * 1000,
    isManual: true,
  });
  await storageSet('mt_logs', logs);

  closeAddForm();
  render();
}

document.getElementById('add-btn').addEventListener('click', openAddForm);
document.getElementById('add-cancel-btn').addEventListener('click', closeAddForm);
document.getElementById('add-submit-btn').addEventListener('click', submitAddForm);

// ── Reset ──────────────────────────────────────────────────────────────────
document.getElementById('reset-btn').addEventListener('click', () => {
  const btn = document.getElementById('reset-btn');
  if (btn.dataset.confirm === '1') {
    logs = [];
    storageClear('mt_logs');
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
window.refreshRecords = () => {
  logs = JSON.parse(localStorage.getItem('mt_logs') ?? '[]');
  document.body.className = localStorage.getItem('mt_theme') ?? '';
  render();
};

(async () => {
  await initStorage();
  logs = storageGet('mt_logs', []);
  document.body.className = storageGet('mt_theme', '');
  render();
})();
