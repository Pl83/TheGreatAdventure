// Walking-distance helpers shared by the policies.
import { bfsReachable } from '../combat-logic.js';

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
