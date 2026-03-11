// ── Persistent storage (tauri-plugin-store / localStorage fallback) ─────────
let _store = null;
const _cache = {};

const KEYS = ['mt_window_size', 'mt_theme', 'mt_tasks', 'mt_current_task', 'mt_logs'];

export async function initStorage() {
  if (window.__TAURI__) {
    const { load } = await import('@tauri-apps/plugin-store');
    _store = await load('appdata.json', { autoSave: false });
    for (const key of KEYS) {
      const val = await _store.get(key);
      if (val !== null && val !== undefined) _cache[key] = val;
    }
  } else {
    for (const key of KEYS) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        try { _cache[key] = JSON.parse(raw); } catch { _cache[key] = raw; }
      }
    }
  }
}

export function storageGet(key, def = null) {
  const v = _cache[key];
  return v !== undefined ? v : def;
}

export async function storageSet(key, value) {
  _cache[key] = value;
  if (_store) {
    await _store.set(key, value);
    await _store.save();
  } else {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

export async function storageClear(key) {
  delete _cache[key];
  if (_store) {
    await _store.delete(key);
    await _store.save();
  } else {
    localStorage.removeItem(key);
  }
}
