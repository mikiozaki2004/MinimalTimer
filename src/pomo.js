const setsDisplayEl = document.getElementById('sets-display');
const setsDecBtn = document.getElementById('sets-dec');
const setsIncBtn = document.getElementById('sets-inc');
const startBtn = document.getElementById('start-btn');
const closeBtn = document.getElementById('close-btn');

const STORAGE_KEY = 'mt_pomo_sets';
const DEFAULT_SETS = 4;

let setsCount = (() => {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    return isNaN(v) ? DEFAULT_SETS : Math.min(12, Math.max(1, v));
  } catch {
    return DEFAULT_SETS;
  }
})();

function render() {
  setsDisplayEl.textContent = setsCount;
}

setsDecBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setsCount = Math.max(1, setsCount - 1);
  render();
});

setsIncBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setsCount = Math.min(12, setsCount + 1);
  render();
});

startBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    localStorage.setItem(STORAGE_KEY, String(setsCount));
  } catch {}
  await window.__TAURI__?.event?.emitTo?.('main', 'pomo-start', { sets: setsCount });
  await window.__TAURI__?.window?.getCurrentWindow?.()?.hide?.();
});

closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
closeBtn.addEventListener('click', () => {
  void window.__TAURI__?.window?.getCurrentWindow?.()?.hide?.();
});

render();
