// Walking-distance helpers shared by the policies.
import { S, bfsReachable } from '../combat-logic.js';

const FAR = 999;

// Walking distance from every cell to the unit standing at (x, y) (its own cell is 0)
export function walkMap(x, y) {
  const dist = bfsReachable(x, y, FAR);
  dist.set(`${x},${y}`, 0);
  return dist;
}

// Walking distances depend on the terrain only (units never block a walk), so each map keeps, per source cell,
// the distance to every cell as an Int16Array indexed y * cols + x (-1: no walk leads there). An opened door
// changes the terrain, so a map keeps one table per set of open doors.
const walkCache = new WeakMap();

function walkArray(map, x, y) {
  let bySig = walkCache.get(map);
  if (!bySig) walkCache.set(map, bySig = new Map());
  const sig = map.doorSig ?? '';
  let byCell = bySig.get(sig);
  if (!byCell) bySig.set(sig, byCell = new Map());
  const { cols, rows } = map.grid;
  const key = y * cols + x;
  let dist = byCell.get(key);
  if (!dist) {
    dist = new Int16Array(cols * rows).fill(-1);
    for (const [k, d] of walkMap(x, y)) {
      const [cx, cy] = k.split(',').map(Number);
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) dist[cy * cols + cx] = d;
    }
    byCell.set(key, dist);
  }
  return dist;
}

// Walking distance between two cells of the current map, Infinity when no walk joins them (Chebyshev off-map)
export function walkDistance(x, y, tx, ty) {
  const map = S.currentMap;
  if (!map) return Math.max(Math.abs(x - tx), Math.abs(y - ty));
  const { cols, rows } = map.grid;
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return Infinity;
  const d = walkArray(map, x, y)[ty * cols + tx];
  return d < 0 ? Infinity : d;
}

// Walking distance from a cell to the nearest of foes (a foe's own cell is 0), as a function of (x, y)
export function foeDistance(foes) {
  return (x, y) => {
    let best = Infinity;
    for (const f of foes) best = Math.min(best, walkDistance(f.x, f.y, x, y));
    return best;
  };
}
