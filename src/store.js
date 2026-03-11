// ── Persistent storage (localStorage) ────────────────────────────────────
const _cache = {};

export async function initStorage() {
  const KEYS = ['mt_window_size', 'mt_theme', 'mt_tasks', 'mt_current_task', 'mt_logs'];
  for (const key of KEYS) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      try { _cache[key] = JSON.parse(raw); } catch { _cache[key] = raw; }
    }
  }
}

export function storageGet(key, def = null) {
  const v = _cache[key];
  return v !== undefined ? v : def;
}

export async function storageSet(key, value) {
  _cache[key] = value;
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export async function storageClear(key) {
  delete _cache[key];
  localStorage.removeItem(key);
}
