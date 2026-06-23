import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, handleAttack, setRng, activeCombatant } from '../js/combat-logic.js';
import { resetState, makeChar, seqRng, frac } from './helpers.js';

test('handleAttack: a hit deals damage and passes the turn', () => {
  const [a, b] = resetState();
  S.currentMap = null;            // no range checks
  // atk 15, def 5, dmg 1d6+2 die=4 → 6 damage; then advanceTurn → b's turn
  setRng(seqRng([frac(15, 20), frac(5, 20), frac(4, 6)]));
  handleAttack(a.id, b.id);
  assert.equal(b.currentHp, 44);
  assert.equal(S.hasActed, false);          // reset for the new turn
  assert.equal(activeCombatant().id, b.id); // turn advanced to defender
});

test('scripted fight: repeated attacks eventually KO a side', () => {
  const [a, b] = resetState(makeChar({ hp: 12 }), makeChar({ nom: 'Foe', hp: 12 }));
  S.currentMap = null;
  setRng(seqRng([frac(18, 20), frac(2, 20), frac(6, 6)])); // always hit for 8
  let guard = 0;
  while (S.phase !== 'victory' && guard++ < 20) {
    const act = activeCombatant();
    const foe = S.combatants.find(c => c.teamIndex !== act.teamIndex && !c.isKO);
    if (!foe) break;
    handleAttack(act.id, foe.id);
  }
  // Exactly one side should be wiped out.
  const t0 = S.combatants.filter(c => c.teamIndex === 0 && !c.isKO).length;
  const t1 = S.combatants.filter(c => c.teamIndex === 1 && !c.isKO).length;
  assert.ok((t0 === 0) !== (t1 === 0), 'exactly one team eliminated');
});
