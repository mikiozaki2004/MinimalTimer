// ── Theme ──────────────────────────────────────────────────────────────────
document.body.className = localStorage.getItem('mt_theme') || '';

// ── Data ───────────────────────────────────────────────────────────────────
let logs = JSON.parse(localStorage.getItem('mt_logs') || '[]');
let period = 'today';

function getAggregated() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const filtered = period === 'today'
    ? logs.filter(l => l.timestamp >= todayStart.getTime())
    : logs;

  const totals = {};
  filtered.forEach(l => {
    totals[l.task] = (totals[l.task] || 0) + l.duration;
  });

  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `< 1m`;
}

// ── Count-up animation ─────────────────────────────────────────────────────
function animateCount(el, targetSec) {
  if (targetSec === 0) { el.textContent = '—'; return; }
  const duration = 900;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmtDuration(Math.floor(eased * targetSec));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmtDuration(targetSec);
  }
  requestAnimationFrame(step);
}

// ── Render ─────────────────────────────────────────────────────────────────
const listEl     = document.getElementById('list');
const footerTime = document.getElementById('footer-time');

function render() {
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

  // Animate bars after rows appear
  setTimeout(() => {
    fills.forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  }, entries.length * 55 + 120);

  // Count-up for total
  setTimeout(() => {
    animateCount(footerTime, grandTotal);
  }, 200);
}

// ── Tabs ───────────────────────────────────────────────────────────────────
document.getElementById('tab-today').addEventListener('click', function () {
  period = 'today';
  this.classList.add('active');
  document.getElementById('tab-all').classList.remove('active');
  render();
});

document.getElementById('tab-all').addEventListener('click', function () {
  period = 'all';
  this.classList.add('active');
  document.getElementById('tab-today').classList.remove('active');
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
document.getElementById('close-btn').addEventListener('click', () => {
  window.__TAURI__?.window?.getCurrentWindow?.().close();
});

// ── Init ───────────────────────────────────────────────────────────────────
render();
