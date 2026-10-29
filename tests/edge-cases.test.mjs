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

test('a revive puts the fallen ally on the free cell nearest to the caster and right after them in the turn order', async () => {
  await newFight({ teamA: [ZHUQIAO, JAY], teamB: ['Sensei Lloyd'], seed: 1 });
  while (L.activeCombatant().name !== ZHUQIAO) L.handlePass();
  const zhuqiao = L.activeCombatant(), jay = byName(JAY);
  ko(jay);
  const offered = revives(enumeratePlans(zhuqiao));
  assert.ok(offered.length > 0, 'fixture needs the revive in reach');
  const plan = offered.find(p => !p.move) ?? offered[0];
  assert.equal(applyPlan(plan).accepted, true);
  assert.equal(jay.isKO, false);
  // Jay acts next and, with Zhuqiao beside him, the Beast healing aura may already have added to the half
  assert.ok(jay.currentHp >= Math.floor(jay.maxHp * 0.5));
  assert.ok(!S.combatants.some(c => c !== jay && !c.isKO && c.x === jay.x && c.y === jay.y), 'the revived unit shares no cell');
  assert.equal(L.chebyshev(jay, zhuqiao), 1, 'next to Zhuqiao');
  const order = S.initiativeOrder;
  assert.equal(order[order.indexOf(zhuqiao.id) + 1], jay.id, 'Jay acts right after Zhuqiao');
  assert.equal(order.length, new Set(order).size, 'nobody is listed twice');
  assert.equal(order.length, S.combatants.length);
});

test('a revive lands beside the caster even when the caster stands on the fallen ally’s cell, or the cell beside is taken', async () => {
  await newFight({ teamA: [ZHUQIAO, JAY], teamB: ['Sensei Lloyd'], seed: 1 });
  while (L.activeCombatant().name !== ZHUQIAO) L.handlePass();
  const zhuqiao = L.activeCombatant(), jay = byName(JAY), lloyd = byName('Sensei Lloyd');
  ko(jay);
  zhuqiao.x = jay.x; zhuqiao.y = jay.y;
  // Fill the whole ring around Zhuqiao that is free, but one cell: the unit has to use the next nearest
  const ring = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const x = zhuqiao.x + dx, y = zhuqiao.y + dy;
    if ((dx || dy) && L.isWalkableG?.(S.currentMap, x, y) !== false) ring.push({ x, y });
  }
  lloyd.x = ring[0].x; lloyd.y = ring[0].y;
  const plan = revives(enumeratePlans(zhuqiao)).find(p => !p.move);
  assert.ok(plan, 'offered from the fallen ally’s own cell');
  assert.equal(applyPlan(plan).accepted, true);
  assert.equal(jay.isKO, false);
  assert.ok(!(jay.x === zhuqiao.x && jay.y === zhuqiao.y), 'not on the caster');
  assert.ok(!(jay.x === lloyd.x && jay.y === lloyd.y), 'not on the foe');
});

test('the revived unit acts next, right after the caster', async () => {
  await newFight({ teamA: [ZHUQIAO, JAY, 'Jeagen, White Tiger'], teamB: ['Sensei Lloyd'], seed: 5 });
  while (L.activeCombatant().name !== ZHUQIAO) L.handlePass();
  const zhuqiao = L.activeCombatant();
  for (const name of [JAY, 'Jeagen, White Tiger']) {
    const fallen = byName(name);
    ko(fallen);
    const plan = revives(enumeratePlans(zhuqiao)).find(p => p.action.targetIds[0] === fallen.id);
    if (!plan) continue;
    zhuqiao.statusEffects = []; zhuqiao.cooldowns = {}; zhuqiao.usedThisFight = [];
    S.hasActed = false;
    assert.equal(applyPlan(plan).accepted, true);
    assert.equal(L.activeCombatant().id, fallen.id, 'the revived unit acts next');
    const order = S.initiativeOrder;
    assert.equal(order[order.indexOf(zhuqiao.id) + 1], fallen.id);
    return;
  }
  assert.fail('no revive was offered');
});
