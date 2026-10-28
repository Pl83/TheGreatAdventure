import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { random, setRandom, mulberry32 } = await import('../js/rng.js');
const { applyPlan } = await import('../js/ai/apply.js');
const { greedyTurn, greedyReact, greedyBrain } = await import('../js/ai/greedy.js');
const { snapshot, restore } = await import('../js/ai/snapshot.js');
const { search } = await import('../js/ai/search.js');
const { chooseTurn, chooseReact, createBrain, DEFAULT_SIMS } = await import('../js/ai/brain.js');
const { playFight, makeBrain } = await import('../tools/fight.mjs');

const { S } = L;
const teamA = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
const teamB = ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'];
const KADGAR  = 'Kadgar';                     // Greater Teleportation: a teleport react
const THORMAK = 'Thormak, The Titan Slayer';
const JAINA   = 'Admiral Jaina';
const JEAGEN  = 'Jeagen, White Tiger';
const SEA_BOUND = 'Runik Sea Bound';
const SIM = fileURLToPath(new URL('../tools/sim.mjs', import.meta.url));

const live = () => JSON.stringify(snapshot());
const byName = name => S.combatants.find(c => c.name === name);

// Passes until a team-0 unit that is free to act has the turn
function toTeam0() {
  while (L.activeCombatant().teamIndex !== 0 || L.hasControlEffect(L.activeCombatant())) L.handlePass();
  return L.activeCombatant();
}

// Thormak attacks Kadgar next to him, leaving Kadgar's react prompt pending
async function pendingReact() {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed: 1 });
  if (L.activeCombatant().name !== THORMAK) L.handlePass();
  const thormak = L.activeCombatant(), kadgar = byName(KADGAR);
  const cell = L.freeCellAdjacentTo(kadgar, thormak, thormak.id);
  thormak.x = cell.x; thormak.y = cell.y;
  applyPlan({ move: null, action: { type: 'attack', targetId: kadgar.id } });
  assert.equal(S.awaitingReact, true, 'fixture needs a pending react');
  return kadgar;
}

// Jaina to play with only her control left to cast: Jeagen within reach of Runik Sea Bound, Thormak standing
// next to Jeagen. Her damage spell is cooling down and her once-per-fight relic is spent, so the control
// (or her sword) is all that can profit her team.
async function controlScene() {
  await newFight({ teamA: [JEAGEN], teamB: [JAINA, THORMAK], seed: 3 });
  while (L.activeCombatant().name !== JAINA) L.handlePass();
  const jaina = L.activeCombatant(), foe = byName(JEAGEN), ally = byName(THORMAK);
  const cell = L.freeCellAdjacentTo(ally, jaina, foe.id);
  foe.x = cell.x; foe.y = cell.y;
  jaina.cooldowns['Runik Sea Dragon'] = 9;
  jaina.usedThisFight.push('Dominion of the Seven Sea');
  const bound = jaina.abilities.find(a => a.name === SEA_BOUND);
  assert.ok(L.abilityAvailable(jaina, bound) && L.targetInRange(jaina, foe, bound).inRange, 'fixture needs Sea Bound in reach');
  assert.ok(L.targetInRange(ally, foe, null).inRange, 'fixture needs the ally in reach of the foe');
  return { jaina, foe };
}

test('DEFAULT_SIMS is a positive integer', () => {
  assert.ok(Number.isInteger(DEFAULT_SIMS) && DEFAULT_SIMS >= 1);
});

test('chooseTurn on a controlled unit returns a pass plan without throwing', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const c = toTeam0();
  c.statusEffects.push({ name: 'stun', turnsLeft: 1, dice: null, damType: null, notes: '' });
  assert.deepEqual(chooseTurn(0, { sims: 20 }, 1), { move: null, action: { type: 'pass' } });
});

test('chooseReact returns null or one of the pending react options, and leaves the fight as it was', async () => {
  await pendingReact();
  const before = live();
  const choice = chooseReact(1, { sims: 20 }, 1);
  assert.ok(choice === null || S.reactOptions.some(o => o.combatantId === choice.combatantId && o.ability.name === choice.abilityName),
    `chose ${JSON.stringify(choice)}`);
  assert.equal(live(), before);
  assert.deepEqual(chooseReact(1, { sims: 20 }, 1), choice);
});

test('chooseReact refuses to run without a pending react', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  assert.throws(() => chooseReact(0, { sims: 10 }, 1), /react/);
});

test('two brains with the same seed and budget make the same decisions on the same state', async () => {
  await newFight({ teamA, teamB, seed: 4 });
  toTeam0();
  const snap = snapshot();
  const a = createBrain({ budget: { sims: 30 }, seed: 9 }), b = createBrain({ budget: { sims: 30 }, seed: 9 });
  const first = a.chooseTurn(0);
  restore(snap);
  assert.deepEqual(b.chooseTurn(0), first);
  assert.deepEqual(a.takeErrors(), []);
});

