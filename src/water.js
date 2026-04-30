// Water-fill animation — draws into a 280×280 canvas clipped to the timer circle

const W = 280, H = 280, CX = 140, CY = 140, R = 123;

let ctx = null;
let getState = null;
let w1 = 0, w2 = 0;          // wave phases
let bubbles = [];
let drops = [];
let splashes = [];
let nextDrop = 0;
let rafId = null;

function rgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  return m
    ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`
    : `rgba(88,166,255,${a})`;
}

function col() {
  return getComputedStyle(document.documentElement).getPropertyValue('--ring').trim() || '#58A6FF';
}

function makeBubble(surfY) {
  const depth = Math.max(12, CY + R - surfY - 10);
  return {
    x: CX + (Math.random() - 0.5) * R * 1.3,
    y: surfY + 12 + Math.random() * depth,
    r: 1 + Math.random() * 2,
    vx: (Math.random() - 0.5) * 0.15,
    vy: 0.15 + Math.random() * 0.3,
    a: 0.3 + Math.random() * 0.4,
  };
}

function makeDrop() {
  return {
    x: CX + (Math.random() - 0.5) * R * 1.1,
    y: CY - R + 8,
    vy: 1.5 + Math.random() * 2,
    r: 2 + Math.random() * 1.5,
  };
}

function frame(now) {
  rafId = null;
  const { fill, running } = getState();
  const c = col();

  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.clip();

  const waterY = CY + R - fill * 2 * R;
  const waveAmp = 4.5 * Math.sin(Math.min(fill, 1) * Math.PI);

  const waveAt = x =>
    Math.sin(x * 0.038 + w1) * waveAmp +
    Math.sin(x * 0.055 - w2) * waveAmp * 0.45;

  if (fill > 0.002) {
    w1 += 0.025;
    w2 += 0.017;

    // ── Water body ──────────────────────────────────────────────────
    ctx.beginPath();
    let first = true;
    for (let x = CX - R - 5; x <= CX + R + 5; x += 4) {
      const y = waterY + waveAt(x);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.lineTo(CX + R + 5, CY + R + 5);
    ctx.lineTo(CX - R - 5, CY + R + 5);
    ctx.closePath();

    const g = ctx.createLinearGradient(0, waterY - 10, 0, CY + R);
    g.addColorStop(0,   rgba(c, 0.48));
    g.addColorStop(0.3, rgba(c, 0.32));
    g.addColorStop(1,   rgba(c, 0.18));
    ctx.fillStyle = g;
    ctx.fill();

    // ── Surface shimmer line ─────────────────────────────────────────
    ctx.beginPath();
    first = true;
    for (let x = CX - R - 5; x <= CX + R + 5; x += 4) {
      const y = waterY + waveAt(x);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(c, 0.75);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Bubbles ──────────────────────────────────────────────────────
    if (fill > 0.08) {
      while (bubbles.length < 8) bubbles.push(makeBubble(waterY));

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.x += b.vx;
        b.y -= b.vy;

        if (b.y < waterY + waveAt(b.x) - 2) {
          bubbles[i] = makeBubble(waterY);
          bubbles[i].y = CY + R - 8;
          continue;
        }

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(c, b.a * 0.85);
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fill();
      }
    }
  } else {
    bubbles = [];
  }

  // ── Droplets ─────────────────────────────────────────────────────
  if (running && fill < 0.97 && now >= nextDrop) {
    drops.push(makeDrop());
    nextDrop = now + 1800 + Math.random() * 1200;
  }

  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.y += d.vy;
    d.vy += 0.2;

    const surf = fill > 0.002 ? waterY + waveAt(d.x) : CY + R;

    if (d.y >= surf - 3) {
      splashes.push(
        { x: d.x, y: surf, r: 1,   maxR: 8 + Math.random() * 5, a: 0.85, spd: 0.55 },
        { x: d.x, y: surf, r: 0.5, maxR: 3.5,                    a: 0.55, spd: 0.3  },
      );
      drops.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.beginPath();
    ctx.ellipse(0, 0, d.r * 0.65, d.r, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(c, 0.88);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-d.r * 0.2, -d.r * 0.3, d.r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
    ctx.restore();
  }

  // ── Splashes ─────────────────────────────────────────────────────
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.r += s.spd;
    s.a -= 0.038;
    if (s.a <= 0 || s.r >= s.maxR) { splashes.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(c, s.a);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();

  if (fill > 0.002 || drops.length || splashes.length)
    rafId = requestAnimationFrame(frame);
}

export function initWater(canvas, stateGetter) {
  ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;
  getState = stateGetter;
}

export function resetWater() {
  bubbles = []; drops = []; splashes = [];
  w1 = 0; w2 = 0; nextDrop = 0;
  if (ctx) ctx.clearRect(0, 0, W, H);
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

export function ensureLoop() {
  if (rafId !== null || !getState) return;
  const { fill } = getState();
  if (fill > 0.002 || drops.length || splashes.length) {
    if (!nextDrop) nextDrop = performance.now() + 600 + Math.random() * 600;
    rafId = requestAnimationFrame(frame);
  }
}
