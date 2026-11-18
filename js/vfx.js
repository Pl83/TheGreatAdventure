/* ═══════════════════════════════════════════════════════════════════════════
   js/vfx.js — Pixel effects on the combat map (pixelfx, vendored in js/vendor/pixelfx)

   A transparent canvas sits over #dungeon-canvas. Effects are drawn into one
   low-resolution pixel frame, scaled up with no smoothing, and positioned by
   grid cell (so they survive the combat screen's re-renders). The loop only runs
   while an effect is alive. Nothing here touches the game state.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createFrame, clearFrame, createFx } from './vendor/pixelfx/core/index.js';
import * as hitSpark   from './vendor/pixelfx/fx/impacts/hit-spark.js';
import * as bluntHit   from './vendor/pixelfx/fx/impacts/blunt-hit.js';
import * as critHit    from './vendor/pixelfx/fx/impacts/crit-hit.js';
import * as smallBoom  from './vendor/pixelfx/fx/explosions/small-explosion.js';
import * as iceShatter from './vendor/pixelfx/fx/ice/ice-shatter.js';
import * as zapHit     from './vendor/pixelfx/fx/lightning/zap-hit.js';
import * as earthSpike from './vendor/pixelfx/fx/nature/earth-spike.js';
import * as acidSplash from './vendor/pixelfx/fx/nature/acid-splash.js';
import * as bloom      from './vendor/pixelfx/fx/nature/healing-bloom.js';
import * as darkBoom   from './vendor/pixelfx/fx/shadow/dark-explosion.js';
import * as manaBurst  from './vendor/pixelfx/fx/arcane/mana-burst.js';
import * as smite      from './vendor/pixelfx/fx/holy/smite.js';
import * as poof       from './vendor/pixelfx/fx/spawn/poof.js';

// cap: seconds before the effect is told to wind down (the library keeps smoke around for ages)
// dy:  art pixels the effect's origin sits below the token's centre (ground effects stand at the feet)
const BLUE = ['#06142a', '#0e3a6e', '#1c6fb4', '#4fb0e8', '#a6e4ff', '#ffffff'];
const PALE = ['#1b2a2a', '#4d6f6a', '#8fbfb4', '#d3f2e8', '#ffffff'];
const FX = {
  physical:  { mod: hitSpark,   cap: 0.5 },
  heavy:     { mod: bluntHit,   cap: 0.8 },
  critical:  { mod: critHit,    cap: 0.8 },
  fire:      { mod: smallBoom,  cap: 0.9, dy: 8 },
  ice:       { mod: iceShatter, cap: 1.3 },
  lightning: { mod: zapHit,     cap: 0.8 },
  earth:     { mod: earthSpike, cap: 1.2, dy: 8 },
  water:     { mod: hitSpark,   cap: 0.5, palette: BLUE },
  wind:      { mod: hitSpark,   cap: 0.5, palette: PALE },
  poison:    { mod: acidSplash, cap: 1.1, dy: 6 },
  dark:      { mod: darkBoom,   cap: 1.0, dy: 8 },
  psy:       { mod: manaBurst,  cap: 1.0, dy: 6 },
  radiant:   { mod: smite,      cap: 1.2, dy: 8 },
  heal:      { mod: bloom,      cap: 1.5, dy: 8 },
  death:     { mod: poof,       cap: 1.2, dy: 8 },
  teleport:  { mod: manaBurst,  cap: 0.9, dy: 6 },
};
const ALIAS = { necro: 'dark', holy: 'radiant' };

/** Which effect a hit calls for: its damage type (or the first element among its tags), heavier when it takes a quarter of the target's HP. */
export function hitKind(damType, atkTags = [], dealt = 0, maxHp = 1) {
  const pick = [damType, ...atkTags].map(t => String(t ?? '').toLowerCase()).map(t => ALIAS[t] ?? t).find(t => t !== 'physical' && FX[t]);
  if (pick) return pick;
  return dealt >= maxHp * 0.4 ? 'critical' : dealt >= maxHp * 0.25 ? 'heavy' : 'physical';
}

// A status, when it first lands, shows the element it belongs to
const STATUS_FX = {
  burn: 'fire', calcinated: 'fire', poison: 'poison', toxic: 'poison', freeze: 'ice', gel: 'ice',
  stun: 'lightning', para: 'lightning', root: 'earth', fear: 'dark', silence: 'psy', wet: 'water',
  bleed: 'physical', hemoragie: 'physical', prone: 'heavy',
};
export const statusKind = key => STATUS_FX[String(key ?? '').toLowerCase()] ?? null;

// ── Switch ─────────────────────────────────────────────────────────────────
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
let enabled = true;
try {
  const saved = localStorage.getItem('combatFx');
  enabled = saved ? saved === 'on' : !reduced();
} catch {}

export const fxEnabled = () => enabled;
export function setFxEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem('combatFx', enabled ? 'on' : 'off'); } catch {}
  if (!enabled) { live.length = 0; overlay?.getContext('2d').clearRect(0, 0, overlay.width, overlay.height); }
}

// ── Live effects ───────────────────────────────────────────────────────────
const live = [];     // { fx, gx, gy, dy, cap }
const REDRAW_MS = 1000 / 30, FRAME_BUDGET_MS = 8, MAX_LIVE = 10;
let raf = 0, last = 0, seedN = 1, cellPx = 70;

