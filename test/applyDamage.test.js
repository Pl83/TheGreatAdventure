import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDamage, applyHeal, checkVictory, setRng } from '../js/combat-logic.js';
import { resetState, makeChar, seqRng, frac } from './helpers.js';

test('applyDamage: plain damage reduces hp', () => {
  const [a] = resetState();
  applyDamage(a, 10);
  assert.equal(a.currentHp, 40);
});

test('applyDamage: hp floors at 0 and sets KO', () => {
  const [a] = resetState();
  applyDamage(a, 999);
  assert.equal(a.currentHp, 0);
  assert.equal(a.isKO, true);
});

test('applyDamage: immunity by tag negates damage', () => {
  const [a] = resetState(makeChar({ immunities: ['fire'] }));
  applyDamage(a, 30, 'fire', ['fire']);
  assert.equal(a.currentHp, 50);
});

test('applyDamage: damage_shield absorbs then breaks', () => {
  const [a] = resetState();
  a.statusEffects.push({ name: 'damage_shield', turnsLeft: 999, shieldHp: 8, source: 'spell' });
  applyDamage(a, 20, 'fire', ['fire']);
  // 8 absorbed, 12 through
  assert.equal(a.currentHp, 38);
  assert.equal(a.statusEffects.find(e => e.name === 'damage_shield'), undefined);
});

test('applyDamage: DR passive "-1d6+2" reduces by 1d6+2 (bug #7 fixed)', () => {
  const passif = [{ nom: 'Iron Pelt', dices: '-1d6+2', applyOn: ['incomingDam'],
                    condition: { incomingHasTag: 'physical' } }];
  const [a] = resetState(makeChar({ passif }));
  setRng(seqRng([frac(6, 6)]));   // 1d6 → 6, reduction = 8
  applyDamage(a, 20, 'physical', ['physical']);
  assert.equal(a.currentHp, 50 - (20 - 8));   // 38
});

test('applyDamage: flat DR "-15" reduces by 15', () => {
  const passif = [{ nom: 'Pelt', dices: '-15', applyOn: ['incomingDam'],
                    condition: { incomingHasTag: 'physical' } }];
  const [a] = resetState(makeChar({ passif }));
  applyDamage(a, 20, 'physical', ['physical']);
  assert.equal(a.currentHp, 50 - 5);
});

test('applyHeal: clamps to maxHp and never overheals', () => {
  const [a] = resetState();
  a.currentHp = 45;
  setRng(seqRng([frac(6, 6)]));
  applyHeal(a, '1d6');   // +6 but only 5 missing
  assert.equal(a.currentHp, 50);
});

test('checkVictory: returns the winning team (opponent of the wiped side)', () => {
  const [a, b] = resetState();
  assert.equal(checkVictory(), null);
  b.isKO = true;                  // team 1 wiped out → team 0 wins
  assert.equal(checkVictory(), 0);
  b.isKO = false; a.isKO = true;  // team 0 wiped out → team 1 wins
  assert.equal(checkVictory(), 1);
});
