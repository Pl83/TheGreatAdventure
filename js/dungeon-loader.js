/* ═══════════════════════════════════════════════════════════════════════════
   js/dungeon-loader.js — Loads dungeon maps from maps/ directory.
   Each map: maps/{slug}/{slug}.png (visual) + maps/{slug}/{slug}.json (data).

   Coordinate spaces
   ─────────────────
   JSON space : integers matching watabou one-page-dungeon format (can be negative)
   Grid space : 0-based, 0…cols-1 / 0…rows-1  ← what combatant x/y use
   Canvas px  : 0…PNG_width/height             ← for drawing

   JSON → Grid : gx = jx − minX + BORDER,  gy = jy − minY + BORDER
   Grid → Canvas px (top-left) : px = gx × cellPx,  py = gy × cellPx

   The watabou PNG is rendered at exactly BORDER=1 cell of padding, so
     cellPx = PNG_width / cols  (always an integer for official watabou exports)
   ═══════════════════════════════════════════════════════════════════════════ */

const BORDER = 1; // 1-cell border — matches watabou PNG export margin

// ── Public API ──────────────────────────────────────────────────────────────

/** Fetch the array of map directory slugs from maps/manifest.json. */
export async function loadManifest() {
  const res = await fetch('maps/manifest.json');
  if (!res.ok) throw new Error(`manifest fetch failed (${res.status})`);
  return res.json();
}

/**
 * Load a map by slug.
 * Returns { slug, name, story, image, grid, starts } ready for combat.
 *
 * grid   : { walkable, minX, minY, cols, rows, BORDER }
 * starts : { 0: [{x,y},…], 1: [{x,y},…] }  — grid coordinates
 */
export async function loadMap(slug) {
  const [data, image] = await Promise.all([
    fetch(`maps/${slug}/${slug}.json`).then(r => {
      if (!r.ok) throw new Error(`map JSON fetch failed (${r.status}): ${slug}`);
      return r.json();
    }),
    loadImage(`maps/${slug}/${slug}.png`),
  ]);
  const grid   = buildWalkableGrid(data.rects);
  const starts = deriveSpawnPoints(data.rects, grid);
  return { slug, name: data.title, story: data.story || '', image, grid, starts };
}

/** Pixel size of one grid cell for this map (e.g. 70 for watabou exports). */
export function cellPxOf(map) {
  return map.image.naturalWidth / map.grid.cols;
}

/** True if grid coordinate (gx, gy) is inside the map and walkable. */
export function isWalkableG(map, gx, gy) {
  const { walkable, cols, rows } = map.grid;
  return gx >= 0 && gy >= 0 && gx < cols && gy < rows && walkable[gy][gx] === 1;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Promise-based image loader. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img  = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${src}`));
    img.src     = src;
  });
}

/**
 * Convert watabou rects → walkable Uint8Array grid.
 *
 * Each rect covers cells (r.x … r.x+r.w-1, r.y … r.y+r.h-1) in JSON space.
 * Shifted by (-minX+BORDER, -minY+BORDER) to get 0-based grid coordinates.
 *
 * Returns { walkable, minX, minY, cols, rows, BORDER }.
 */
function buildWalkableGrid(rects) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.x       < minX) minX = r.x;
    if (r.y       < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  const cols     = (maxX - minX) + 2 * BORDER;
  const rows     = (maxY - minY) + 2 * BORDER;
  const walkable = Array.from({ length: rows }, () => new Uint8Array(cols));

  for (const r of rects) {
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        const gx = (r.x + dx) - minX + BORDER;
        const gy = (r.y + dy) - minY + BORDER;
        walkable[gy][gx] = 1;
      }
    }
  }
  return { walkable, minX, minY, cols, rows, BORDER };
}

/**
 * Auto-derive 4 spawn cells per team.
 * Strategy: sort "large" rooms (area ≥ 9) by center X.
 *   Team 0 → leftmost large room (cells at +1,+1 … +2,+2 from origin).
 *   Team 1 → rightmost large room.
 * Falls back to all rects if fewer than 2 large rooms exist.
 *
 * Returns grid coordinates.
 */
function deriveSpawnPoints(rects, grid) {
  let large = rects
    .filter(r => r.w * r.h >= 9)
    .sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2));

  if (large.length < 2) {
    large = [...rects].sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2));
  }

  const leftRoom  = large[0];
  const rightRoom = large[large.length - 1];

  function cellsFromRoom(room) {
    const cells = [];
    for (let dy = 1; dy < room.h && cells.length < 4; dy++) {
      for (let dx = 1; dx < room.w && cells.length < 4; dx++) {
        cells.push({
          x: (room.x + dx) - grid.minX + grid.BORDER,
          y: (room.y + dy) - grid.minY + grid.BORDER,
        });
      }
    }
    // Fallback: if the room had no interior (1×1 or 2×1), use the corner
    if (cells.length === 0) {
      cells.push({
        x: room.x - grid.minX + grid.BORDER,
        y: room.y - grid.minY + grid.BORDER,
      });
    }
    return cells;
  }

  return { 0: cellsFromRoom(leftRoom), 1: cellsFromRoom(rightRoom) };
}