test('a failed search falls back to the greedy plan, reports the error once and changes nothing', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  toTeam0();
  const before = live();
  setRandom(mulberry32(5));
  const seen = [];
  const brain = createBrain({ budget: { sims: 10 }, seed: 1, onError: (err, where) => seen.push([err, where]) });
  // The active unit is on team 0, so a search for team 1 throws
  const plan = brain.chooseTurn(1);
  assert.deepEqual(plan, greedyTurn(L.activeCombatant()));
  const errors = brain.takeErrors();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /active/);
  assert.deepEqual(brain.takeErrors(), []);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], errors[0]);
  assert.equal(live(), before);
  assert.equal(random(), mulberry32(5)());
});

test('a failed react choice falls back to the greedy react', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const brain = createBrain({ budget: { sims: 10 }, seed: 1 });
  // No react is pending: the scoring throws, and the greedy react has no option to take
  assert.equal(brain.chooseReact(), null);
  assert.equal(brain.takeErrors().length, 1);
});

test('the control-then-ally line: Jaina binds the foe next to Thormak rather than passing', async () => {
  // Fixed seeds 1..10 at 80 sims; the control must be the chosen plan in at least 8 of them
  const plans = [];
  for (let seed = 1; seed <= 10; seed++) {
    await controlScene();
    plans.push(search(1, { sims: 80 }, seed).plan);
  }
  const controls = plans.filter(p => p.action.type === 'cast' && p.action.ability === SEA_BOUND).length;
  assert.ok(controls >= 8, `Sea Bound chosen in ${controls} of 10: ${plans.map(p => p.action.ability ?? p.action.type).join(', ')}`);
});

// A stall counts: the fight must end with a winner and no violation of any kind
test('a 5v5 fight with the brain on team 0 against greedy finishes without violations', async () => {
  const r = await playFight({ teamA, teamB, seed: 1, brains: [createBrain({ budget: { sims: 20 }, seed: 1 }), greedyBrain] });
  assert.notEqual(r.winner, null);
  assert.deepEqual(r.violations, []);
});

test('a brain fallback is filed as an exception violation and the fight goes on', async () => {
  let pending = [new Error('lost the thread')];
  const flaky = { ...greedyBrain, takeErrors: () => { const e = pending; pending = []; return e; } };
  const r = await playFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 1, brains: [flaky, greedyBrain], maxRounds: 3 });
  const ex = r.violations.filter(v => v.kind === 'exception');
  assert.equal(ex.length, 1);
  assert.match(ex[0].detail, /brain fallback/);
  assert.match(ex[0].detail, /lost the thread/);
  assert.ok(Object.keys(r.moveUses).length > 0);
});

test('a brain fallback on the react path is filed as an exception violation', async () => {
  let pending = [];
  const flaky = {
    ...greedyBrain,
    chooseReact: () => { pending.push(new Error('react went astray')); return greedyReact(); },
    takeErrors: () => { const e = pending; pending = []; return e; },
  };
  const r = await playFight({ teamA, teamB, seed: 1, brains: [flaky, flaky], maxRounds: 4 });
  assert.ok(r.reactsPlayed > 0, 'fixture needs a react prompt');
  const ex = r.violations.filter(v => v.kind === 'exception');
  assert.ok(ex.length > 0);
  for (const v of ex) assert.match(v.detail, /brain fallback: react went astray/);
  assert.equal(r.violations.length, ex.length + (r.stalled ? 1 : 0));
});

test('errors a brain recorded are filed even when its decision then throws', async () => {
  const broken = {
    ...greedyBrain,
    chooseTurn: () => { throw new Error('gave up'); },
    takeErrors: () => [new Error('noted first')],
  };
  const r = await playFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 1, brains: [broken, broken], maxRounds: 2 });
  const details = r.violations.filter(v => v.kind === 'exception').map(v => v.detail);
  assert.ok(details.some(d => /brain fallback: noted first/.test(d)));
  assert.ok(details.some(d => /gave up/.test(d)));
});

test('a short ai-against-ai fight replays identically from its seed', async () => {
  const fight = () => playFight({ teamA: ['Susano', 'Meï'], teamB: ['Alicia', 'Sensei Lloyd'], seed: 7, maxRounds: 4,
    brains: [makeBrain('ai', { sims: 12 }, 7, 0), makeBrain('ai', { sims: 12 }, 7, 1)] });
  const strip = ({ maxDecisionMs, ...rest }) => rest;
  const a = await fight(), b = await fight();
  assert.deepEqual(b.moveUses, a.moveUses);
  assert.deepEqual(b.kos, a.kos);
  assert.deepEqual(strip(b), strip(a));
  assert.ok(Object.keys(a.moveUses).length > 0);
});

test('makeBrain gives greedy for greedy and a fresh ai brain per seat', () => {
  assert.equal(makeBrain('greedy', { sims: 5 }, 1, 0), greedyBrain);
  const a = makeBrain('ai', { sims: 5 }, 1, 0), b = makeBrain('ai', { sims: 5 }, 1, 1);
  assert.notEqual(a, b);
  assert.equal(typeof a.chooseTurn, 'function');
});

test('sim.mjs plays the ai brain and names it in the header', () => {
  const r = spawnSync(process.execPath, [SIM, teamA.join('; '), teamB.join('; '), '--fights', '1', '--brain-a', 'ai', '--budget', '10'],
    { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 2, `exit ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /Team I: .*\[ai/);
  assert.doesNotMatch(r.stderr, /falling back/);
});
