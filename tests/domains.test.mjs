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

// Susano and Kaelgrym on team 0, Hela on team 1; whoever is named acts next
function setup() {
  const susano = L.buildCombatant(char('Susano'), 0, 0);
  const kael   = L.buildCombatant(char('Kaelgrym'), 0, 1);
  const hela   = L.buildCombatant(char('Hela'), 1, 2);
  Object.assign(L.S, {
    combatants: [susano, kael, hela], initiativeOrder: [0, 1, 2], currentTurnIndex: 0, phase: 'combat',
    currentMap: null, log: [], activeDomains: [], pendingAction: null, awaitingReact: false, reactOptions: [], hasActed: false,
  });
  return { susano, kael, hela };
}
const expand = c => { L.S.hasActed = false; L.handleActivateDomain(c.id); };

test("a teammate's active domain blocks a second expansion, at no cost", () => {
  const { susano, kael } = setup();
  expand(susano);
  assert.equal(susano.domainActive, true);
  const slots = kael.spellSlots, charges = kael.domainCharges;
  expand(kael);
  assert.equal(kael.domainActive, false);
  assert.equal(kael.spellSlots, slots);
  assert.equal(kael.domainCharges, charges);
  assert.equal(L.S.hasActed, false);
  assert.equal(L.S.activeDomains.length, 1);
});

test('the teammate can expand once the first domain ends', () => {
  const { susano, kael } = setup();
  expand(susano);
  L.suppressDomain(susano);
  expand(kael);
  assert.equal(kael.domainActive, true);
});

test('an enemy domain does not count as an ally domain', () => {
  const { susano, hela } = setup();
  expand(susano);
  assert.equal(L.activeAllyDomain(hela), null);
});
