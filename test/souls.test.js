import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDamage, combatantUsesSouls, setRng } from '../js/combat-logic.js';
import { resetState, makeChar } from './helpers.js';

test('combatantUsesSouls: detects soul pool or soul-cost ability', () => {
  const [plain] = resetState();
  assert.equal(combatantUsesSouls(plain), false);
  const [souler] = resetState(makeChar({ souls: 100 }));
  assert.equal(combatantUsesSouls(souler), true);
});

test('soul-wielder absorbs a slain foe\'s soul (bug #3 implemented)', () => {
  setRng(() => 0);
  const [a, b] = resetState(makeChar({ nom: 'White', souls: 100 }), makeChar({ nom: 'Foe', hp: 40 }));
  applyDamage(b, 999, 'physical', ['physical'], false, a);   // a kills b
  assert.equal(b.isKO, true);
  assert.equal(a.souls, 100 + 40);   // gains victim's maxHp in souls
});

test('non-soul attacker gains nothing', () => {
  const [a, b] = resetState(makeChar({ nom: 'Plain' }), makeChar({ nom: 'Foe', hp: 40 }));
  applyDamage(b, 999, 'physical', ['physical'], false, a);
  assert.equal(a.souls, 0);
});
