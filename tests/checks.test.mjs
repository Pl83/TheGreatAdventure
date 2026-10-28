import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const { createChecker } = await import('../tools/checks.mjs');
const { playFight } = await import('../tools/fight.mjs');
const { greedyBrain } = await import('../js/ai/greedy.js');
const L = await import('../js/combat-logic.js');

const chars = JSON.parse(await readFile(new URL('../js/characters.json', import.meta.url), 'utf8'));
const { S } = L;

// A fresh 1v1 fight and a checker over it; `who` is the unit the tests poke at
async function setup(nameA = 'Susano', nameB = 'Alicia') {
  await newFight({ teamA: [nameA], teamB: [nameB], seed: 1 });
  const checker = createChecker(chars, 1);
  return { checker, a: S.combatants.find(c => c.name === nameA), b: S.combatants.find(c => c.name === nameB) };
}
const cast = ability => ({ move: null, action: { type: 'cast', ability, targetIds: [] } });
const ok = { accepted: true };
const kinds = vs => vs.map(v => v.kind);

test('a healthy state yields no violations', async () => {
  const { checker, a } = await setup();
  assert.deepEqual(checker.afterAction({ move: null, action: { type: 'pass' } }, ok, a.id, 1), []);
});

test('hp above max or below zero is hp-out-of-range and names the unit', async () => {
  const { checker, a, b } = await setup();
  a.currentHp = a.maxHp + 1;
  const vs = checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1);
  assert.deepEqual(kinds(vs), ['hp-out-of-range']);
  assert.match(vs[0].detail, new RegExp(a.name));
  b.currentHp = -3;
  assert.ok(kinds(checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1)).includes('hp-out-of-range'));
});

test('negative slots, ki or souls is resource-negative', async () => {
  for (const key of ['spellSlots', 'ki', 'souls']) {
    const { checker, a } = await setup();
    a[key] = -1;
    const vs = checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1);
    assert.deepEqual(kinds(vs), ['resource-negative'], key);
    assert.match(vs[0].detail, new RegExp(`${a.name}.*${key}|${key}.*${a.name}`));
  }
});

test('two living units on one cell is cell-conflict; a KO unit does not count', async () => {
  const { checker, a, b } = await setup();
  b.x = a.x; b.y = a.y;
  const vs = checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1);
  assert.deepEqual(kinds(vs), ['cell-conflict']);
  assert.match(vs[0].detail, new RegExp(a.name));
  assert.match(vs[0].detail, new RegExp(b.name));
  const fresh = await setup();
  fresh.b.x = fresh.a.x; fresh.b.y = fresh.a.y; fresh.b.isKO = true;
  assert.deepEqual(fresh.checker.afterAction({ action: { type: 'pass' } }, ok, fresh.a.id, 1), []);
});

test('a unit on an unwalkable cell is cell-unwalkable', async () => {
  const { checker, a } = await setup();
  a.x = -1; a.y = 0;
  const vs = checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1);
  assert.deepEqual(kinds(vs), ['cell-unwalkable']);
  assert.match(vs[0].detail, new RegExp(a.name));
  assert.match(vs[0].detail, /-1, 0/);
});

test('an accepted plan from a KO unit is ko-acted', async () => {
  const { checker, a } = await setup();
  a.isKO = true;
  checker.beforeAction(a.id);
  const vs = checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1);
  assert.ok(kinds(vs).includes('ko-acted'));
  assert.match(vs.find(v => v.kind === 'ko-acted').detail, new RegExp(a.name));
});

test('a unit that dies during its own accepted plan is not ko-acted', async () => {
  const { checker, a } = await setup();
  checker.beforeAction(a.id);
  a.isKO = true;
  assert.ok(!kinds(checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1)).includes('ko-acted'));
});

test('a rejected plan is rejected-plan with the reason', async () => {
  const { checker, a } = await setup();
  const vs = checker.afterAction({ action: { type: 'attack', targetId: -1 } }, { accepted: false, reason: 'nope' }, a.id, 1);
  assert.deepEqual(kinds(vs), ['rejected-plan']);
  assert.match(vs[0].detail, /Susano/);
  assert.match(vs[0].detail, /nope/);
  assert.equal(vs[0].seed, 1);
});

