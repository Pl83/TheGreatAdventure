import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, resumePendingAction, buildCombatant, setRng } from '../js/combat-logic.js';
import { makeChar } from './helpers.js';

// Bug #5: a reactor who teleports/reflects away inside an AoE should NOT take
// the splash damage, while everyone else still does.
test('AoE: teleporting reactor is spared, others still hit', () => {
  setRng(() => 0.5);
  const caster = buildCombatant(makeChar({ nom: 'Caster' }), 0, 0);
  const e1     = buildCombatant(makeChar({ nom: 'Blinker' }), 1, 1);
  const e2     = buildCombatant(makeChar({ nom: 'Bystander' }), 1, 2);
  S.combatants = [caster, e1, e2];
  S.initiativeOrder = [0, 1, 2];
  S.currentTurnIndex = 0;
  S.activeDomains = [];
  S.log = [];
  S.currentMap = null;
  S.awaitingReact = false;
  S.phase = 'combat';

  const aoeAbility = {
    name: 'Nova', source: 'spell', dice: '10', tags: ['fire'],
    target: 'aoe', targetKind: 'enemy', isAoe: true, radius: 2,
    effect: null, effectTurns: 2, maxBounce: 0,
  };
  const teleReact = {
    name: 'Blink', source: 'spell', tags: ['teleportation', 'react'],
    isReact: true, isBlock: false, cost: null, cooldownTurns: 0,
    isOncePerFight: false, maxCharges: 0,
  };
  // e2 has no reactions, so the AoE proceeds to damage after e1 reacts.
  e1.abilities = [teleReact];
  e2.abilities = [];

  S.pendingAction = {
    type: 'aoe', casterId: caster.id, abilityName: 'Nova',
    targetIds: [e1.id, e2.id], ability: aoeAbility,
    reactorId: e1.id, reactedIds: [e1.id], blockedIds: [],
  };

  resumePendingAction(teleReact);

  assert.equal(e1.currentHp, e1.maxHp, 'blinker took no damage');
  assert.equal(e2.currentHp, e2.maxHp - 10, 'bystander took the AoE');
});
