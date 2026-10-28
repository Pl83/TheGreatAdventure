import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.document ??= {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null }),
};
const L = await import('../js/combat-logic.js');
const chars = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const char = name => chars.find(c => c.nom === name);

function arena(...combatants) {
  Object.assign(L.S, {
    combatants, initiativeOrder: combatants.map(c => c.id), currentTurnIndex: 0, phase: 'combat',
    currentMap: null, log: [], activeDomains: [], pendingAction: null, awaitingReact: false, reactOptions: [], hasActed: false,
  });
}

test('the five new sheets load with their moves resolved', () => {
  for (const name of ['Ronin Lloyd', 'Mira', 'Nate', 'Jhin', 'Future Zane']) {
    const c = L.buildCombatant(char(name), 0, 0);
    assert.ok(c.abilities.length >= 4, name);
    assert.ok(c.abilities.some(a => a.name === 'Spinzutsu'), name);
  }
});

test('Nate is immune to status effects', () => {
  const nate = L.buildCombatant(char('Nate'), 0, 0);
  arena(nate);
  L.applyStatus(nate, 'stun');
  assert.equal(nate.statusEffects.length, 0);
});

test('Self Destruct hits everyone around for HP × d10 and knocks Zane out', () => {
  const zane = L.buildCombatant(char('Future Zane'), 0, 0);
  const foe  = L.buildCombatant(char('Mira'), 1, 1);
  arena(zane, foe);
  zane.currentHp = 3;
  L.handleCastAbility(zane.id, 'Self Destruct', [zane.id]);
  assert.equal(zane.isKO, true);
  assert.ok(foe.currentHp < foe.maxHp);
});

test('Ice Shell refreshes a 10 HP shield each turn without stacking', () => {
  const zane = L.buildCombatant(char('Future Zane'), 0, 0);
  const foe  = L.buildCombatant(char('Mira'), 1, 1);
  arena(zane, foe);
  L.beginTurn(zane);
  L.beginTurn(zane);
  const shields = zane.statusEffects.filter(e => e.name === 'damage_shield');
  assert.equal(shields.length, 1);
  assert.equal(shields[0].shieldHp, 10);
});