test('a second accepted cast of a cooldown-99 move is once-per-fight-reuse', async () => {
  const { checker, a } = await setup('Admiral Jaina', 'Alicia');
  const plan = cast('Dominion of the Seven Sea');
  assert.deepEqual(checker.afterAction(plan, ok, a.id, 1), []);
  const vs = checker.afterAction(plan, ok, a.id, 5);
  assert.deepEqual(kinds(vs), ['once-per-fight-reuse']);
  assert.match(vs[0].detail, /Admiral Jaina/);
  assert.match(vs[0].detail, /Dominion of the Seven Sea/);
});

test('a react cast enters the same ledger: a cooldown-99 move played twice as a react is once-per-fight-reuse', async () => {
  const { checker, a } = await setup('Admiral Jaina', 'Alicia');
  assert.deepEqual(checker.afterReact(a.id, 'Dominion of the Seven Sea', 1), []);
  assert.deepEqual(kinds(checker.afterReact(a.id, 'Dominion of the Seven Sea', 3)), ['once-per-fight-reuse']);
});

test('a react counts its cooldown in owner turns: Hellical Twice (cooldown 2) after owner turn 2 is free from turn 5', async () => {
  const { checker, a } = await setup('Mira', 'Alicia');
  assert.deepEqual(checker.afterReact(a.id, 'Hellical Twice', 2), []);
  assert.deepEqual(kinds(checker.afterReact(a.id, 'Hellical Twice', 4)), ['cooldown-ignored']);
  assert.deepEqual(checker.afterReact(a.id, 'Hellical Twice', 7), []);
});

test('turnOf: a unit whose turn this round is still to come has begun one turn fewer than the round', async () => {
  const { checker } = await setup('Mira', 'Alicia');
  L.handlePass();   // into round 1's second turn
  const [first, second] = S.initiativeOrder;
  assert.equal(S.roundNumber, 1);
  assert.equal(checker.turnOf(first), 1);
  assert.equal(checker.turnOf(second), 1);
  L.handlePass();   // round 2, first unit active: the second has begun only 1 turn
  assert.equal(S.roundNumber, 2);
  assert.equal(checker.turnOf(first), 2);
  assert.equal(checker.turnOf(second), 1);
});

test('react casts count toward charges like any cast', async () => {
  const { checker, a } = await setup('Thormak, The Titan Slayer', 'Alicia');
  for (let round = 1; round <= 3; round++) assert.deepEqual(checker.afterReact(a.id, "Apolo's Bow", round), []);
  assert.deepEqual(kinds(checker.afterReact(a.id, "Apolo's Bow", 4)), ['charges-exceeded']);
});

test('a rejected cast does not enter the ledger', async () => {
  const { checker, a } = await setup('Admiral Jaina', 'Alicia');
  const plan = cast('Dominion of the Seven Sea');
  checker.afterAction(plan, { accepted: false, reason: 'x' }, a.id, 1);
  assert.deepEqual(checker.afterAction(plan, ok, a.id, 2), []);
});

test('cooldown N locks the move for exactly N of its owner turns (Arrow Volley, cooldown 2)', async () => {
  const volley = cast('Arrow Volley');
  for (const [turns, expected] of [[[1, 2], 1], [[1, 3], 1], [[1, 4], 0], [[1, 4, 6], 1], [[1, 4, 7], 0]]) {
    const { checker, a } = await setup('Sylvanas', 'Alicia');
    const out = turns.flatMap(t => checker.afterAction(volley, ok, a.id, t));
    assert.equal(out.length, expected, JSON.stringify(turns));
    for (const v of out) {
      assert.equal(v.kind, 'cooldown-ignored');
      assert.match(v.detail, /Sylvanas/);
      assert.match(v.detail, /Arrow Volley/);
    }
  }
});

