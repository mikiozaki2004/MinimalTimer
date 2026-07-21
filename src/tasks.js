// ── 進行中タスク（作業リスト）モジュール ───────────────────────────
// ノート/黒板テンプレートの作業リストを担当する。円（classic）では使わない。
//
// データ構造（mt_active_items）：
//   item = { id, text, done, accumulatedSec, running, lastStartedAt, bornSet, children:[child...] }
//   child = 同上（children を持たない末端）
// 計測するのは「末端（子、または子を持たない親）」のみ。親の時間・進捗は子の集計。
//
// 依存を小さく保つため、ログ確定（mt_logs への書き込み）は init で渡す logger に委譲する。

import { storageGet, storageSet } from './store.js';

let items = [];
let currentSet = 1;
let containerEl = null;
let addInputEl = null;
let logger = null;          // (span) => void   span={text, duration, startedAt, endedAt}
let onRunChange = null;     // () => void       走行状態が変わったとき通知

const now = () => Date.now();
const rid = () => Math.random().toString(36).slice(2, 9);

// ── 正規化 ──────────────────────────────────────────────
function normChild(raw) {
  return {
    id: raw?.id || rid(),
    text: String(raw?.text ?? '').trim(),
    done: Boolean(raw?.done),
    accumulatedSec: Number(raw?.accumulatedSec) || 0,
    running: Boolean(raw?.running),
    lastStartedAt: raw?.lastStartedAt ?? null,
    bornSet: Number(raw?.bornSet) || 1,
  };
}
function normItem(raw) {
  const it = normChild(raw);
  it.children = Array.isArray(raw?.children) ? raw.children.map(normChild).filter(c => c.text) : [];
  return it;
}
function normalize(raw) {
  return (Array.isArray(raw) ? raw : []).map(normItem).filter(it => it.text);
}

// ── 永続化 ──────────────────────────────────────────────
let saveTimer = null;
function persist({ immediate = false } = {}) {
  clearTimeout(saveTimer);
  const doSave = () => {
    storageSet('mt_active_items', items);
    storageSet('mt_active_set', currentSet);
  };
  if (immediate) doSave();
  else saveTimer = setTimeout(doSave, 400);
}

// ── 計測（走行中の末端の秒を進める） ─────────────────────
// 表示秒 = accumulatedSec + (running ? 経過 : 0)
function liveSec(leaf) {
  if (leaf.running && leaf.lastStartedAt) {
    return leaf.accumulatedSec + Math.floor((now() - leaf.lastStartedAt) / 1000);
  }
  return leaf.accumulatedSec;
}

// 末端配列（子があれば子、なければ自身）
function leavesOf(item) {
  return item.children.length ? item.children : [item];
}
function allLeaves() {
  return items.flatMap(leavesOf);
}

export function runningLeafCount() {
  return allLeaves().filter(l => l.running).length;
}

function startLeaf(leaf) {
  if (leaf.running || leaf.done) return;
  leaf.running = true;
  leaf.lastStartedAt = now();
  onRunChange?.();
}
function commitLeaf(leaf) {
  if (!leaf.running) return;
  const span = Math.floor((now() - (leaf.lastStartedAt ?? now())) / 1000);
  leaf.accumulatedSec += span;
  const startedAt = leaf.lastStartedAt;
  leaf.running = false;
  leaf.lastStartedAt = null;
  if (span >= 5 && logger) {
    logger({ text: leaf.text, duration: span, startedAt, endedAt: now() });
  }
  onRunChange?.();
}

function toggleRun(leaf) {
  if (leaf.running) commitLeaf(leaf);
  else startLeaf(leaf);
  persist({ immediate: true });
  render();
}

// 走行中を全停止（休憩・リセット・終了時に main.js から呼ぶ）
export function flushAllRunning() {
  let any = false;
  for (const l of allLeaves()) if (l.running) { commitLeaf(l); any = true; }
  if (any) { persist({ immediate: true }); render(); }
}

// ── 完了トグル ──────────────────────────────────────────
function setLeafDone(leaf, done) {
  if (done && leaf.running) commitLeaf(leaf);
  leaf.done = done;
}
function toggleDone(item, isChild, parent) {
  if (isChild) {
    setLeafDone(item, !item.done);
    // 親は「全子完了」で自動 done
    if (parent) parent.done = parent.children.every(c => c.done);
  } else if (item.children.length) {
    const allDone = item.children.every(c => c.done);
    item.children.forEach(c => setLeafDone(c, !allDone));
    item.done = !allDone;
  } else {
    setLeafDone(item, !item.done);
  }
  persist({ immediate: true });
  render();
}

// ── 追加 ────────────────────────────────────────────────
function addTop(text) {
  const t = text.trim();
  if (!t) return;
  items.push(normItem({ text: t, bornSet: currentSet }));
  persist({ immediate: true });
  render();
}
function addChild(parent, text) {
  const t = text.trim();
  if (!t) return;
  parent.children.push(normChild({ text: t, bornSet: currentSet }));
  parent.done = false;
  persist({ immediate: true });
  render();
}
function removeItem(target) {
  items = items.filter(it => it !== target);
  items.forEach(it => { it.children = it.children.filter(c => c !== target); });
  persist({ immediate: true });
  render();
}

