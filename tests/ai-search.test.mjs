import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { random, setRandom, mulberry32 } = await import('../js/rng.js');
const { applyPlan, settleReacts } = await import('../js/ai/apply.js');
const { greedyTurn, greedyReact } = await import('../js/ai/greedy.js');
const { snapshot, restore } = await import('../js/ai/snapshot.js');
const { enumeratePlans, enumerateReacts } = await import('../js/ai/candidates.js');
const { search, simulate, simulateReact, resolveBudget, horizonFor, MAX_MS } = await import('../js/ai/search.js');
const { walkDistance } = await import('../js/ai/paths.js');

const { S } = L;
const teamA = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
const teamB = ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'];
const KADGAR  = 'Kadgar';                     // Greater Teleportation: a teleport react
const THORMAK = 'Thormak, The Titan Slayer';

const targetsOf = a => a.type === 'attack' ? [a.targetId] : a.targetIds ?? [];
const live = () => JSON.stringify(snapshot());

// Passes until a team-0 unit that is free to act has the turn
function toTeam0() {
  while (L.activeCombatant().teamIndex !== 0 || L.hasControlEffect(L.activeCombatant())) L.handlePass();
  return L.activeCombatant();
}

// A 5v5 played greedily into round 3, then handed to a team-0 unit
async function midFight(seed = 1) {
  await newFight({ teamA, teamB, seed });
  while (S.phase === 'combat' && S.roundNumber <= 3) {
    settleReacts(greedyReact);
    if (S.phase !== 'combat') break;
    if (!applyPlan(greedyTurn(L.activeCombatant())).accepted) L.handlePass();
  }
  settleReacts(greedyReact);
  assert.equal(S.phase, 'combat', 'fixture needs a fight still in progress');
  return toTeam0();
}

// Zhuqiao to play, with Sensei Lloyd (no react, so nothing can save him) at 1 HP standing next to her
async function finisher() {
  // Zhuqiao is the only Divine Beast here: a synced team walks faster and the lookahead no longer prefers the kill
  await newFight({ teamA: ['Zhuqiao, Vermillion Bird', 'Meï', 'Kaelgrym', 'Jhin', 'Kadgar'], teamB, seed: 4 });
  const c = toTeam0();
  const foe = S.combatants.find(f => f.name === 'Sensei Lloyd');
  assert.equal(L.getReacts(foe).length, 0, 'fixture needs an enemy without reacts');
  const cell = L.freeCellAdjacentTo(c, foe, foe.id);
  foe.x = cell.x; foe.y = cell.y;
  foe.currentHp = 1;
  return { c, foe };
}

test('resolveBudget clamps ms to MAX_MS and floors both kinds at 1', () => {
  assert.equal(MAX_MS, 8000);
  assert.equal(resolveBudget({ ms: 60000 }).ms, 8000);
  assert.equal(resolveBudget({ ms: 300 }).ms, 300);
  assert.equal(resolveBudget({ ms: 0 }).ms, 1);
  assert.deepEqual(resolveBudget({ sims: 2.7 }), { sims: 2 });
  assert.deepEqual(resolveBudget({ sims: 0 }), { sims: 1 });
});

test('an enemy at 1 HP within reach is finished off', async () => {
  const { foe } = await finisher();
  const { plan, sims } = search(0, { sims: 60 }, 1);
  assert.ok(sims >= 60);
  assert.ok(targetsOf(plan.action).includes(foe.id), `chose ${JSON.stringify(plan)}`);
  // Dice can miss: replay the plan on 20 real streams and expect the KO most of the time
  const snap = snapshot();
  let kos = 0;
  for (let s = 0; s < 20; s++) {
    restore(snap);
    setRandom(mulberry32(s));
    assert.equal(applyPlan(plan).accepted, true);
    settleReacts(greedyReact);
    if (foe.isKO) kos++;
  }
  assert.ok(kos >= 10, `KO in ${kos} of 20 replays`);
});

test('the same state, budget and seed give the identical plan', async () => {
  await midFight();
  const snap = snapshot();
  const first = search(0, { sims: 60 }, 7);
  restore(snap);
  const second = search(0, { sims: 60 }, 7);
  assert.deepEqual(second.plan, first.plan);
  assert.equal(second.sims, first.sims);
});

test('a search leaves the real random stream, the live state and the headless flag untouched', async () => {
  await midFight();
  const before = live();
  setRandom(mulberry32(5));
  L.setHeadless(false);   // as in a live page
  try {
    search(0, { sims: 40 }, 2);
    assert.equal(L.isHeadless(), false);
  } finally {
    L.setHeadless(true);
  }
  assert.equal(random(), mulberry32(5)());
  assert.equal(live(), before);
});

