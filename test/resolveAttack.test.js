import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, setRng } from '../js/combat-logic.js';
import { resetState, makeChar, seqRng, frac } from './helpers.js';

test('resolveAttack: normal hit (atk > def)', () => {
  const [atk, def] = resetState();
  // atk d20 = 15, def d20 = 5, damage 1d6+2 → die=4
  setRng(seqRng([frac(15, 20), frac(5, 20), frac(4, 6)]));
  const r = resolveAttack(atk, def, '1d6+2');
  assert.equal(r.hit, true);
  assert.equal(r.crit, false);
  assert.equal(r.fumble, false);
  assert.equal(r.damage, 4 + 2);
});

test('resolveAttack: miss (atk < def)', () => {
  const [atk, def] = resetState();
  setRng(seqRng([frac(5, 20), frac(15, 20)]));
  const r = resolveAttack(atk, def, '1d6+2');
  assert.equal(r.hit, false);
  assert.equal(r.damage, 0);
});

test('resolveAttack: nat 20 crit doubles damage', () => {
  const [atk, def] = resetState();
  // atk = 20 (crit), def = 19, damage 1d6+2 die=4 → (4+2)*2
  setRng(seqRng([frac(20, 20), frac(19, 20), frac(4, 6)]));
  const r = resolveAttack(atk, def, '1d6+2');
  assert.equal(r.crit, true);
  assert.equal(r.hit, true);
  assert.equal(r.damage, (4 + 2) * 2);
});

test('resolveAttack: nat 1 always fumbles even vs low def', () => {
  const [atk, def] = resetState();
  setRng(seqRng([frac(1, 20), frac(1, 20)]));
  const r = resolveAttack(atk, def, '1d6+2');
  assert.equal(r.fumble, true);
  assert.equal(r.hit, false);
  assert.equal(r.damage, 0);
});

test('resolveAttack: equal roll hits (atk >= def)', () => {
  const [atk, def] = resetState();
  setRng(seqRng([frac(10, 20), frac(10, 20), frac(1, 6)]));
  const r = resolveAttack(atk, def, '1d6+2');
  assert.equal(r.hit, true);
});
