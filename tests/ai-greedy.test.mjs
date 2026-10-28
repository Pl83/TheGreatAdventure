import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { applyPlan, settleReacts } = await import('../js/ai/apply.js');
const { greedyTurn, greedyReact } = await import('../js/ai/greedy.js');

const { S } = L;
const teamA = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
const teamB = ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'];

// Plays both sides with the greedy policy; a rejected plan falls back to a pass. Returns the rejected count
function playOut() {
  let rejected = 0;
  while (S.phase === 'combat' && S.roundNumber <= 60) {
    settleReacts(greedyReact);
    if (S.phase !== 'combat') break;
    const unit = L.activeCombatant();
    if (!applyPlan(greedyTurn(unit)).accepted) { rejected++; applyPlan({ move: null, action: { type: 'pass' } }); }
  }
  return rejected;
}

for (const seed of [1, 2, 3]) {
  test(`greedy vs greedy finishes within 60 rounds (seed ${seed})`, async () => {
    await newFight({ teamA, teamB, seed });
    assert.equal(playOut(), 0, 'the policy emitted a rejected plan');
    assert.equal(S.phase, 'victory');
  });
}

test('a unit with every ability on cooldown and no foe in reach passes', async () => {
  await newFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 1 });
  const c = L.activeCombatant();
  for (const ab of c.abilities) c.cooldowns[ab.name] = 5;
  c.speed = 0;
  const plan = greedyTurn(c);
  assert.equal(plan.action.type, 'pass');
  assert.equal(plan.move, null);
});

test('a taunted unit attacks the taunter', async () => {
  await newFight({ teamA: ['Susano', 'Alicia'], teamB: ['Sensei Lloyd', 'Admiral Jaina'], seed: 1 });
  const c = L.activeCombatant();
  const foes = L.enemies(c);
  const taunter = foes[1];
  // Everyone adjacent: the taunter is not the weakest foe, so only the taunt can pick it
  foes[0].currentHp = 1;
  const free = (x, y) => isWalkableG(S.currentMap, x, y) && !L.isOccupied(x, y);
  const spots = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if ((dx || dy) && free(c.x + dx, c.y + dy)) spots.push({ x: c.x + dx, y: c.y + dy });
  }
  [foes[0].x, foes[0].y] = [spots[0].x, spots[0].y];
  [taunter.x, taunter.y] = [spots[1].x, spots[1].y];
  for (const ab of c.abilities) c.cooldowns[ab.name] = 5;
  c.statusEffects.push({ name: 'taunted', sourceId: taunter.id, duration: 2 });
  const plan = greedyTurn(c);
  assert.deepEqual(plan.action, { type: 'attack', targetId: taunter.id });
});

test('greedyReact picks the first non-teleport react, else null', async () => {
  await newFight({ teamA: ['Kadgar'], teamB: ['Thormak, The Titan Slayer'], seed: 1 });
  const kadgar = S.combatants.find(c => c.name === 'Kadgar');
  const tele = { name: 'Greater Teleportation', tags: ['teleportation', 'react'] };
  const other = { name: 'Other React', tags: ['react'] };
  S.reactOptions = [{ combatantId: kadgar.id, ability: tele }];
  assert.equal(greedyReact(), null);
  S.reactOptions = [{ combatantId: kadgar.id, ability: tele }, { combatantId: kadgar.id, ability: other }];
  assert.deepEqual(greedyReact(), { combatantId: kadgar.id, abilityName: 'Other React' });
  S.reactOptions = [];
});

// Walking distance from c to its nearest foe
function walkTo(c) {
  return Math.min(...L.enemies(c).map(f => {
    if (L.chebyshev(c, f) === 0) return 0;
    return L.bfsReachable(f.x, f.y, 999).get(`${c.x},${c.y}`) ?? Infinity;
  }));
}

// A 1v1 on `name`'s turn, speed 5, with the foe placed `gap` walking steps away
async function duelAt(name, gap) {
  await newFight({ teamA: [name], teamB: ['Alicia'], seed: 1 });
  if (L.activeCombatant().name !== name) L.handlePass();
  const c = L.activeCombatant();
  c.speed = 5;
  const foe = L.enemies(c)[0];
  const cell = [...L.bfsReachable(c.x, c.y, gap)].find(([k, d]) => d === gap && !L.isOccupied(...k.split(',').map(Number)));
  [foe.x, foe.y] = cell[0].split(',').map(Number);
  return { c, foe };
}

test('a unit out of reach of every foe walks strictly closer', async () => {
  const { c } = await duelAt('Susano', 12);
  c.abilities = [];
  const before = walkTo(c);
  const plan = greedyTurn(c);
  assert.ok(plan.move, 'expected a move');
  const from = { x: c.x, y: c.y };
  c.x = plan.move.x; c.y = plan.move.y;
  assert.ok(walkTo(c) < before);
  c.x = from.x; c.y = from.y;
});

for (const [label, name, strip] of [['melee-only', 'Susano', true], ['ranged', 'Kadgar', false]]) {
  test(`a ${label} unit with a foe in walking range ends in reach and the plan is accepted`, async () => {
    const { c } = await duelAt(name, 4);
    if (strip) c.abilities = [];
    const plan = greedyTurn(c);
    assert.notEqual(plan.action.type, 'pass');
    assert.equal(applyPlan(plan).accepted, true);
  });
}

test('a heal is not chosen for an out-of-range ally', async () => {
  await newFight({ teamA: ['Susano', 'Alicia'], teamB: ['Sensei Lloyd', 'Admiral Jaina'], seed: 1 });
  const c = L.activeCombatant();
  const friend = L.allies(c).find(a => a.id !== c.id);
  const heal = { name: 'Test Heal', dice: '1d6', cost: null, tags: ['heal'], target: 'mono', targetKind: 'ally',
    range: 3, radius: 0, isHeal: true, cooldownTurns: 0 };
  c.abilities = [heal];
  c.speed = 0;
  friend.currentHp = 1;
  const far = [...L.bfsReachable(c.x, c.y, 30)].map(([k]) => k.split(',').map(Number))
    .find(([x, y]) => L.chebyshev(c, { x, y }) > 3 && !L.isOccupied(x, y));
  [friend.x, friend.y] = far;
  assert.notEqual(greedyTurn(c).action.ability, 'Test Heal');
  const near = [...L.bfsReachable(c.x, c.y, 2)].map(([k]) => k.split(',').map(Number))
    .find(([x, y]) => !L.isOccupied(x, y) && L.targetInRange(c, { x, y }, heal).inRange);
  [friend.x, friend.y] = near;
  assert.deepEqual(greedyTurn(c).action, { type: 'cast', ability: 'Test Heal', targetIds: [friend.id] });
});

test('greedyBrain plans for the active unit and reacts like greedyReact', async () => {
  const { greedyBrain } = await import('../js/ai/greedy.js');
  await newFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 1 });
  assert.deepEqual(greedyBrain.chooseTurn(L.activeCombatant().teamIndex), greedyTurn(L.activeCombatant()));
  assert.equal(greedyBrain.chooseReact, greedyReact);
});
