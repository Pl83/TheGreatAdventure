// Walking-distance helpers shared by the policies.
import { S, bfsReachable } from '../combat-logic.js';

const FAR = 999;

// Walking distance from every cell to the unit standing at (x, y) (its own cell is 0)
export function walkMap(x, y) {
  const dist = bfsReachable(x, y, FAR);
  dist.set(`${x},${y}`, 0);
  return dist;
}

// Walking distance from every cell to the nearest foe (foe cells themselves are 0)
export function distanceToFoes(foes) {
  const dist = new Map();
  for (const f of foes) {
    for (const [k, d] of walkMap(f.x, f.y)) if (d < (dist.get(k) ?? Infinity)) dist.set(k, d);
  }
  return dist;
}

// Walking maps depend on the terrain only (units never block the walk), so each map keeps the ones it computed
const walkCache = new WeakMap();

// Walking distance between two cells of the current map, Infinity when no walk joins them; cached per cell
export function walkDistance(x, y, tx, ty) {
  const map = S.currentMap;
  if (!map) return Math.max(Math.abs(x - tx), Math.abs(y - ty));
  let byCell = walkCache.get(map);
  if (!byCell) walkCache.set(map, byCell = new Map());
  const key = `${x},${y}`;
  let dist = byCell.get(key);
  if (!dist) byCell.set(key, dist = walkMap(x, y));
  return dist.get(`${tx},${ty}`) ?? Infinity;
}
