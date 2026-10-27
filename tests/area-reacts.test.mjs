import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// combat-logic.js on main touches the DOM while resolving moves; a bare stub is enough here
globalThis.document ??= {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null }),
};
const L = await import('../js/combat-logic.js');
const chars = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const char = prefix => chars.find(c => c.nom.startsWith(prefix));

// Maracacha casts Fiesta on Vorrakan and an ally that also has a react, listed first
function fiestaOnVorrakan() {
  const ally = chars.find(c => c.nom !== char('Vorr').nom && L.buildCombatant(c, 1, 2).abilities.some(a => a.isReact || a.isBlock));
  const caster = L.buildCombatant(char('Maraca'), 0, 0);
  const vor    = L.buildCombatant(char('Vorr'), 1, 1);
  const mate   = L.buildCombatant(ally, 1, 2);
  Object.assign(L.S, {
    combatants: [caster, mate, vor], initiativeOrder: [0, 2, 1], currentTurnIndex: 0, phase: 'combat',
    currentMap: null, log: [], activeDomains: [], pendingAction: null, awaitingReact: false, reactOptions: [], hasActed: false,
  });
  L.handleCastAbility(caster.id, 'Fiesta', [mate.id, vor.id]);
  return { vor, mate };
}
const answer = ability => { L.S.awaitingReact = false; L.S.reactOptions = []; L.resumePendingAction(ability); };

test('an ally taking the hit still lets the next target react', () => {
  const { vor, mate } = fiestaOnVorrakan();
  assert.equal(L.S.reactOptions[0].combatantId, mate.id);
  answer(null);
  assert.equal(L.S.awaitingReact, true);
  assert.equal(L.S.reactOptions[0].combatantId, vor.id);
});

test('Black Hole costs one slot, however many allies it shields', () => {
  const { vor } = fiestaOnVorrakan();
  answer(null);
  const slots = vor.spellSlots;
  answer(L.S.reactOptions.find(o => o.ability.name === 'Black Hole').ability);
  assert.equal(slots - vor.spellSlots, 1);
  assert.equal(L.S.awaitingReact, false);
});

test('Blink uses the action: no second spell after it, moving still allowed', () => {
  const thormak = L.buildCombatant(char('Thormak'), 0, 0);
  const foe     = L.buildCombatant(char('Maraca'), 1, 1);
  thormak.x = 1; thormak.y = 1; foe.x = 3; foe.y = 1;
  const walkable = Array.from({ length: 5 }, () => Uint8Array.from([1, 1, 1, 1, 1]));
  Object.assign(L.S, {
    combatants: [thormak, foe], initiativeOrder: [0, 1], currentTurnIndex: 0, phase: 'combat', log: [],
    currentMap: { grid: { walkable, cols: 5, rows: 5 } }, activeDomains: [], pendingAction: null,
    awaitingReact: false, reactOptions: [], hasActed: false, hasMoved: false,
  });
  assert.equal(L.getReacts(thormak).some(a => a.name === 'Blink'), false);
  L.handleCastAbility(thormak.id, 'Blink', [thormak.id]);
  assert.equal(L.S.teleportMode, true);
  assert.equal(L.S.hasActed, true);
  L.exitTeleportMode();
  const slots = thormak.spellSlots;
  L.handleCastAbility(thormak.id, 'Fire Spear', [foe.id]);
  assert.equal(thormak.spellSlots, slots); // refused
  assert.equal(L.S.hasMoved, false);
});
