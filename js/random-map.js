/* ═══════════════════════════════════════════════════════════════════════════
   js/random-map.js — Turns "Random dungeon" into a playable map.

   Up to RANDOM_MAX_ATTEMPTS fresh Watabou seeds, all inside one
   RANDOM_BUDGET_MS window. An attempt counts only if its PNG aligns with
   the loader grid and both teams get valid start cells. Anything else —
   generator error, timeout, offline — ends silently on the fallback map.
   ═══════════════════════════════════════════════════════════════════════════ */

import { runWatabou } from './watabou-runner.js';
import { buildMap, alignmentOk, startsOk, loadMap } from './dungeon-loader.js';

export const RANDOM_BUDGET_MS    = 15000;
export const RANDOM_MAX_ATTEMPTS = 3;
const PER_TEAM      = 5;
const FALLBACK_SLUG = 'manor_of_nadargath';

/**
 * Resolve a generated map, or the fallback map when attempts or time run out.
 * Never rejects on generation failures. A result that arrives after the
 * budget is spent is discarded (its run is aborted).
 *
 * deps (for tests): run(seed, signal), decode(blob), loadFallback(), budgetMs
 */
export async function loadRandomMapOrManor({
  run          = runWatabou,
  decode       = decodeImage,
  loadFallback = () => loadMap(FALLBACK_SLUG),
  budgetMs     = RANDOM_BUDGET_MS,
} = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Random map budget spent', 'TimeoutError')), budgetMs);
  const spent = new Promise(resolve => ctrl.signal.addEventListener('abort', () => resolve(null), { once: true }));
  try {
    const map = await Promise.race([attempts(run, decode, ctrl.signal), spent]);
    if (map) return map;
  } catch { /* fall through to the fallback */ } finally {
    clearTimeout(timer);
    ctrl.abort(); // stop any run still in flight
  }
  return loadFallback();
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function attempts(run, decode, signal) {
  for (let i = 0; i < RANDOM_MAX_ATTEMPTS && !signal.aborted; i++) {
    try {
      const { json, png } = await run(String(Math.floor(Math.random() * 1e9)), signal);
      const image = await decode(png);
      if (signal.aborted) return null;
      const map = buildMap({ slug: 'random', data: json, image, perTeam: PER_TEAM });
      if (alignmentOk(map.grid, image) && startsOk(map.starts, map.grid, PER_TEAM)) return map;
    } catch { /* failed attempt: try the next seed */ }
  }
  return null;
}

/** Blob → loaded Image. The object URL is released once decoded. */
function decodeImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('generated PNG failed to decode')); };
    img.src = url;
  });
}
