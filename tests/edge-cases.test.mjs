import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { applyPlan } = await import('../js/ai/apply.js');
const { greedyBrain } = await import('../js/ai/greedy.js');
const { createBrain } = await import('../js/ai/brain.js');
const { enumeratePlans } = await import('../js/ai/candidates.js');
const { playFight } = await import('../tools/fight.mjs');

const { S } = L;
const FIVE = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
const ZHUQIAO = 'Zhuqiao, Vermillion Bird', JAY = 'Jay, Azure Dragon';
const EMBER = 'Resurrection Ember';
const byName = name => S.combatants.find(c => c.name === name);
const ko = c => { c.isKO = true; c.currentHp = 0; };
const revives = plans => plans.filter(p => p.action.type === 'cast' && p.action.ability === EMBER);

test('newFight refuses an empty team and an unknown map', async () => {
  await assert.rejects(newFight({ teamA: [], teamB: ['Jhin'], seed: 1 }), /Empty team/);
  await assert.rejects(newFight({ teamA: ['Jhin'], teamB: ['Kaelgrym'], seed: 1, map: 'nowhere' }), /Unknown map "nowhere". Known: manor_of_nadargath/);
});

test('one ai unit against five greedy ones: the fight ends with a winner and no violation', async () => {
  const r = await playFight({ teamA: ['Sensei Lloyd'], teamB: FIVE, seed: 3, brains: [createBrain({ budget: { sims: 10 }, seed: 3 }), greedyBrain] });
  assert.notEqual(r.winner, null);
  assert.deepEqual(r.violations, []);
});

test('a walled-off unit: the brains play on without errors and the fight is filed as stalled, nothing else', async () => {
  // At the first decision, ring Jhin with walls: no walk, no sight, no reach between the two units
  let walled = false;
  const wall = brain => ({
    ...brain,
    chooseTurn: t => {
      if (!walled) {
        walled = true;
        const jhin = byName('Jhin'), { walkable } = S.currentMap.grid;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) walkable[jhin.y + dy][jhin.x + dx] = 0;
      }
      return brain.chooseTurn(t);
    },
  });
  const brains = [wall(createBrain({ budget: { sims: 10 }, seed: 1 })), wall(createBrain({ budget: { sims: 10 }, seed: 2 }))];
  const r = await playFight({ teamA: ['Jhin'], teamB: ['Kaelgrym'], seed: 1, brains, maxRounds: 4 });
  assert.equal(r.stalled, true);
  assert.deepEqual(r.violations.map(v => v.kind), ['stalled']);
});

test('end to end: a revive brings the fallen ally back on its free cell, and is not offered onto a taken one', async () => {
  await newFight({ teamA: [ZHUQIAO, JAY], teamB: ['Sensei Lloyd'], seed: 1 });
  while (L.activeCombatant().name !== ZHUQIAO) L.handlePass();
  const zhuqiao = L.activeCombatant(), jay = byName(JAY);
  ko(jay);
  const offered = revives(enumeratePlans(zhuqiao));
  assert.ok(offered.length > 0, 'fixture needs the revive in reach');
  const plan = offered.find(p => !p.move) ?? offered[0];
  assert.equal(applyPlan(plan).accepted, true);
  assert.equal(jay.isKO, false);
  assert.equal(jay.currentHp, Math.floor(jay.maxHp * 0.5));
  assert.ok(!S.combatants.some(c => c !== jay && !c.isKO && c.x === jay.x && c.y === jay.y), 'the revived unit shares no cell');

  // Same scene, but Zhuqiao stands on the fallen ally's cell: the engine would stack them, so it is not offered
  await newFight({ teamA: [ZHUQIAO, JAY], teamB: ['Sensei Lloyd'], seed: 1 });
  while (L.activeCombatant().name !== ZHUQIAO) L.handlePass();
  const caster = L.activeCombatant(), fallen = byName(JAY);
  ko(fallen);
  caster.x = fallen.x; caster.y = fallen.y;
  assert.ok(!revives(enumeratePlans(caster)).some(p => !p.move), 'no revive from the fallen ally’s cell');
});
