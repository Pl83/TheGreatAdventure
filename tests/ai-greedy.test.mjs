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

// Plays both sides with the greedy policy; a rejected plan falls back to a pass
function playOut() {
  while (S.phase === 'combat' && S.roundNumber <= 60) {
    settleReacts(greedyReact);
    if (S.phase !== 'combat') break;
    const unit = L.activeCombatant();
    if (!applyPlan(greedyTurn(unit)).accepted) applyPlan({ move: null, action: { type: 'pass' } });
  }
}

for (const seed of [1, 2, 3]) {
  test(`greedy vs greedy finishes within 60 rounds (seed ${seed})`, async () => {
    await newFight({ teamA, teamB, seed });
    playOut();
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
