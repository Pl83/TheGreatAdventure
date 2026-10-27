import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, aoeCombatantHits, aoeCenterValid, coneCells, blastReaches } from '../js/combat-logic.js';

// Two rooms split by a wall at x = 5, joined by a door at (5, 0).
//   x: 0123456789
const MAP = [
  '##########',
  '#####.####',
  '#####.####',
  '#####.####',
  '#####.####',
];
function useMap(lines) {
  const walkable = lines.map(l => Uint8Array.from([...l].map(c => (c === '#' ? 1 : 0))));
  S.currentMap = { grid: { walkable, cols: lines[0].length, rows: lines.length } };
}
const fighter = (id, teamIndex, x, y) => ({ id, teamIndex, x, y, isKO: false, name: `f${id}`, statusEffects: [] });

test('an AoE blast does not reach a fighter behind a wall', () => {
  useMap(MAP);
  const caster = fighter(0, 0, 0, 2);
  const near   = fighter(1, 1, 3, 3);   // same room as the blast centre
  const behind = fighter(2, 1, 6, 3);   // within radius, but across the wall
  S.combatants = [caster, near, behind];
  const hits = aoeCombatantHits({ radius: 4, targetKind: 'enemy' }, caster, 3, 2);
  assert.deepEqual(hits.map(t => t.id), [1]);
});

test('an AoE cannot be centred on a cell the caster cannot see, or on a wall', () => {
  useMap(MAP);
  const caster = fighter(0, 0, 0, 3);
  const ability = { range: 8, radius: 4 };
  assert.equal(aoeCenterValid(caster, ability, 3, 3), true);
  assert.equal(aoeCenterValid(caster, ability, 7, 3), false); // other room
  assert.equal(aoeCenterValid(caster, ability, 5, 3), false); // the wall itself
});

test('splash reach stops at walls', () => {
  useMap(MAP);
  assert.equal(blastReaches(4, 2, 6, 2, 3), false);
  assert.equal(blastReaches(4, 0, 6, 0, 3), true); // through the door row
});

test('a cone stops at walls', () => {
  useMap(MAP);
  const cells = coneCells({ x: 2, y: 3 }, { range: 8 }, { x: 8, y: 3 });
  assert.ok(cells.some(c => c.x === 4 && c.y === 3));
  assert.ok(!cells.some(c => c.x >= 5));
});
