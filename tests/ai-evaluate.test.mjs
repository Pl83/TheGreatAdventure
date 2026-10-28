import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { applyPlan, settleReacts } = await import('../js/ai/apply.js');
const { greedyTurn, greedyReact } = await import('../js/ai/greedy.js');
const { snapshot } = await import('../js/ai/snapshot.js');
const { evaluate, WEIGHTS } = await import('../js/ai/evaluate.js');

const { S } = L;
const teamA = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
const teamB = ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'];

const mine = () => S.combatants.filter(c => c.teamIndex === 0);
const theirs = () => S.combatants.filter(c => c.teamIndex === 1);
const ko = c => { c.isKO = true; c.currentHp = 0; };

test('weights are a frozen object', () => {
  assert.ok(Object.isFrozen(WEIGHTS));
});

test('damaging an enemy raises the score', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const before = evaluate(0);
  theirs()[0].currentHp = Math.ceil(theirs()[0].maxHp / 2);
  assert.ok(evaluate(0) > before);
});

test('a KO\'d own unit costs more than the same unit merely hurt', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const base = evaluate(0);
  const u = mine()[0];
  const hp = u.currentHp;
  u.currentHp = 1;
  const hurt = evaluate(0);
  ko(u);
  const down = evaluate(0);
  u.isKO = false; u.currentHp = hp;
  assert.ok(base > hurt && hurt > down);
  assert.ok(base - down > 2 * (base - hurt));
});

test('a stunned enemy scores higher than the same enemy unstunned', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const foe = theirs()[0];
  const plain = evaluate(0);
  foe.statusEffects.push({ name: 'stun', turnsLeft: 1, dice: null, damType: null, notes: '' });
  assert.ok(evaluate(0) > plain);
  foe.statusEffects.pop();
  mine()[0].statusEffects.push({ name: 'stun', turnsLeft: 1, dice: null, damType: null, notes: '' });
  assert.ok(evaluate(0) < plain);
});

test('a silenced or rooted enemy is worth a little', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const foe = theirs()[0];
  const plain = evaluate(0);
  foe.statusEffects.push({ name: 'root', turnsLeft: 1, dice: null, damType: null, notes: '' });
  const rooted = evaluate(0);
  assert.ok(rooted > plain);
  foe.statusEffects[0] = { name: 'stun', turnsLeft: 1, dice: null, damType: null, notes: '' };
  assert.ok(evaluate(0) > rooted);
});

test('spending a once-per-fight move lowers the score slightly', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const jaina = theirs().find(c => c.name === 'Admiral Jaina');
  const ab = jaina.abilities.find(a => a.isOncePerFight);
  assert.ok(ab);
  const before = evaluate(1), ours = evaluate(0);
  jaina.usedThisFight.push(ab.name);
  const after = evaluate(1);
  assert.ok(after < before && before - after < 0.5);
  // The enemy's spent move is a small gain for us
  assert.ok(evaluate(0) > ours);
});

test('a team with no living enemies scores 1e6, and with no living units -1e6', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  theirs().forEach(ko);
  assert.equal(evaluate(0), 1e6);
  assert.equal(evaluate(1), -1e6);
});

test('a symmetric view: the two teams see opposite scores', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  theirs()[0].currentHp = 3;
  assert.ok(Math.abs(evaluate(0) + evaluate(1)) < 1e-9);
});

test('evaluation is deterministic, pure, and fast on a mid-fight 5v5', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  while (S.phase === 'combat' && S.roundNumber <= 3) {
    settleReacts(greedyReact);
    if (S.phase !== 'combat') break;
    if (!applyPlan(greedyTurn(L.activeCombatant())).accepted) applyPlan({ move: null, action: { type: 'pass' } });
  }
  settleReacts(greedyReact);
  const snap = JSON.stringify(snapshot());
  const first = evaluate(0);
  assert.equal(evaluate(0), first);
  const start = performance.now();
  for (let i = 0; i < 5000; i++) evaluate(i % 2);
  const ms = performance.now() - start;
  assert.ok(ms < 500, `5000 evaluations took ${ms.toFixed(0)} ms`);
  assert.equal(JSON.stringify(snapshot()), snap);
});
