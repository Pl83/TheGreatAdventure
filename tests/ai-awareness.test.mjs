import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWalkableG, buildMap, indexDoors } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { evaluate, WEIGHTS } = await import('../js/ai/evaluate.js');
const { enumeratePlans } = await import('../js/ai/candidates.js');
const { applyPlan } = await import('../js/ai/apply.js');
const { search } = await import('../js/ai/search.js');
const { walkDistance } = await import('../js/ai/paths.js');
const { avgDice } = await import('../js/ai/greedy.js');
const { S } = L;

const byName = name => S.combatants.find(c => c.name.startsWith(name));
const place = (c, x, y) => { c.x = x; c.y = y; };
const burn = (turnsLeft, dice = '1d4') => ({ name: 'burn', turnsLeft, dice, damType: 'fire', notes: '' });
const field = (over = {}) => ({ name: 'Test field', kind: 'foes', teamIndex: 0, x: 0, y: 0, radius: 2, roundsLeft: 3, exposed: {}, ...over });

// A walled map: room A, one locked door, room B
const WALLED = {
  title: 'Walled', story: '',
  rects: [{ x: 0, y: 0, w: 5, h: 3 }, { x: 5, y: 1, w: 1, h: 1 }, { x: 6, y: 0, w: 5, h: 3 }],
  doors: [{ x: 5, y: 1, dir: { x: 1, y: 0 }, type: 5 }],
};
// One big open room, so a test may put units where it likes
const OPEN = { title: 'Open', story: '', rects: [{ x: 0, y: 0, w: 24, h: 10 }], doors: [] };
async function openFight(teamA, teamB) {
  await newFight({ teamA, teamB, seed: 1 });
  S.currentMap = buildMap({ slug: 'open', data: OPEN, image: { naturalWidth: 70, naturalHeight: 70 } });
}
async function walledFight(teamA = ['Jhin'], teamB = ['Kaelgrym']) {
  await newFight({ teamA, teamB, seed: 1 });
  const real = S.currentMap;
  const map = buildMap({ slug: 'walled', data: WALLED, image: { naturalWidth: 70, naturalHeight: 70 } });
  S.currentMap = map;
  return { map, restore: () => { S.currentMap = real; } };
}

// ── Damage over time ───────────────────────────────────────────────────────

test('a foe burning for three more turns makes the position better for its enemy, by the damage still to come', async () => {
  await newFight({ teamA: ['Jhin'], teamB: ['Kaelgrym'], seed: 1 });
  const foe = byName('Kaelgrym');
  const before = evaluate(0);
  foe.statusEffects.push(burn(3));
  const expected = WEIGHTS.dot * Math.min(avgDice('1d4') * 3, foe.currentHp) / foe.maxHp;
  assert.ok(Math.abs(evaluate(0) - before - expected) < 1e-9, `${evaluate(0) - before} vs ${expected}`);
  assert.ok(evaluate(1) < evaluate(0), 'and worse for the burning side');
});

test('the same burn on your own unit costs you, and a longer burn costs more', async () => {
  await newFight({ teamA: ['Jhin'], teamB: ['Kaelgrym'], seed: 1 });
  const me = byName('Jhin');
  const clean = evaluate(0);
  me.statusEffects.push(burn(1));
  const short = evaluate(0);
  me.statusEffects = [burn(3)];
  const long = evaluate(0);
  assert.ok(short < clean && long < short);
});

test('damage still to come never counts for more than the unit has left', async () => {
  await newFight({ teamA: ['Jhin'], teamB: ['Kaelgrym'], seed: 1 });
  const foe = byName('Kaelgrym');
  foe.currentHp = 1;
  const before = evaluate(0);
  foe.statusEffects.push(burn(5, '10d10'));
  assert.ok(Math.abs(evaluate(0) - before - WEIGHTS.dot * 1 / foe.maxHp) < 1e-9);
});

test('a bleed counts once per move, a haemorrhage three times a turn: it costs more', async () => {
  await newFight({ teamA: ['Jhin'], teamB: ['Kaelgrym'], seed: 1 });
  const me = byName('Jhin');
  me.statusEffects = [{ name: 'bleed', turnsLeft: 4, dice: '1d4', damType: 'physical', notes: '' }];
  const bleed = evaluate(0);
  me.statusEffects = [{ name: 'hemoragie', turnsLeft: 4, dice: '1d4', damType: 'physical', notes: '' }];
  assert.ok(evaluate(0) < bleed);
});

// ── Fields ─────────────────────────────────────────────────────────────────

test('a field of foes is worth rounds x weight per foe standing in it, and costs the other side the same', async () => {
  await newFight({ teamA: ['Meï'], teamB: ['Jhin'], seed: 1 });
  const foe = byName('Jhin');
  place(foe, 10, 10);
  const before = evaluate(0), beforeFoe = evaluate(1);
  S.fields = [field({ x: 10, y: 10, roundsLeft: 4 })];
  assert.ok(Math.abs(evaluate(0) - before - WEIGHTS.field * 4) < 1e-9);
  assert.ok(Math.abs(beforeFoe - evaluate(1) - WEIGHTS.field * 4) < 1e-9, 'the same amount, taken from the other side');
});