test('a simulation that throws still restores state, stream and headless flag', async () => {
  await midFight();
  const before = live();
  setRandom(mulberry32(5));
  L.setHeadless(false);
  // The move enters move mode (state changes) before reading the cell, which throws
  const plan = { move: { get x() { throw new Error('boom'); }, y: 0 }, action: { type: 'pass' } };
  try {
    assert.throws(() => simulate(plan, 0, 1), /boom/);
    assert.equal(L.isHeadless(), false);
  } finally {
    L.setHeadless(true);
  }
  assert.equal(random(), mulberry32(5)());
  assert.equal(live(), before);
});

test('simulate is deterministic for a seed and leaves the fight as it was', async () => {
  await midFight();
  const before = live();
  const [, plan] = enumeratePlans(L.activeCombatant());
  const a = simulate(plan, 0, 11);
  assert.equal(typeof a, 'number');
  assert.equal(simulate(plan, 0, 11), a);
  assert.equal(live(), before);
});

test('an ms budget is respected, on a clock the test controls', async () => {
  await midFight();
  // Every reading of the clock advances it 2 ms: the search sees simulations as slow and steady, so where it
  // stops depends on its deadline logic only, not on the machine's speed or load
  const real = performance.now;
  let now = 0;
  performance.now = () => (now += 2);
  let result;
  try {
    result = search(0, { ms: 300 }, 3);
  } finally {
    performance.now = real;
  }
  const { plan, sims, ms } = result;
  assert.ok(ms <= 300, `the search reports ${ms} ms`);
  assert.ok(sims >= 1);
  assert.ok(plan);
});

test('a single legal plan (a stunned unit) returns without simulating', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const c = toTeam0();
  c.statusEffects.push({ name: 'stun', turnsLeft: 1, dice: null, damType: null, notes: '' });
  const { plan, sims } = search(0, { sims: 60 }, 1);
  assert.deepEqual(plan, { move: null, action: { type: 'pass' } });
  assert.equal(sims, 0);
});

test('searching for a team whose unit is not active throws', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  toTeam0();
  assert.throws(() => search(1, { sims: 10 }, 1), /active/);
});

test('mid-fight: the chosen plan is an enumerated one and the engine accepts it', async () => {
  const c = await midFight(2);
  const plans = enumeratePlans(c).map(p => JSON.stringify(p));
  const { plan, sims } = search(0, { sims: 80 }, 4);
  assert.ok(plans.includes(JSON.stringify(plan)));
  assert.ok(sims >= Math.min(80, plans.length));
  assert.equal(applyPlan(plan).accepted, true);
});

test('simulateReact scores each react choice on a real pending react without changing the fight', async () => {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed: 1 });
  if (L.activeCombatant().name !== THORMAK) L.handlePass();
  const thormak = L.activeCombatant();
  const kadgar  = S.combatants.find(c => c.name === KADGAR);
  const cell = L.freeCellAdjacentTo(kadgar, thormak, thormak.id);
  thormak.x = cell.x; thormak.y = cell.y;
  applyPlan({ move: null, action: { type: 'attack', targetId: kadgar.id } });
  assert.equal(S.awaitingReact, true);
  const before = live();
  setRandom(mulberry32(9));
  const choices = enumerateReacts();
  assert.ok(choices.length >= 2);
  for (const choice of choices) {
    const score = simulateReact(choice, kadgar.teamIndex, 1);
    assert.equal(typeof score, 'number');
    assert.ok(Number.isFinite(score));
    assert.equal(simulateReact(choice, kadgar.teamIndex, 1), score);
  }
  assert.equal(S.awaitingReact, true);
  assert.equal(live(), before);
  assert.equal(random(), mulberry32(9)());
  settleReacts(() => null);
  assert.throws(() => simulateReact(null, kadgar.teamIndex, 1), /react/);
});

test('a sims budget that covers the first pass is spent exactly', async () => {
  const c = await midFight(2);
  const plans = enumeratePlans(c).length;
  assert.ok(plans > 1, 'fixture needs a choice');
  // One sample per plan in the first pass, then two per plan once the budget allows it
  for (const n of [plans, plans + 7, 2 * plans, 3 * plans + 1]) assert.equal(search(0, { sims: n }, 1).sims, n, `budget ${n}`);
});

test('the horizon covers about half the living units, never less than a 1v1 needs', () => {
  assert.equal(horizonFor(2), 3);
  assert.equal(horizonFor(4), 3);
  assert.equal(horizonFor(10), 6);
  assert.ok(horizonFor(40) <= 8);
});

test('a duel opening with the foe out of reach: the search closes in rather than holding', async () => {
  for (const seed of [1, 2, 3]) {
    await newFight({ teamA: ['Susano'], teamB: ['Alicia'], seed });
    const c = toTeam0();
    const foe = S.combatants.find(f => f.teamIndex !== 0);
    const { plan } = search(0, { sims: 60 }, seed);
    const end = plan.move ?? c;
    // Changing form is a turn well spent, not a hold
    assert.ok(plan.action.type === 'transform' || walkDistance(foe.x, foe.y, end.x, end.y) < walkDistance(foe.x, foe.y, c.x, c.y),
      `seed ${seed}: ${c.name} held with ${JSON.stringify(plan.action)}`);
  }
});
