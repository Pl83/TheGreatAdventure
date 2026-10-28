import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installShims } from '../tools/headless.mjs';

installShims();
const { playFight } = await import('../tools/fight.mjs');
const { makeViolation } = await import('../tools/violations.mjs');
const { greedyBrain } = await import('../js/ai/greedy.js');

const teamA = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
const teamB = ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'];
const brains = [greedyBrain, greedyBrain];
const SIM = fileURLToPath(new URL('../tools/sim.mjs', import.meta.url));
const sim = (...args) => spawnSync(process.execPath, [SIM, ...args], { encoding: 'utf8' });

test('makeViolation builds the record', () => {
  assert.deepEqual(makeViolation('rejected-plan', 'x', 4, 2), { kind: 'rejected-plan', detail: 'x', seed: 4, round: 2 });
});

test('the spec matchup ends with a winner or stalled, within 40 rounds', async () => {
  const r = await playFight({ teamA, teamB, seed: 1, brains });
  assert.ok(r.winner === 0 || r.winner === 1 || r.stalled);
  assert.equal(r.stalled, r.winner === null);
  assert.ok(r.rounds >= 1 && r.rounds <= 40);
  assert.equal(r.seed, 1);
  assert.equal(r.firstKo, r.kos[0] ?? null);
  assert.deepEqual(r.violations, []);
  assert.ok(Object.keys(r.moveUses).length > 0);
  for (const k of Object.keys(r.moveUses)) assert.match(k, / \/ /);
});

test('the same seed gives the same result, apart from timing', async () => {
  const strip = ({ maxDecisionMs, ...rest }) => rest;
  const a = await playFight({ teamA, teamB, seed: 5, brains });
  const b = await playFight({ teamA, teamB, seed: 5, brains });
  assert.deepEqual(strip(a), strip(b));
  assert.ok(a.maxDecisionMs >= 0);
});

test('a 1v1 and a 5v1 fight complete', async () => {
  const duel = await playFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 2, brains });
  assert.ok(duel.winner !== null || duel.stalled);
  const rout = await playFight({ teamA, teamB: ['Alicia'], seed: 2, brains });
  assert.ok(rout.winner !== null || rout.stalled);
});

test('maxRounds stops a fight and marks it stalled', async () => {
  const r = await playFight({ teamA, teamB, seed: 1, brains, maxRounds: 1 });
  assert.equal(r.stalled, true);
  assert.equal(r.winner, null);
  assert.equal(r.rounds, 1);
});

test('an unknown character name throws the close-names error', async () => {
  await assert.rejects(playFight({ teamA: ['Zhuqiao, Vermillon Bird'], teamB, seed: 1, brains }), /Zhuqiao, Vermillion Bird/);
});

test('a brain that keeps returning bad plans yields rejected-plan violations and the fight still ends', async () => {
  const bad = { chooseTurn: () => ({ move: null, action: { type: 'attack', targetId: -1 } }), chooseReact: () => null };
  const r = await playFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 1, brains: [bad, bad], maxRounds: 3 });
  assert.ok(r.violations.length > 0);
  assert.equal(r.violations[0].kind, 'rejected-plan');
  assert.equal(r.violations[0].seed, 1);
  assert.equal(r.stalled, true);
});

test('sim.mjs prints the report and exits 0', () => {
  const r = sim(teamA.join('; '), teamB.join('; '), '--fights', '2');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Team I/);
  assert.match(r.stdout, /first KO/);
});

test('sim.mjs --swap plays each seed twice', () => {
  const r = sim('Susano', 'Alicia', '--fights', '2', '--swap');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /4 fights/);
});

test('sim.mjs exits 1 on a mistyped name and on bad arguments', () => {
  const typo = sim('Zhuqiao, Vermillon Bird', 'Alicia', '--fights', '1');
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Zhuqiao, Vermillion Bird/);
  assert.equal(sim('Susano').status, 1);
  assert.equal(sim('Susano', 'Alicia', '--fights', 'x').status, 1);
});
