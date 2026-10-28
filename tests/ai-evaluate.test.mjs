import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { applyPlan, settleReacts } = await import('../js/ai/apply.js');
const { greedyTurn, greedyReact, avgDice } = await import('../js/ai/greedy.js');
const { snapshot } = await import('../js/ai/snapshot.js');
const { evaluate, engagement, material, WEIGHTS } = await import('../js/ai/evaluate.js');

const { S } = L;
const teamA = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
const teamB = ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'];

const mine = () => S.combatants.filter(c => c.teamIndex === 0);
const theirs = () => S.combatants.filter(c => c.teamIndex === 1);
const ko = c => { c.isKO = true; c.currentHp = 0; };
const status = name => ({ name, turnsLeft: 2, dice: null, damType: null, notes: '' });

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
  // Falling costs the alive weight on top of the last HP
  assert.ok(base - down - (base - hurt) >= WEIGHTS.alive);
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

test('a team with no living enemies scores the win weight, and a wiped team its negation', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  theirs().forEach(ko);
  assert.equal(evaluate(0), WEIGHTS.win);
  assert.equal(evaluate(1), -WEIGHTS.win);
});

test('the own team wiped scores -win even with the enemy team badly hurt', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  mine().forEach(ko);
  theirs().forEach(c => { c.currentHp = 1; });
  assert.equal(evaluate(0), -WEIGHTS.win);
  assert.equal(evaluate(1), WEIGHTS.win);
});

test('the win weight is above any material lead short of a win', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  theirs().slice(1).forEach(ko);
  theirs()[0].currentHp = 1;
  assert.ok(WEIGHTS.win > evaluate(0), `near-won position scores ${evaluate(0)}`);
});

test('a symmetric view: the two teams see opposite material scores', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  theirs()[0].currentHp = 3;
  assert.ok(Math.abs(material(0) + material(1)) < 1e-9);
});

test('mid-fight with statuses on both sides, the material scores stay opposite', async () => {
  await newFight({ teamA, teamB, seed: 3 });
  for (let i = 0; i < 12 && S.phase === 'combat'; i++) {
    settleReacts(greedyReact);
    if (!applyPlan(greedyTurn(L.activeCombatant())).accepted) L.handlePass();
  }
  settleReacts(greedyReact);
  mine()[1].statusEffects.push(status('stun'));
  mine()[2].statusEffects.push(status('silence'));
  theirs()[0].statusEffects.push(status('root'));
  theirs()[1].statusEffects.push(status('freeze'));
  theirs()[2].usedThisFight.push(theirs()[2].abilities.find(a => a.isOncePerFight)?.name ?? 'none');
  assert.ok(Math.abs(material(0) + material(1)) < 1e-9, `${material(0)} vs ${material(1)}`);
});

test('a silenced enemy is worth the hinder weight, and an own silenced unit costs it', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const plain = evaluate(0);
  theirs()[0].statusEffects.push(status('silence'));
  assert.ok(Math.abs(evaluate(0) - plain - WEIGHTS.hinder) < 1e-9);
  theirs()[0].statusEffects.pop();
  mine()[0].statusEffects.push(status('silence'));
  assert.ok(Math.abs(plain - evaluate(0) - WEIGHTS.hinder) < 1e-9);
});

test('a charged ability counts as unspent until its last charge is gone', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const thormak = theirs().find(c => c.name === 'Thormak, The Titan Slayer');
  const bow = thormak.abilities.find(a => a.maxCharges > 0);
  assert.ok(bow, 'fixture needs a charged ability');
  const full = evaluate(1);
  thormak.remainingCharges[bow.name] = 1;
  assert.equal(evaluate(1), full);
  thormak.remainingCharges[bow.name] = 0;
  const empty = evaluate(1);
  // The charge bonus and the bow's damage potential are both gone
  const expected = WEIGHTS.unspent + WEIGHTS.damage * avgDice(bow.dice);
  assert.ok(Math.abs(full - empty - expected) < 1e-9, `lost ${full - empty}, expected ${expected}`);
});

test('a damage ability on cooldown lowers the damage potential by its average roll', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const jaina = theirs().find(c => c.name === 'Admiral Jaina');
  const ab = jaina.abilities.find(a => a.dice && !a.isHeal && !a.reactOnly && !a.isOncePerFight && !(a.maxCharges > 0)
    && L.abilityAvailable(jaina, a));
  assert.ok(ab, 'fixture needs a ready damage ability');
  const before = evaluate(0);
  jaina.cooldowns[ab.name] = 3;
  assert.ok(!L.abilityAvailable(jaina, ab));
  assert.ok(Math.abs(evaluate(0) - before - WEIGHTS.damage * avgDice(ab.dice)) < 1e-9);
});

test('engagement: a unit that walks toward the foes raises its own team score, more so late in the fight', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const u = mine()[0];
  const near = theirs().reduce((a, f) => (Math.abs(f.x - u.x) + Math.abs(f.y - u.y) < Math.abs(a.x - u.x) + Math.abs(a.y - u.y) ? f : a));
  const far = engagement(0);
  assert.ok(far < 0, 'the teams start out of reach');
  const cell = L.freeCellAdjacentTo(near, u, u.id);
  const from = { x: u.x, y: u.y };
  u.x = cell.x; u.y = cell.y;
  const close = engagement(0);
  assert.ok(close > far, `${close} vs ${far}`);
  u.x = from.x; u.y = from.y;
  S.roundNumber = 20;
  assert.ok(engagement(0) < far, 'the same gap weighs more in round 20');
  // The term counts against the scored side only, and evaluate is material plus engagement
  assert.ok(engagement(1) <= 0);
  assert.ok(Math.abs(evaluate(0) - material(0) - engagement(0)) < 1e-9);
  // Measured against a fixed foe list, a fallen foe still counts where it fell
  u.x = cell.x; u.y = cell.y;
  const listed = theirs();
  const before = engagement(0, listed);
  ko(near);
  assert.equal(engagement(0, listed), before);
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
