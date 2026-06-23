import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDice, setRng } from '../js/combat-logic.js';
import { mulberry32 } from './helpers.js';

test('parseDice: empty / dash → 0', () => {
  assert.equal(parseDice('').total, 0);
  assert.equal(parseDice('—').total, 0);
  assert.equal(parseDice('-').total, 0);
  assert.equal(parseDice(null).total, 0);
});

test('parseDice: flat bonus only', () => {
  setRng(() => 0);
  assert.equal(parseDice('+5').total, 5);
  assert.equal(parseDice('7').total, 7);
});

test('parseDice: dice min/max via rng', () => {
  setRng(() => 0);            // every die → 1
  assert.equal(parseDice('2d6+3').total, 2 + 3);
  setRng(() => 0.999);       // every die → max
  assert.equal(parseDice('2d6+3').total, 12 + 3);
});

test('parseDice: multiple dice groups sum', () => {
  setRng(() => 0.999);
  assert.equal(parseDice('1d20+1d6+6').total, 20 + 6 + 6);
});

test('parseDice: multiplier expansion NdM*K and K*NdM', () => {
  setRng(() => 0.999);
  assert.equal(parseDice('2d6*2').total, 24);   // → 4d6 max
  assert.equal(parseDice('2*1d6').total, 12);   // → 2d6 max
});

test('parseDice: negative dice subtract', () => {
  setRng(() => 0.999);
  // -1d6 (max 6) + 2  → -6 + 2 = -4
  assert.equal(parseDice('-1d6+2').total, -4);
});

test('parseDice: deterministic with seed', () => {
  setRng(mulberry32(42));
  const a = parseDice('3d8+4').total;
  setRng(mulberry32(42));
  const b = parseDice('3d8+4').total;
  assert.equal(a, b);
});
