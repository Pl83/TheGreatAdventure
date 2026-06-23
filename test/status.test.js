import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStatus, tickTurn, decayStatuses, hasControlEffect, setRng } from '../js/combat-logic.js';
import { resetState, makeChar, seqRng, frac } from './helpers.js';

test('applyStatus: applies a named effect (current default duration = 2)', () => {
  const [a] = resetState();
  applyStatus(a, 'burn');
  const burn = a.statusEffects.find(e => e.name.toLowerCase() === 'burn');
  assert.ok(burn);
  assert.equal(burn.turnsLeft, 2);   // BUG #1 baseline: duration field ignored
});

test('applyStatus: status immunity blocks all', () => {
  const [a] = resetState(makeChar({ immunities: ['status'] }));
  applyStatus(a, 'burn');
  assert.equal(a.statusEffects.length, 0);
});

test('applyStatus: per-effect immunity blocks just that one', () => {
  const [a] = resetState(makeChar({ immunities: ['burn'] }));
  applyStatus(a, 'burn, bleed');
  assert.equal(a.statusEffects.some(e => e.name.toLowerCase() === 'burn'), false);
  assert.equal(a.statusEffects.some(e => e.name.toLowerCase() === 'bleed'), true);
});

test('tickTurn applies DoT; decayStatuses counts down separately', () => {
  const [a] = resetState();
  applyStatus(a, 'burn');           // burn dice 1d4
  setRng(seqRng([frac(4, 4)]));     // burn rolls 4
  tickTurn(a);                      // DoT only, no decrement
  assert.equal(a.currentHp, 46);
  const burn = a.statusEffects.find(e => e.name.toLowerCase() === 'burn');
  assert.equal(burn.turnsLeft, 2);
  decayStatuses(a);
  assert.equal(burn.turnsLeft, 1);
});

test('decayStatuses: effect expires at 0 turns', () => {
  const [a] = resetState();
  applyStatus(a, 'burn');
  decayStatuses(a); // 2 -> 1
  decayStatuses(a); // 1 -> 0, removed
  assert.equal(a.statusEffects.some(e => e.name.toLowerCase() === 'burn'), false);
});

test('control gating: a 1-turn control still gates one turn (bug #6 fixed)', () => {
  const [a] = resetState();
  applyStatus(a, 'stun', 1);          // 1-turn stun
  assert.ok(hasControlEffect(a), 'stun present and gating');
  decayStatuses(a);                   // gated this turn, now expires
  assert.equal(hasControlEffect(a), null, 'stun gone after its one turn');
});

test('tickTurn: cooldowns decrement; ki regenerates', () => {
  const [a] = resetState(makeChar({ ki: 10, kiRegen: 3 }));
  a.ki = 4;
  a.cooldowns = { Foo: 2 };
  tickTurn(a);
  assert.equal(a.cooldowns.Foo, 1);
  assert.equal(a.ki, 7);
});

test('tickTurn: gel now deals its 1d2 DoT (bug #4 fixed)', () => {
  const [a] = resetState();
  applyStatus(a, 'gel');            // EFFECTS gel has dice 1d2
  setRng(() => 0.999);              // 1d2 → 2
  tickTurn(a);
  assert.equal(a.currentHp, 48);
});
