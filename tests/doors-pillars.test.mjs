import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMap, isWalkableG, seesThroughG, startsOk } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { snapshot, restore } = await import('../js/ai/snapshot.js');
const { S } = L;

const SLUGS = ['manor_of_nadargath', 'sunken_hold_of_the_serpent_knight', 'wayrock_maze'];
const loadMapData = slug => JSON.parse(readFileSync(new URL(`../maps/${slug}/${slug}.json`, import.meta.url), 'utf8'));
const mapOf = slug => buildMap({ slug, data: loadMapData(slug), image: { naturalWidth: 1, naturalHeight: 1 } });

const byName = name => S.combatants.find(c => c.name.startsWith(name));
const logText = () => S.log.map(e => e.text);

// A floor cell next to the door, and the door itself
function besideDoor(kind) {
  const door = S.currentMap.doors.find(d => d.kind === kind);
  assert.ok(door, `the map has a ${kind} door`);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && isWalkableG(S.currentMap, door.x + dx, door.y + dy) && !L.isOccupied(door.x + dx, door.y + dy)) {
      return { door, cell: { x: door.x + dx, y: door.y + dy } };
    }
  }
  throw new Error('no free cell beside the door');
}
async function doorFight(kind, a = ['Kadgar'], b = ['Ras']) {
  await newFight({ teamA: a, teamB: b, seed: 1, map: 'sunken_hold_of_the_serpent_knight' });
  const found = besideDoor(kind);
  const me = byName(a[0]);
  me.x = found.cell.x; me.y = found.cell.y;
  while (L.activeCombatant() !== me) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  return { ...found, me };
}

// ── Pillars ────────────────────────────────────────────────────────────────

test('a pillar cell is not walkable', () => {
  const data = loadMapData('wayrock_maze');
  const map = mapOf('wayrock_maze');
  assert.equal(data.columns.length, 18);
  for (const c of data.columns) {
    assert.equal(isWalkableG(map, c.x - map.grid.minX + 1, c.y - map.grid.minY + 1), false, `pillar at ${c.x},${c.y}`);
  }
});

test('a map without pillars loses no floor', () => {
  const data = loadMapData('manor_of_nadargath');
  const floor = Math.max(...data.rects.map(r => r.x + r.w)) - Math.min(...data.rects.map(r => r.x));
  assert.ok(floor > 0);
  assert.equal(data.columns.length, 0);
});

test('nobody is placed on a pillar', () => {
  const data = loadMapData('wayrock_maze');
  const map = mapOf('wayrock_maze');
  const pillars = new Set(data.columns.map(c => `${c.x - map.grid.minX + 1},${c.y - map.grid.minY + 1}`));
  for (const team of [0, 1]) for (const c of map.starts[team]) assert.ok(!pillars.has(`${c.x},${c.y}`));
});

// ── Spawns and closed doors ────────────────────────────────────────────────

for (const slug of SLUGS) {
  test(`${slug}: both teams start connected with every closed door shut`, () => {
    const map = mapOf(slug);
    assert.equal(startsOk(map.starts, map.grid, 4), true);
    const from = map.starts[0][0];
    const seen = new Set([`${from.x},${from.y}`]), queue = [from];
    while (queue.length) {
      const { x, y } = queue.pop();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && isWalkableG(map, x + dx, y + dy)) { seen.add(k); queue.push({ x: x + dx, y: y + dy }); }
      }
    }
    for (const c of map.starts[1]) assert.ok(seen.has(`${c.x},${c.y}`), `team 1 cell ${c.x},${c.y} reachable`);
  });
}

test('locked, secret and portcullis doors start closed with their hit points', () => {
  const kinds = mapOf('sunken_hold_of_the_serpent_knight').doors.map(d => d.kind);
  assert.deepEqual([...new Set(kinds)].sort(), ['locked', 'portcullis', 'secret']);
  for (const d of mapOf('wayrock_maze').doors) {
    assert.equal(d.open, false);
    assert.ok(d.hp > 0 && d.hp === d.maxHp);
  }
});

test('a closed door is a wall; a portcullis still lets sight through; an open door is floor', () => {
  const map = mapOf('sunken_hold_of_the_serpent_knight');
  const locked = map.doors.find(d => d.kind === 'locked');
  const bars = map.doors.find(d => d.kind === 'portcullis');
  assert.equal(isWalkableG(map, locked.x, locked.y), false);
  assert.equal(seesThroughG(map, locked.x, locked.y), false);
  assert.equal(isWalkableG(map, bars.x, bars.y), false);
  assert.equal(seesThroughG(map, bars.x, bars.y), true);
  locked.open = true;
  assert.equal(isWalkableG(map, locked.x, locked.y), true);
  assert.equal(seesThroughG(map, locked.x, locked.y), true);
});

// ── Opening and breaking ───────────────────────────────────────────────────

test('a unit beside a door opens it with its action, and the turn ends', async () => {
  const { door, me } = await doorFight('locked');
  const serial = S.turnSerial;
  L.handleOpenDoor(me.id, door.x, door.y);
  assert.equal(door.open, true);
  assert.notEqual(S.turnSerial, serial, 'the turn moved on');
  assert.equal(isWalkableG(S.currentMap, door.x, door.y), true);
  assert.ok(logText().some(t => /opens the locked door/.test(t)));
});

test('a unit that is not beside the door cannot open it', async () => {
  const { door, me } = await doorFight('secret');
  me.x = door.x + 5; me.y = door.y + 5;
  L.handleOpenDoor(me.id, door.x, door.y);
  assert.equal(door.open, false);
});

test('a basic attack wears a door down, and the last blow breaks it', async () => {
  const { door, me } = await doorFight('secret');
  door.hp = 1;
  L.handleAttackDoor(me.id, door.x, door.y);
  assert.equal(door.open, true);
  assert.equal(door.hp, 0);
  assert.ok(logText().some(t => /breaks the secret door open/.test(t)));
});

test('a damaging area spell wears down a door in its blast', async () => {
  const { door, cell, me } = await doorFight('locked');
  const hp = door.hp;
  L.handleCastAbility(me.id, 'Thunder Storm', [], cell);
  while (S.awaitingReact) L.handleReactNo();
  assert.ok(door.hp < hp || door.open, 'the door took damage');
});

test('a door outside the blast is left alone', async () => {
  const { door, cell, me } = await doorFight('locked');
  const far = S.currentMap.doors.find(d => d !== door && Math.max(Math.abs(d.x - cell.x), Math.abs(d.y - cell.y)) > 8);
  assert.ok(far);
  const hp = far.hp;
  L.handleCastAbility(me.id, 'Thunder Storm', [], cell);
  while (S.awaitingReact) L.handleReactNo();
  assert.equal(far.hp, hp);
});

// ── The AI's snapshot ──────────────────────────────────────────────────────

test('a rewound snapshot restores a door that was opened and broken in between', async () => {
  const { door, me } = await doorFight('locked');
  const snap = snapshot();
  L.handleOpenDoor(me.id, door.x, door.y);
  assert.equal(isWalkableG(S.currentMap, door.x, door.y), true);
  restore(snap);
  const again = S.currentMap.doors.find(d => d.kind === 'locked' && d.x === door.x && d.y === door.y);
  assert.equal(again.open, false);
  assert.equal(isWalkableG(S.currentMap, door.x, door.y), false, 'and the cell is a wall again');
});
