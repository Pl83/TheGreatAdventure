import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

async function duel() {
  await newFight({ teamA: ['Ras'], teamB: ['Kay Climber'], seed: 1 });
  return { ras: S.combatants[0], kay: S.combatants[1] };
}

test('a unit that can react normally has a react to offer', async () => {
  const { kay } = await duel();
  assert.ok(L.getReacts(kay).length > 0);
});

for (const status of ['gel', 'stun', 'cocoon', 'fear']) {
  test(`a unit under ${status} cannot react`, async () => {
    const { kay } = await duel();
    L.applyStatus(kay, status);
    assert.ok(kay.statusEffects.some(e => e.name.toLowerCase() === status));
    assert.deepEqual(L.getReacts(kay), []);
  });
}

test('a paralysed unit that was not stunned can still react', async () => {
  const { kay } = await duel();
  L.applyStatus(kay, 'para');
  assert.ok(L.getReacts(kay).length > 0);
});

test('an attack gives a unit its react prompt, unless it is stunned', async () => {
  for (const stunned of [false, true]) {
    const { ras, kay } = await duel();
    if (stunned) L.applyStatus(kay, 'stun');
    while (L.activeCombatant() !== ras) L.handlePass();
    kay.x = ras.x + 1; kay.y = ras.y;
    L.handleAttack(ras.id, kay.id);
    assert.equal(S.awaitingReact, !stunned, stunned ? 'no prompt for a stunned unit' : 'a prompt for a free one');
  }
});
