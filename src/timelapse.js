// タイムラプス記録モジュール
// Webカメラ映像を一定間隔でキャプチャし、WebCodecs + mp4-muxer で MP4 化する。
import { storageGet, storageSet } from './store.js';

const KEY = {
  enabled:    'mt_timelapse_enabled',
  cameraId:   'mt_timelapse_camera_id',
  intervalSec:'mt_timelapse_interval_sec',
  fps:        'mt_timelapse_fps',
  resolution: 'mt_timelapse_resolution',
};

const DEFAULTS = {
  enabled: false,
  cameraId: '',
  intervalSec: 10,
  fps: 30,
  resolution: '640x480',
};

const state = {
  ...DEFAULTS,
  recording: false,
  framesCaptured: 0,
  startedAt: null,
  lastSavedPath: null,
  lastError: null,
  // internal
  stream: null,
  videoEl: null,
  canvas: null,
  ctx: null,
  encoder: null,
  muxer: null,
  intervalId: null,
  frameIndex: 0,
  taskLabel: '',
};

const listeners = new Set();
function emit() {
  const snap = getStatus();
  for (const fn of listeners) {
    try { fn(snap); } catch (_) { /* ignore */ }
  }
}

export function onStatusChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getStatus() {
  return {
    enabled: state.enabled,
    recording: state.recording,
    framesCaptured: state.framesCaptured,
    startedAt: state.startedAt,
    lastSavedPath: state.lastSavedPath,
    lastError: state.lastError,
  };
}

export function getSettings() {
  return {
    enabled: state.enabled,
    cameraId: state.cameraId,
    intervalSec: state.intervalSec,
    fps: state.fps,
    resolution: state.resolution,
  };
}

export function loadSettings() {
  state.enabled     = Boolean(storageGet(KEY.enabled, DEFAULTS.enabled));
  state.cameraId    = String(storageGet(KEY.cameraId, DEFAULTS.cameraId) || '');
  state.intervalSec = clamp(Number(storageGet(KEY.intervalSec, DEFAULTS.intervalSec)) || DEFAULTS.intervalSec, 1, 600);
  state.fps         = clamp(Number(storageGet(KEY.fps, DEFAULTS.fps)) || DEFAULTS.fps, 1, 60);
  state.resolution  = String(storageGet(KEY.resolution, DEFAULTS.resolution) || DEFAULTS.resolution);
  emit();
}

export function saveSettings(partial) {
  if ('enabled'     in partial) state.enabled     = Boolean(partial.enabled);
  if ('cameraId'    in partial) state.cameraId    = String(partial.cameraId || '');
  if ('intervalSec' in partial) state.intervalSec = clamp(Number(partial.intervalSec) || DEFAULTS.intervalSec, 1, 600);
  if ('fps'         in partial) state.fps         = clamp(Number(partial.fps) || DEFAULTS.fps, 1, 60);
  if ('resolution'  in partial) state.resolution  = String(partial.resolution || DEFAULTS.resolution);
  storageSet(KEY.enabled, state.enabled);
  storageSet(KEY.cameraId, state.cameraId);
  storageSet(KEY.intervalSec, state.intervalSec);
  storageSet(KEY.fps, state.fps);
  storageSet(KEY.resolution, state.resolution);
  emit();
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function parseResolution(s) {
  const m = String(s).match(/^(\d+)x(\d+)$/);
  if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  return { width: 640, height: 480 };
}

export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  // 一度パーミッションを取得しないとラベルが空になるので軽くストリームを開いて閉じる
  let tempStream = null;
  try {
    tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (_) {
    // ignore — ラベルなしで列挙する
  } finally {
    if (tempStream) tempStream.getTracks().forEach(t => t.stop());
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(d => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `カメラ ${i + 1}` }));
}

export function isSupported() {
  return typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof window.VideoEncoder === 'function'
    && typeof window.VideoFrame === 'function';
}

