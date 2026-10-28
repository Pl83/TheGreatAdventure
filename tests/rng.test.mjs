import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document ??= {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null }),
};
const { random, setRandom, withRandom, mulberry32 } = await import('../js/rng.js');
const { rollDie } = await import('../js/combat-logic.js');

const seq = f => Array.from({ length: 5 }, () => f());

test('mulberry32 is deterministic per seed', () => {
  assert.deepEqual(seq(mulberry32(1)), seq(mulberry32(1)));
  assert.notDeepEqual(seq(mulberry32(1)), seq(mulberry32(2)));
});

test('rollDie draws from the injected source', () => {
  setRandom(() => 0.999);
  assert.equal(rollDie(20), 20);
  setRandom(() => 0);
  assert.equal(rollDie(20), 1);
  setRandom(Math.random);
});

test('withRandom restores the previous source after a throw', () => {
  setRandom(() => 0.5);
  assert.throws(() => withRandom(() => 0, () => { throw new Error('boom'); }), /boom/);
  assert.equal(random(), 0.5);
  assert.equal(withRandom(() => 0.25, () => random()), 0.25);
  assert.equal(random(), 0.5);
  setRandom(Math.random);
});
