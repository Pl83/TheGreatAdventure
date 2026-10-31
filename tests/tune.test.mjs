import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../js/rng.js';
import { WEIGHTS, TUNABLE, withWeights, evaluate } from '../js/ai/evaluate.js';
import {
  direction, shifted, update, toWeights, toTheta, randomMatchups, matchJobs, scoreFirst, matchResult, wilson,
  applyWeights, LOG_BOUND, learningRate,
} from '../tools/tune-lib.mjs';

const keys = TUNABLE;
const start = toTheta(Object.fromEntries(keys.map(k => [k, WEIGHTS[k]])));
const names = Array.from({ length: 30 }, (_, i) => `Unit ${i}`);

test('every tuned weight is a positive number and win is not tuned', () => {
  assert.ok(!keys.includes('win'));
  assert.equal(keys.length, 8);
  for (const k of keys) assert.ok(WEIGHTS[k] > 0, k);
});

test('a direction gives every weight +1 or -1, and the same rng gives the same direction', () => {
  const d = direction(keys, mulberry32(5));
  assert.deepEqual(Object.keys(d), keys);
  for (const v of Object.values(d)) assert.ok(v === 1 || v === -1);
  assert.deepEqual(direction(keys, mulberry32(5)), d);
});

test('log weights round-trip, and a shift moves each weight by the same factor in its own direction', () => {
  const w = toWeights(toTheta({ hp: 3, damage: 0.005 }));
  assert.ok(Math.abs(w.hp - 3) < 1e-9 && Math.abs(w.damage - 0.005) < 1e-12);
  const up = shifted({ hp: Math.log(3), damage: Math.log(0.005) }, { hp: 1, damage: -1 }, 0.1, { hp: Math.log(3), damage: Math.log(0.005) });
  assert.ok(Math.abs(Math.exp(up.hp) / 3 - Math.exp(0.1)) < 1e-9);
  assert.ok(Math.abs(Math.exp(up.damage) / 0.005 - Math.exp(-0.1)) < 1e-9);
});

test('weights never leave a factor of 10 around their start, however long the push', () => {
  let theta = { ...start };
  const dir = Object.fromEntries(keys.map(k => [k, 1]));
  for (let i = 0; i < 1000; i++) theta = update(theta, dir, 1, 0, start);
  for (const k of keys) assert.ok(Math.abs(theta[k] - start[k] - LOG_BOUND) < 1e-9, k);
  for (let i = 0; i < 4000; i++) theta = update(theta, dir, -1, 0, start);
  for (const k of keys) assert.ok(Math.abs(theta[k] - start[k] + LOG_BOUND) < 1e-9, k);
});

test('a won match moves toward the + set, a lost one away from it, a draw not at all; the rate shrinks', () => {
  const dir = Object.fromEntries(keys.map((k, i) => [k, i % 2 ? 1 : -1]));
  const won = update(start, dir, 1, 0, start), lost = update(start, dir, -1, 0, start), drawn = update(start, dir, 0, 0, start);
  for (const k of keys) {
    assert.ok((won[k] - start[k]) * dir[k] > 0);
    assert.ok((lost[k] - start[k]) * dir[k] < 0);
    assert.equal(drawn[k], start[k]);
  }
  assert.ok(learningRate(1000) < learningRate(0));
});

test('matchups have the asked sizes, no repeated unit, and replay from the seed', () => {
  const m = randomMatchups(names, 6, 42);
  assert.deepEqual(m.map(x => x.a.length), [1, 2, 3, 1, 2, 3]);
  for (const x of m) {
    assert.equal(new Set([...x.a, ...x.b]).size, x.a.length + x.b.length);
    assert.equal(x.a.length, x.b.length);
  }
  assert.deepEqual(randomMatchups(names, 6, 42), m);
  assert.notDeepEqual(randomMatchups(names, 6, 43), m);
});

test('every matchup is played in both seatings with the two weight sets exchanging seats', () => {
  const m = randomMatchups(names, 2, 1);
  const A = { hp: 1 }, B = { hp: 2 };
  const jobs = matchJobs(m, A, B, { seedBase: 100, maps: ['m1', 'm2', 'm3'], sims: 50 });
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs[0].weights, [A, B]);
  assert.deepEqual(jobs[1].weights, [B, A]);
  assert.deepEqual(jobs[1].teamA, jobs[0].teamB);
  assert.equal(jobs[0].seed, jobs[1].seed);
  assert.equal(jobs[0].map, jobs[1].map);
  assert.deepEqual(jobs[0].kinds, ['ai', 'ai']);
  assert.notEqual(jobs[0].seed, jobs[2].seed);
});

test('the first set scores a win in whichever seat it held, and half a point for a stall', () => {
  // job 0: first in seat 0; job 1: first in seat 1; job 2: seat 0; job 3: seat 1
  const results = [{ winner: 0 }, { winner: 1 }, { winner: 1 }, { winner: null, stalled: true }];
  const s = scoreFirst(results);
  assert.equal(s.points, 2.5);
  assert.equal(s.games, 4);
  assert.equal(matchResult({ points: 4, games: 4 }), 1);
  assert.equal(matchResult({ points: 0, games: 4 }), -1);
  assert.equal(matchResult({ points: 2, games: 4 }), 0);
});

test('the Wilson interval brackets the rate and tightens with more fights', () => {
  const small = wilson(6.5, 8), large = wilson(65, 80);
  assert.ok(small.low < 6.5 / 8 && small.high > 6.5 / 8);
  assert.ok(large.high - large.low < small.high - small.low);
  assert.ok(wilson(5, 10).low < 0.5 && wilson(5, 10).high > 0.5);
  assert.ok(wilson(60, 80).low > 0.5);
});

test('applyWeights rewrites the numbers in the WEIGHTS block of evaluate.js and leaves the rest alone', () => {
  const source = readFileSync(new URL('../js/ai/evaluate.js', import.meta.url), 'utf8');
  const tuned = Object.fromEntries(keys.map(k => [k, WEIGHTS[k] * 1.234567]));
  const out = applyWeights(source, tuned);
  assert.notEqual(out, source);
  for (const k of keys) assert.match(out, new RegExp(`^\\s+${k}:\\s*${Number((WEIGHTS[k] * 1.234567).toPrecision(3))},`, 'm'));
  assert.match(out, /win:\s*30,/, 'win is untouched');
  assert.equal(out.split('\n').length, source.split('\n').length, 'no line gained or lost');
  assert.equal(applyWeights(out, Object.fromEntries(keys.map(k => [k, WEIGHTS[k]]))).replace(/ +\/\//g, ' //'),
    source.replace(/ +\/\//g, ' //'), 'writing the originals back restores the source (comment spacing aside)');
  assert.throws(() => applyWeights(source, { nope: 1 }), /not found/);
});

test('a brain judging with its own weights scores a position differently, and the shipped ones come back after', async () => {
  const { installShims, newFight } = await import('../tools/headless.mjs');
  installShims();
  await newFight({ teamA: ['Jhin'], teamB: ['Kaelgrym'], seed: 1 });
  const L = await import('../js/combat-logic.js');
  L.S.combatants[0].currentHp = 10;
  const shipped = evaluate(0);
  const picky = withWeights({ ...WEIGHTS, hp: WEIGHTS.hp * 5 }, () => evaluate(0));
  assert.notEqual(picky, shipped);
  assert.equal(evaluate(0), shipped, 'the shipped weights are back once the call returns');
  assert.throws(() => withWeights({ ...WEIGHTS }, () => { throw new Error('x'); }), /x/);
  assert.equal(evaluate(0), shipped, 'and also after a throw');
});
