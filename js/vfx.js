/* ═══════════════════════════════════════════════════════════════════════════
   js/vfx.js — Pixel effects on the combat map (pixelfx, vendored in js/vendor/pixelfx)

   A transparent canvas sits over #dungeon-canvas. Effects are drawn into one
   low-resolution pixel frame, scaled up with no smoothing, and positioned by
   grid cell (so they survive the combat screen's re-renders). The loop only runs
   while an effect is alive. Nothing here touches the game state.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createFrame, clearFrame, createFx, composite } from './vendor/pixelfx/core/index.js';
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
let raf = 0, last = 0, seedN = 1, cellPx = 70;

/** Start the effect `kind` on `unit` (any { x, y } grid cell; `cp` is the map's cell size in canvas px). Safe to call any time. */
export function playFx(kind, unit, cp) {
  const def = FX[ALIAS[kind] ?? kind];
  if (!enabled || !def || !unit || typeof document === 'undefined') return;
  const opts = { seed: seedN++ };
  if (def.palette) opts.palette = def.palette;
  cellPx = cp || cellPx;
  // A hit and the status it carries land together: one effect per kind per cell is enough
  if (live.some(e => e.kind === kind && e.gx === unit.x && e.gy === unit.y && e.fx.t < 0.35)) return;
  live.push({ kind, fx: createFx(def.mod, opts), gx: unit.x, gy: unit.y, dy: def.dy ?? 0, cap: def.cap });
  if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
}

// ── Overlay canvas ─────────────────────────────────────────────────────────
let overlay = null, off = null, frame = null, img = null, scale = 2;

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
  if (overlay.width !== map.width || overlay.height !== map.height) {
    overlay.width = map.width; overlay.height = map.height;
    const fw = Math.ceil(map.width / scale), fh = Math.ceil(map.height / scale);
    frame = createFrame(fw, fh);
    img = new ImageData(fw, fh);
    off = document.createElement('canvas'); off.width = fw; off.height = fh;
  }
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
    const cp = cellPx;
    const s = Math.max(1, Math.round(cp * 0.7 / 24));
    if (s !== scale) { scale = s; overlay.width = 0; syncOverlay(); }
    clearFrame(frame);
    for (const e of live) {
      const [px, py] = cellCentre(e.gx, e.gy, cp, map.height);
      e.fx.options.x = Math.round(px / scale);
      e.fx.options.y = Math.round(py / scale + e.dy);
      e.fx.draw(frame, 'back');
    }
    for (const e of live) e.fx.draw(frame, 'front');
    composite(frame, img.data, null);
    off.getContext('2d').putImageData(img, 0, 0);
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, off.width * scale, off.height * scale);
  }
  if (live.length) raf = requestAnimationFrame(tick);
}

export const FX_DEFS = FX;