// ── セット間の持ち越し（キャリーオーバー） ───────────────
// 完了しきった項目はアーカイブ（除外）し、残りは次セットへ持ち越す。
export function carryOverNewSet() {
  flushAllRunning();
  items = items.filter(it => {
    if (it.children.length) {
      it.children = it.children.filter(c => !c.done);
      return it.children.length > 0;
    }
    return !it.done;
  });
  currentSet += 1;
  persist({ immediate: true });
  render();
}

function isCarried(item) {
  return item.bornSet < currentSet;
}

// ── レンダリング ────────────────────────────────────────
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
function fmt(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 1 行（末端 or 単独）
function renderLeafRow(leaf, { child = false, parent = null } = {}) {
  const row = el('div', `row${child ? ' child' : ''}${leaf.running ? ' run' : ''}${leaf.done ? ' done' : ''}${!child && isCarried(leaf) ? ' carried' : ''}`);
  const chk = el('span', 'chk');
  chk.addEventListener('click', (e) => { e.stopPropagation(); toggleDone(leaf, child, parent); });
  const name = el('span', 'name', leaf.text);
  const time = el('span', 't', leaf.done ? fmt(leaf.accumulatedSec) : fmt(liveSec(leaf)));
  time.dataset.leafId = leaf.id;
  // 行クリックで計測トグル（走行 on/off）
  name.addEventListener('click', (e) => { e.stopPropagation(); if (!leaf.done) toggleRun(leaf); });
  row.append(chk, name, time);
  if (!child) {
    const add = el('span', 'row-add', '＋');
    add.title = '子作業を追加';
    add.addEventListener('click', (e) => { e.stopPropagation(); beginInlineAdd(row, leaf); });
    row.append(add);
  }
  return row;
}

// 親（グループ）
function renderGroup(item) {
  const g = el('div', 'group');
  const anyRun = item.children.some(c => c.running);
  const parentRow = el('div', `row parent${item.done ? ' done' : ''}${anyRun ? ' anyrun' : ''}${isCarried(item) ? ' carried' : ''}`);
  const tri = el('span', 'tri', item._collapsed ? '▶' : '▼');
  tri.addEventListener('click', (e) => { e.stopPropagation(); item._collapsed = !item._collapsed; render(); });
  const chk = el('span', 'chk');
  chk.addEventListener('click', (e) => { e.stopPropagation(); toggleDone(item, false, null); });
  const name = el('span', 'name', item.text);
  const doneCount = item.children.filter(c => c.done).length;
  const sum = item.children.reduce((a, c) => a + (c.done ? c.accumulatedSec : liveSec(c)), 0);
  const agg = el('span', 'agg');
  agg.append(el('span', 'prog', `${doneCount}/${item.children.length}`), document.createTextNode(' · '), el('span', 'js-sum', fmt(sum)));
  const add = el('span', 'row-add', '＋');
  add.title = '子作業を追加';
  add.addEventListener('click', (e) => { e.stopPropagation(); beginInlineAdd(parentRow, item); });
  parentRow.append(tri, chk, name, agg, add);
  if (item._collapsed) parentRow.classList.add('collapsed-mark');
  g.append(parentRow);
  if (!item._collapsed) {
    const kids = el('div', 'children');
    item.children.forEach(c => kids.append(renderLeafRow(c, { child: true, parent: item })));
    g.append(kids);
  }
  return g;
}

// 子作業のインライン追加入力
function beginInlineAdd(afterRow, parent) {
  const input = el('input', 'inline-add-input');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = '子作業…';
  const wrap = el('div', 'row child inline-add');
  wrap.append(el('span', 'chk ghost'), input);
  afterRow.insertAdjacentElement('afterend', wrap);
  input.focus();
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); addChild(parent, input.value); }
    if (e.key === 'Escape') render();
  });
  input.addEventListener('blur', () => { if (input.value.trim()) addChild(parent, input.value); else render(); });
}

export function render() {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  if (items.length === 0) {
    containerEl.append(el('div', 'list-empty', 'やることを書き足す →'));
  }
  for (const item of items) {
    containerEl.append(item.children.length ? renderGroup(item) : renderLeafRow(item));
  }
}

// 毎秒更新。走行中があれば軽く再描画して時間・親集計を反映する。
// 子作業のインライン入力中は再描画しない（入力が消えないように）。
function tick() {
  if (!containerEl) return;
  if (runningLeafCount() === 0) return;
  if (containerEl.querySelector('.inline-add-input')) {
    // 入力中は末端の秒だけを直接書き換える
    for (const l of allLeaves()) {
      if (!l.running) continue;
      const span = containerEl.querySelector(`.t[data-leaf-id="${l.id}"]`);
      if (span) span.textContent = fmt(liveSec(l));
    }
    return;
  }
  render();
  persist(); // throttled
}

// ── 初期化 ──────────────────────────────────────────────
export function initTasks({ container, addInput, log, onRunningChange } = {}) {
  containerEl = container;
  addInputEl = addInput;
  logger = log || null;
  onRunChange = onRunningChange || null;

  items = normalize(storageGet('mt_active_items', []));
  currentSet = Number(storageGet('mt_active_set', 1)) || 1;

  if (addInputEl) {
    addInputEl.addEventListener('mousedown', (e) => e.stopPropagation());
    addInputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); addTop(addInputEl.value); addInputEl.value = ''; }
      if (e.key === 'Escape') addInputEl.value = '';
    });
  }

  render();
  setInterval(tick, 1000);
}
