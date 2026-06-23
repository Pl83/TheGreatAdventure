import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, applyStatus, effectiveAuthority, buildCombatant, setRng } from '../js/combat-logic.js';
import { resetState, makeChar } from './helpers.js';

test('control resistance: higher-authority defender shrugs off control', () => {
  setRng(() => 0);
  const def = makeChar({ nom: 'God', autority: 8 });
  const atk = makeChar({ nom: 'Mortal', autority: 0 });
  const [d, a] = resetState(def, atk);
  applyStatus(d, 'stun', 2, a);     // attacker has lower authority → resisted
  assert.equal(d.statusEffects.some(e => e.name.toLowerCase() === 'stun'), false);
});

test('control lands when authority is equal or lower', () => {
  setRng(() => 0);
  const def = makeChar({ nom: 'A', autority: 3 });
  const atk = makeChar({ nom: 'B', autority: 3 });
  const [d, a] = resetState(def, atk);
  applyStatus(d, 'stun', 2, a);     // equal authority → not resisted
  assert.equal(d.statusEffects.some(e => e.name.toLowerCase() === 'stun'), true);
});

test('non-control status ignores authority (burn still lands)', () => {
  setRng(() => 0);
  const [d, a] = resetState(makeChar({ autority: 8 }), makeChar({ autority: 0 }));
  applyStatus(d, 'burn', 2, a);
  assert.equal(d.statusEffects.some(e => e.name.toLowerCase() === 'burn'), true);
});

test('effectiveAuthority drops under an active enemy authority domain', () => {
  const [a, b] = resetState(makeChar({ nom: 'Foe', autority: 2 }), makeChar({ nom: 'Hela', autority: 8 }));
  // b's domain reduces foe authority by 1
  S.activeDomains = [{
    casterId: b.id,
    domain: {
      name: 'Grave', type: 'Complet', rafinement: 7,
      effects: [{ nom: 'Auth Down', dices: '-1', tags: ['debuff'], applyOn: ['autority'], target: 'foes' }],
    },
  }];
  assert.equal(effectiveAuthority(a), 2 - 1);   // foe debuffed
  assert.equal(effectiveAuthority(b), 8);        // owner unaffected
});
