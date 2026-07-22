// ── ノート/黒板テンプレートのウィンドウ幾何モジュール ─────────────────────
// 「作業リストの中身に合わせてウィンドウ高さを自動調整し、上限に達したら
// リスト内スクロールに切り替える」挙動と、ユーザーによる自由リサイズ
// （右へ引き伸ばし・下へ引き伸ばし）、Ctrl+ホイールの拡大縮小、開閉アニメを担当する。
//
// 測定はすべて論理px（scale=1 の座標系）で行い、視覚的な拡大縮小は
// `.note-tpl` への transform:scale で適用する。transform は offsetHeight /
// scrollHeight といったレイアウト指標に影響しないので、測定値は scale に依らず安定する。
//
// ウィンドウは左上を固定点として右・下方向にのみ広げるため、位置の再設定は不要。

import { storageGet, storageSet } from './store.js';

// 論理pxの上下限
const W_MIN = 220, W_MAX = 720;
const MAXH_MIN = 240, MAXH_MAX = 1000;
const SCALE_MIN = 0.8, SCALE_MAX = 1.6, SCALE_STEP = 0.05;
const COLLAPSE_PAD = 10;   // 折りたたみ時、ヘッダ下に残す余白
const MIN_LIST_H = 60;     // スクロール時にリストへ最低限確保する高さ
const ANIM_MS = 260;

let invoke = null;
let active = false;         // ノート/黒板テンプレートが表示中か
let els = null;             // { noteTpl, bar, timerzone, expand, section, list, addRow, toolbar, handles }

// 永続化される幾何状態（論理px）
let W = 264;                // 幅
let maxH = 520;             // 高さの上限（これを超えるとリストがスクロール）
let scale = 1;              // Ctrl+ホイールの倍率
let collapsed = false;      // 作業リストを畳んでいるか

let curH = 264;             // 現在適用中のウィンドウ論理高さ（アニメの起点）
let raf = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── 初期化 ──────────────────────────────────────────────
export function initNoteUI({ noteTpl, invoke: inv } = {}) {
  invoke = inv || null;
  const q = (sel) => noteTpl.querySelector(sel);
  els = {
    noteTpl,
    bar: q('.nt-bar'),
    timerzone: q('.nt-timerzone'),
    expand: q('.nt-expand'),
    section: q('.nt-sect'),
    list: q('.nt-list'),
    addRow: q('.nt-add'),
    toolbar: q('.nt-toolbar'),
  };

  W = clamp(Number(storageGet('mt_note_w', 264)) || 264, W_MIN, W_MAX);
  maxH = clamp(Number(storageGet('mt_note_maxh', 520)) || 520, MAXH_MIN, MAXH_MAX);
  scale = clamp(Number(storageGet('mt_note_scale', 1)) || 1, SCALE_MIN, SCALE_MAX);
  collapsed = Boolean(storageGet('mt_note_collapsed', false));
  noteTpl.classList.toggle('collapsed', collapsed);

  buildHandles();
}

// リサイズ用の掴みしろ（右・下・右下角）を生成して配線する
function buildHandles() {
  const mk = (cls, kind) => {
    const h = document.createElement('div');
    h.className = `nt-resize ${cls}`;
    // note-tpl は data-tauri-drag-region を持つので、掴みしろ上の mousedown が
    // ウィンドウ移動に化けないよう伝播を止める（ノートの他の入力欄と同じ対策）。
    h.addEventListener('mousedown', (e) => e.stopPropagation());
    h.addEventListener('pointerdown', (e) => startDrag(kind, e));
    els.noteTpl.appendChild(h);
    return h;
  };
  mk('nt-resize-e', 'e');
  mk('nt-resize-s', 's');
  mk('nt-resize-se', 'se');
}

// ── テンプレート表示状態 ─────────────────────────────────
export function setActive(on) {
  active = on;
  if (on) {
    curH = collapsed ? collapsedHeight() : Math.min(measure().naturalH, maxH);
    refit({ animate: false });
  }
}
export function isActive() { return active; }
export function isCollapsed() { return collapsed; }

// ── 測定（論理px） ──────────────────────────────────────
// リストの高さ制限を一時的に外し、ウィンドウ高さに依存しない自然な内容高さを測る。
function measure() {
  const { noteTpl, list, expand } = els;
  const prevH = noteTpl.style.height;
  const prevMax = list.style.maxHeight;
  const prevOv = list.style.overflowY;
  list.style.maxHeight = 'none';
  list.style.overflowY = 'visible';
  noteTpl.style.height = 'auto';
  const naturalH = noteTpl.offsetHeight;       // 全開時の内容高さ
  const listNaturalH = list.scrollHeight;      // リスト全行の高さ
  const headerH = expand.offsetTop;            // 開閉領域より上（常時表示部）の高さ
  noteTpl.style.height = prevH;
  list.style.maxHeight = prevMax;
  list.style.overflowY = prevOv;
  return { naturalH, listNaturalH, headerH };
}