async function setupRecorder() {
  const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.mjs');
  const { width, height } = parseResolution(state.resolution);

  // カメラ取得
  const videoConstraints = {
    width:  { ideal: width },
    height: { ideal: height },
  };
  if (state.cameraId) videoConstraints.deviceId = { ideal: state.cameraId };
  state.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });

  // 表示用の隠し video 要素
  const video = document.createElement('video');
  video.style.display = 'none';
  video.muted = true;
  video.playsInline = true;
  video.srcObject = state.stream;
  document.body.appendChild(video);
  await new Promise((resolve, reject) => {
    let done = false;
    const ok = () => { if (done) return; done = true; resolve(); };
    const ng = (e) => { if (done) return; done = true; reject(e); };
    video.onloadeddata = ok;
    video.onerror = ng;
    video.play().then(ok).catch(ng);
    setTimeout(() => ok(), 2000);
  });
  state.videoEl = video;

  // トラックの実解像度に合わせる（要求と一致しないことがある）
  const track = state.stream.getVideoTracks()[0];
  const ts = track.getSettings();
  const w = ts.width  || video.videoWidth  || width;
  const h = ts.height || video.videoHeight || height;

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  state.canvas = canvas;
  state.ctx = canvas.getContext('2d');

  // mp4-muxer
  state.muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  // VideoEncoder
  state.encoder = new VideoEncoder({
    output: (chunk, meta) => state.muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error('[timelapse] encoder error', e);
      state.lastError = String(e?.message || e);
      emit();
    },
  });
  state.encoder.configure({
    codec: 'avc1.42E01F', // H.264 baseline
    width: w,
    height: h,
    bitrate: 2_500_000,
    framerate: state.fps,
  });

  state.frameIndex = 0;
  state.framesCaptured = 0;
}

function captureFrame() {
  if (!state.recording || !state.videoEl || !state.encoder) return;
  if (state.videoEl.readyState < 2) return;
  try {
    state.ctx.drawImage(state.videoEl, 0, 0, state.canvas.width, state.canvas.height);
    const usPerFrame = Math.round(1_000_000 / state.fps);
    const timestamp = state.frameIndex * usPerFrame;
    const vf = new VideoFrame(state.canvas, { timestamp, duration: usPerFrame });
    const keyFrame = state.frameIndex % state.fps === 0; // 約1秒ごと（再生時換算）
    state.encoder.encode(vf, { keyFrame });
    vf.close();
    state.frameIndex++;
    state.framesCaptured++;
    emit();
  } catch (e) {
    console.error('[timelapse] capture error', e);
    state.lastError = String(e?.message || e);
    emit();
  }
}

// start/stop の競合を避けるため直列に処理する
let opChain = Promise.resolve();
function enqueue(fn) {
  const next = opChain.then(fn).catch((e) => { console.warn('[timelapse] op error', e); });
  opChain = next;
  return next;
}

export function start(meta = {}) {
  return enqueue(() => _start(meta));
}

async function _start(meta) {
  if (state.recording) return;
  if (!state.enabled) return;
  if (!isSupported()) {
    state.lastError = 'WebCodecs が利用できません';
    emit();
    return;
  }
  state.lastError = null;
  state.taskLabel = meta.task || '';
  try {
    await setupRecorder();
  } catch (e) {
    console.error('[timelapse] setup failed', e);
    state.lastError = String(e?.message || e);
    await cleanup();
    return;
  }
  state.recording = true;
  state.startedAt = Date.now();
  state.intervalId = setInterval(captureFrame, state.intervalSec * 1000);
  captureFrame(); // 開始時に1フレーム
  emit();
}

async function cleanup() {
  if (state.intervalId !== null) clearInterval(state.intervalId);
  state.intervalId = null;
  try { state.stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
  state.stream = null;
  if (state.videoEl?.parentNode) state.videoEl.parentNode.removeChild(state.videoEl);
  state.videoEl = null;
  state.canvas = null;
  state.ctx = null;
  state.encoder = null;
  state.muxer = null;
  state.recording = false;
  state.frameIndex = 0;
  state.startedAt = null;
  emit();
}

export function stop(opts = {}) {
  return enqueue(() => _stop(opts));
}

async function _stop({ save = true } = {}) {
  if (!state.recording && !state.muxer) return null;
  const wasRecording = state.recording;
  state.recording = false;
  if (state.intervalId !== null) clearInterval(state.intervalId);
  state.intervalId = null;

  let savedPath = null;
  try {
    if (save && wasRecording && state.encoder && state.muxer && state.framesCaptured > 0) {
      await state.encoder.flush();
      state.muxer.finalize();
      const buf = state.muxer.target.buffer;
      const bytes = new Uint8Array(buf);
      const fileName = buildFileName(state.taskLabel);
      savedPath = await window.__TAURI__?.core?.invoke?.('save_timelapse_mp4', {
        fileName,
        data: Array.from(bytes),
      });
      state.lastSavedPath = savedPath;
    }
  } catch (e) {
    console.error('[timelapse] finalize/save error', e);
    state.lastError = String(e?.message || e);
  }

  await cleanup();
  return savedPath;
}

function buildFileName(task) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const safe = (task || 'session').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 40);
  return `${stamp}_${safe || 'session'}.mp4`;
}

export async function openFolder() {
  await window.__TAURI__?.core?.invoke?.('open_timelapses_folder');
}

export async function probePermission() {
  // カメラパーミッションを事前確認するためのテストアクセス
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    state.lastError = String(e?.message || e);
    emit();
    return false;
  }
}