test('a field whose foes stand outside it is worth nothing, and a field that is nearly over is worth less', async () => {
  await newFight({ teamA: ['Meï'], teamB: ['Jhin'], seed: 1 });
  place(byName('Jhin'), 10, 10);
  const none = evaluate(0);
  S.fields = [field({ x: 3, y: 3, radius: 2 })];
  assert.equal(evaluate(0), none);
  S.fields = [field({ x: 10, y: 10, roundsLeft: 1 })];
  const one = evaluate(0);
  S.fields = [field({ x: 10, y: 10, roundsLeft: 5 })];
  assert.ok(evaluate(0) > one && one > none);
});

test('a field of allies is worth it to the caster\'s side for each ally inside', async () => {
  await newFight({ teamA: ['Meï'], teamB: ['Jhin'], seed: 1 });
  const me = byName('Meï');
  place(me, 10, 10);
  const before = evaluate(0);
  S.fields = [field({ kind: 'allies', x: 10, y: 10, roundsLeft: 2 })];
  assert.ok(Math.abs(evaluate(0) - before - WEIGHTS.field * 2) < 1e-9);
});

test('a cast of an area or field move carries the cell it is aimed at, and the field rises there', async () => {
  await openFight(['Meï'], ['Jhin']);
  const mei = byName('Meï'), foe = byName('Jhin');
  place(mei, 10, 5); place(foe, 13, 5);
  while (L.activeCombatant() !== mei) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  const plans = enumeratePlans(mei);
  const aimed = plans.filter(p => p.action.type === 'cast' && p.action.ability === 'Field of Corruption');
  assert.ok(aimed.length > 0, 'the bot considers Field of Corruption');
  for (const p of aimed) {
    assert.ok(p.action.center && Number.isInteger(p.action.center.x), 'with an aimed cell');
    assert.ok(L.chebyshev(p.action.center, foe) <= 4, 'that reaches the foe');
  }
  const res = applyPlan(aimed[0]);
  assert.equal(res.accepted, true, res.reason);
  while (S.awaitingReact) L.handleReactNo();
  assert.equal(S.fields.length, 1);
  assert.deepEqual({ x: S.fields[0].x, y: S.fields[0].y }, aimed[0].action.center, 'the field is where the plan aimed it');
});

test('a unit standing in a field of foes is offered a move out of it', async () => {
  await openFight(['Jhin'], ['Meï']);
  const jhin = byName('Jhin'), mei = byName('Meï');
  place(jhin, 10, 5); place(mei, 16, 5);
  S.fields = [field({ teamIndex: 1, x: 10, y: 5, radius: 3 })];
  while (L.activeCombatant() !== jhin) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  const moves = enumeratePlans(jhin).map(p => p.move).filter(Boolean);
  assert.ok(moves.some(m => L.chebyshev(m, { x: 10, y: 5 }) > 3), 'one of the moves ends outside the field');
});

// ── Doors ──────────────────────────────────────────────────────────────────

test('walking distances follow a door once it is open, not the stale table of the closed map', async () => {
  const { map, restore } = await walledFight();
  try {
    assert.equal(walkDistance(1, 2, 9, 2), Infinity, 'closed: no walk joins the rooms');
    map.doors[0].open = true;
    indexDoors(map);
    assert.ok(Number.isFinite(walkDistance(1, 2, 9, 2)), 'open: a walk exists');
    map.doors[0].open = false;
    indexDoors(map);
    assert.equal(walkDistance(1, 2, 9, 2), Infinity, 'shut again (a rewound snapshot): walled off again');
  } finally { restore(); }
});

test('beside a closed door the bot may open it; far from it, it may walk to it', async () => {
  const { map, restore } = await walledFight();
  try {
    const jhin = byName('Jhin'), foe = byName('Kaelgrym');
    const door = map.doors[0];
    place(foe, door.x + 3, door.y);
    place(jhin, door.x - 1, door.y);
    while (L.activeCombatant() !== jhin) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
    assert.ok(enumeratePlans(jhin).some(p => p.action.type === 'openDoor' && p.action.x === door.x && p.action.y === door.y));
    place(jhin, 1, 1);
    const moves = enumeratePlans(jhin).map(p => p.move).filter(Boolean);
    assert.ok(moves.some(m => L.chebyshev(m, door) <= 1), 'a move ends next to the door');
  } finally { restore(); }
});

test('the bot opens the door that walls it off from every foe', async () => {
  const { map, restore } = await walledFight();
  try {
    const jhin = byName('Jhin'), foe = byName('Kaelgrym');
    const door = map.doors[0];
    place(foe, door.x + 3, door.y);
    place(jhin, door.x - 1, door.y);
    while (L.activeCombatant() !== jhin) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
    const { plan } = search(0, { sims: 80 }, 7);
    assert.equal(plan.action.type, 'openDoor');
    const res = applyPlan(plan);
    assert.equal(res.accepted, true, res.reason);
    assert.equal(map.doors[0].open, true, 'the door is open (the search rewound its own copies)');
  } finally { restore(); }
});

test('a plain map with no closed door never offers a door action', async () => {
  await newFight({ teamA: ['Jhin'], teamB: ['Kaelgrym'], seed: 1, map: 'manor_of_nadargath' });
  for (const d of S.currentMap.doors) d.open = true;
  indexDoors(S.currentMap);
  const jhin = byName('Jhin');
  while (L.activeCombatant() !== jhin) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  assert.ok(!enumeratePlans(jhin).some(p => p.action.type === 'openDoor'));
  assert.ok(isWalkableG(S.currentMap, jhin.x, jhin.y));
});