/** Start the effect `kind` on `unit` (any { x, y } grid cell; `cp` is the map's cell size in canvas px). Safe to call any time. */
export function playFx(kind, unit, cp) {
  const def = FX[ALIAS[kind] ?? kind];
  if (!enabled || !def || !unit || typeof document === 'undefined') return;
  const opts = { seed: seedN++ };
  if (def.palette) opts.palette = def.palette;
  cellPx = cp || cellPx;
  while (live.length >= MAX_LIVE) live.shift();   // a burst of effects drops the oldest
  // A hit and the status it carries land together: one effect per kind per cell is enough
  if (live.some(e => e.kind === kind && e.gx === unit.x && e.gy === unit.y && e.fx.t < 0.35)) return;
  live.push({ kind, fx: createFx(def.mod, opts), gx: unit.x, gy: unit.y, dy: def.dy ?? 0, cap: def.cap });
  if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
}

// ── Overlay canvas ─────────────────────────────────────────────────────────
let overlay = null, scale = 2;

/** The overlay on the current map canvas, (re)built when the combat screen was re-rendered or the map resized. */
function syncOverlay() {
  const map = document.getElementById('dungeon-canvas');
  if (!map || !map.width) return null;
  if (!overlay || overlay.parentNode !== map.parentNode) {
    overlay = document.createElement('canvas');
    overlay.className = 'vfx-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    map.parentNode.appendChild(overlay);
  }
  if (overlay.width !== map.width || overlay.height !== map.height) { overlay.width = map.width; overlay.height = map.height; }
  Object.assign(overlay.style, {
    left: map.offsetLeft + 'px', top: map.offsetTop + 'px',
    width: map.clientWidth + 'px', height: map.clientHeight + 'px',
  });
  return map;
}

/** The map is drawn turned a quarter-turn (see drawMap): grid (gx, gy) lands at canvas (gy, H − gx) in cell units. */
function cellCentre(gx, gy, cp, H) {
  return [(gy + 0.5) * cp, H - (gx + 0.5) * cp];
}

/**
 * pixelfx's composite() visits every pixel of the frame; ours skips the empty ones, which are nearly all of them
 * (the same maths for the rest, over a transparent background). `out` is cleared first.
 */
function compositeSparse(f, out) {
  out.fill(0);
  const n = f.w * f.h, C = f.color, L = f.light;
  for (let i = 0; i < n; i++) {
    const c = C[i], l = L[i] & 0xffffff;
    if (!c && !l) continue;
    let r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255, a = c >>> 24;
    if (l) {
      const lr = l & 255, lg = (l >>> 8) & 255, lb = (l >>> 16) & 255;
      if (a < 255) {
        const pa = a / 255, pr = r * pa + lr, pg = g * pa + lg, pb = b * pa + lb;
        const na = Math.min(1, Math.max(pa, Math.max(lr, lg, lb) / 255));
        if (na > 0) { r = Math.min(255, pr / na); g = Math.min(255, pg / na); b = Math.min(255, pb / na); a = na * 255; }
      } else {
        r = Math.min(255, r + lr); g = Math.min(255, g + lg); b = Math.min(255, b + lb);
      }
    }
    const j = i * 4;
    out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = a;
  }
}

/** Each effect draws into a frame just as big as its author declared (meta.size) and is stamped onto the overlay. */
function surfaceOf(e) {
  if (e.frame) return e;
  const [w, h] = e.fx.meta.size, [ox, oy] = e.fx.meta.origin;
  e.frame = createFrame(w, h, -ox, -oy);
  e.img = new ImageData(w, h);
  e.off = document.createElement('canvas'); e.off.width = w; e.off.height = h;
  e.offCtx = e.off.getContext('2d');
  return e;
}

function tick(now) {
  raf = 0;
  const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
  last = now;
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i];
    e.fx.update(dt);
    if (e.fx.t >= e.cap) e.fx.stop();
    if (e.fx.done()) live.splice(i, 1);
  }
  const map = syncOverlay();
  if (map) {
    // A token is about 0.7 cell wide and the library's stock character is 24 px: that sets the zoom
    scale = Math.max(1, Math.round(cellPx * 0.7 / 24));
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.imageSmoothingEnabled = false;
    // Drawing an effect costs 1–25 ms on a slow machine. Each is redrawn at most 30 times a second (the rate they are
    // authored for), and once the frame's budget is spent the late ones stamp their last picture again.
    const started = performance.now();
    for (const e of live) {
      surfaceOf(e);
      const due = !e.drawnAt || now - e.drawnAt >= REDRAW_MS;
      if (due && (!e.drawnAt || performance.now() - started < FRAME_BUDGET_MS)) {
        clearFrame(e.frame);
        e.fx.draw(e.frame, 'back');
        e.fx.draw(e.frame, 'front');
        compositeSparse(e.frame, e.img.data);
        e.offCtx.putImageData(e.img, 0, 0);
        e.drawnAt = now;
      }
      const [px, py] = cellCentre(e.gx, e.gy, cellPx, map.height);
      const [w, h] = e.fx.meta.size, [ox, oy] = e.fx.meta.origin;
      ctx.drawImage(e.off, Math.round(px - ox * scale), Math.round(py + e.dy * scale - oy * scale), w * scale, h * scale);
    }
  }
  if (live.length) raf = requestAnimationFrame(tick);
}

export const FX_DEFS = FX;
