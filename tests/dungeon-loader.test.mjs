import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMap, alignmentOk, startsOk } from '../js/dungeon-loader.js';

const manorData = JSON.parse(
  readFileSync(new URL('../maps/manor_of_nadargath/manor_of_nadargath.json', import.meta.url), 'utf8'));

function manor(perTeam) {
  const first = buildMap({ slug: 'm', data: manorData, image: { naturalWidth: 70, naturalHeight: 70 }, perTeam });
  const { cols, rows } = first.grid;
  return buildMap({ slug: 'm', data: manorData, image: { naturalWidth: cols * 70, naturalHeight: rows * 70 }, perTeam });
}

// Synthetic grid: rows of strings, '#' walkable.
function gridOf(lines) {
  const walkable = lines.map(l => Uint8Array.from([...l].map(c => (c === '#' ? 1 : 0))));
  return { walkable, cols: lines[0].length, rows: lines.length };
}
const row = (n, y, x0 = 0) => Array.from({ length: n }, (_, i) => ({ x: x0 + i, y }));

test('manor starts and grid are unchanged', () => {
  const m = manor();
  assert.deepEqual(m.starts, {
    0: [{ x: 2, y: 20 }, { x: 3, y: 20 }, { x: 4, y: 20 }, { x: 5, y: 20 }],
    1: [{ x: 18, y: 20 }, { x: 19, y: 20 }, { x: 20, y: 20 }, { x: 21, y: 20 }],
  });
  const { cols, rows, minX, minY } = m.grid;
  assert.deepEqual({ cols, rows, minX, minY }, { cols: 23, rows: 32, minX: -14, minY: -11 });
});

test('alignmentOk true for exact 70px/cell', () => {
  assert.equal(alignmentOk({ cols: 23, rows: 32 }, { naturalWidth: 23 * 70, naturalHeight: 32 * 70 }), true);
});

test('alignmentOk false when height ratio differs', () => {
  assert.equal(alignmentOk({ cols: 23, rows: 32 }, { naturalWidth: 23 * 70, naturalHeight: 32 * 70 + 10 }), false);
});

test('startsOk true for Manor with perTeam 4', () => {
  const m = manor();
  assert.equal(startsOk(m.starts, m.grid, 4), true);
});

test('startsOk false when a team has fewer cells than perTeam', () => {
  const m = manor();
  assert.equal(startsOk(m.starts, m.grid, 5), false);
});

test('startsOk false when teams are closer than 6 cells', () => {
  const grid = gridOf(['##############']);
  assert.equal(startsOk({ 0: row(3, 0, 0), 1: row(3, 0, 7) }, grid, 3), false); // gap 5
  assert.equal(startsOk({ 0: row(3, 0, 0), 1: row(3, 0, 8) }, grid, 3), true);  // gap 6
});

test("startsOk false when a team's cells are split across disconnected rooms", () => {
  const grid = gridOf(['##.##.......##']);
  const starts = { 0: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }], 1: row(2, 0, 12) };
  assert.equal(startsOk(starts, grid, 2), false);
});