test('an active cooldown-waiving domain suppresses cooldown-ignored', async () => {
  const { checker, a } = await setup('Kaelgrym', 'Alicia');
  const m = a.sourceChar.moveSet.find(x => x.cooldown > 0 && x.cooldown < 99);
  assert.ok(m, 'Kaelgrym has a cooldown move');
  const plan = cast(m.base.nom);
  a.domainActive = true;
  checker.afterAction(plan, ok, a.id, 1);
  assert.deepEqual(checker.afterAction(plan, ok, a.id, 2), []);
  a.domainActive = false;
  assert.deepEqual(kinds(checker.afterAction(plan, ok, a.id, 3)), ['cooldown-ignored']);
});

test('a 3-charge move may be cast 3 times; the 4th is exactly one charges-exceeded', async () => {
  const { checker, a } = await setup('Thormak, The Titan Slayer', 'Alicia');
  const bow = cast("Apolo's Bow");
  for (const t of [1, 2, 3]) assert.deepEqual(checker.afterAction(bow, ok, a.id, t), []);
  const vs = checker.afterAction(bow, ok, a.id, 4);
  assert.deepEqual(kinds(vs), ['charges-exceeded']);
  assert.match(vs[0].detail, /Thormak/);
  assert.match(vs[0].detail, /Apolo's Bow/);
  assert.match(vs[0].detail, /3 charges/);
  assert.match(vs[0].detail, /use 4/);
});

test('a move without charges is unaffected by the charge check', async () => {
  const { checker, a } = await setup('Thormak, The Titan Slayer', 'Alicia');
  const m = a.sourceChar.moveSet.find(x => !x.charges && !x.cooldown && x.base?.nom);
  assert.ok(m);
  for (const t of [1, 2, 3, 4, 5]) assert.deepEqual(checker.afterAction(cast(m.base.nom), ok, a.id, t), []);
});

test('finish reports a fight that hit maxRounds without a winner as stalled', async () => {
  const { checker } = await setup();
  const vs = checker.finish({ winner: null, rounds: 40, maxRounds: 40 });
  assert.deepEqual(kinds(vs), ['stalled']);
  assert.deepEqual(checker.finish({ winner: 0, rounds: 12, maxRounds: 40 }), []);
});

test('the same standing breach is reported once', async () => {
  const { checker, a } = await setup();
  a.currentHp = a.maxHp + 1;
  assert.equal(checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1).length, 1);
  assert.deepEqual(checker.afterAction({ action: { type: 'pass' } }, ok, a.id, 1), []);
});

test('the checker leaves engine state and the random stream alone', async () => {
  const { checker, a } = await setup('Admiral Jaina', 'Alicia');
  const { setRandom, random, mulberry32 } = await import('../js/rng.js');
  setRandom(mulberry32(7));
  const snap = JSON.stringify(S.combatants);
  checker.afterAction(cast('Dominion of the Seven Sea'), ok, a.id, 1);
  checker.afterAction({ action: { type: 'pass' } }, { accepted: false, reason: 'x' }, a.id, 2);
  checker.finish({ winner: null, rounds: 3, maxRounds: 3 });
  assert.equal(JSON.stringify(S.combatants), snap);
  assert.equal(random(), mulberry32(7)());
});

test('a clean 3-round greedy fight reports no violations', async () => {
  const teamA = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
  const teamB = ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'];
  const r = await playFight({ teamA, teamB, seed: 1, brains: [greedyBrain, greedyBrain], maxRounds: 3 });
  assert.deepEqual(r.violations.filter(v => v.kind !== 'stalled'), []);
});

test('an exception inside the loop becomes an exception violation and ends the fight', async () => {
  const boom = { chooseTurn: () => { throw new Error('kaboom'); }, chooseReact: () => null };
  const r = await playFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 9, brains: [boom, boom] });
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].kind, 'exception');
  assert.match(r.violations[0].detail, /kaboom/);
  assert.equal(r.violations[0].seed, 9);
  assert.ok(r.violations[0].round >= 1);
});

test('a non-exception violation does not abort the fight', async () => {
  const bad = { chooseTurn: () => ({ move: null, action: { type: 'attack', targetId: -1 } }), chooseReact: () => null };
  const r = await playFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 1, brains: [bad, bad], maxRounds: 3 });
  assert.equal(r.rounds, 3);
  assert.ok(r.violations.some(v => v.kind === 'rejected-plan'));
  assert.ok(r.violations.some(v => v.kind === 'stalled'));
});