function collapsedHeight() {
  // ヘッダ（綴じ+日付バー+タイマー）のみを残す高さ
  return els.expand.offsetTop + COLLAPSE_PAD;
}

// ── 中身に合わせて高さを決め、必要ならリストをスクロール化する ──────────
export function refit({ animate = false } = {}) {
  if (!active || !els) return;
  const { naturalH, listNaturalH, headerH } = measure();
  const nonListH = Math.max(0, naturalH - listNaturalH);

  let winH;
  let listMax = 'none';
  if (collapsed) {
    winH = headerH + COLLAPSE_PAD;
  } else if (naturalH <= maxH) {
    winH = naturalH;                            // 中身が収まる → 余白なしで内容ぴったり
  } else {
    winH = maxH;                                // 上限に到達 → リスト内スクロール
    listMax = Math.max(MIN_LIST_H, maxH - nonListH) + 'px';
  }

  els.list.style.maxHeight = listMax;
  els.list.style.overflowY = listMax === 'none' ? '' : 'auto';
  applyGeometry(winH, { animate });
}

// ── 幾何の適用 ──────────────────────────────────────────
function applyGeometry(H, { animate = false } = {}) {
  if (animate && Math.abs(H - curH) >= 1) animateTo(H);
  else { cancelAnimationFrame(raf); setH(H); }
}

function setH(H) {
  curH = H;
  const { noteTpl } = els;
  noteTpl.style.width = W + 'px';
  noteTpl.style.height = H + 'px';
  noteTpl.style.transformOrigin = 'top left';
  noteTpl.style.transform = scale === 1 ? '' : `scale(${scale})`;
  const pxW = Math.round(W * scale);
  const pxH = Math.round(H * scale);
  const de = document.documentElement, b = document.body;
  de.style.width = pxW + 'px'; de.style.height = pxH + 'px';
  b.style.width = pxW + 'px'; b.style.height = pxH + 'px';
  invoke?.('resize_window_rect', { width: pxW, height: pxH });
}

let animFallback = 0;
function animateTo(H) {
  cancelAnimationFrame(raf);
  clearTimeout(animFallback);
  const from = curH, to = H, t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);   // easeOutCubic
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ANIM_MS);
    setH(from + (to - from) * ease(p));
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  // requestAnimationFrame が（ウィンドウ非表示などで）止まっても
  // 最終高さは必ず適用されるよう、保険のタイマーで締める。
  animFallback = setTimeout(() => { if (Math.round(curH) !== Math.round(to)) setH(to); }, ANIM_MS + 80);
}

// ── 開閉 ────────────────────────────────────────────────
export function toggleCollapse() { setCollapsed(!collapsed, { animate: true }); }
export function setCollapsed(c, { animate = false } = {}) {
  collapsed = c;
  storageSet('mt_note_collapsed', c);
  els.noteTpl.classList.toggle('collapsed', c);
  refit({ animate });
}

// ── Ctrl+ホイールの拡大縮小 ─────────────────────────────
export function nudgeScale(dir) {
  const next = clamp(scale + (dir > 0 ? SCALE_STEP : -SCALE_STEP), SCALE_MIN, SCALE_MAX);
  if (next === scale) return;
  scale = next;
  storageSet('mt_note_scale', scale);
  refit({ animate: false });
}

// ── 自由リサイズ（右・下・右下角） ──────────────────────
function startDrag(kind, e) {
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const sx = e.screenX, sy = e.screenY;
  const startW = W, startMaxH = maxH;
  const handle = e.currentTarget;
  els.noteTpl.classList.add('nt-resizing');
  // ウィンドウ端の外へカーソルが出ても追従できるようポインタをキャプチャする
  try { handle.setPointerCapture?.(e.pointerId); } catch {}

  const move = (ev) => {
    const dx = (ev.screenX - sx) / scale;
    const dy = (ev.screenY - sy) / scale;
    if (kind === 'e' || kind === 'se') W = clamp(startW + dx, W_MIN, W_MAX);
    if (kind === 's' || kind === 'se') maxH = clamp(startMaxH + dy, MAXH_MIN, MAXH_MAX);
    refit({ animate: false });
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    els.noteTpl.classList.remove('nt-resizing');
    storageSet('mt_note_w', W);
    storageSet('mt_note_maxh', maxH);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

// テスト用に内部状態を覗く（本番コードからは使わない）
export function _debugState() {
  return { active, W, maxH, scale, collapsed, curH };
}
