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

// ── No slot cost; one charge, two for Hela and Chronos ─────────────────────

test('a domain costs no spell slot; each sheet has one charge, Hela and Chronos two', async () => {
  const { readFileSync } = await import('node:fs');
  const roster = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
  const owners = roster.filter(c => c.domain);
  assert.ok(owners.length >= 5);
  for (const c of owners) {
    assert.equal(c.domain.spellCost, undefined, `${c.nom} pays no slots`);
    assert.equal(L.domainChargesOf(c.domain), /^(Hela|Chronos)/.test(c.nom) ? 2 : 1, c.nom);
  }
});

test('expanding a domain spends a charge and no slot, even with no slot left', () => {
  const { susano } = setup();
  susano.spellSlots = 0;
  assert.equal(susano.domainCharges, 1);
  expand(susano);
  assert.equal(susano.domainActive, true);
  assert.equal(susano.domainCharges, 0);
  assert.equal(susano.spellSlots, 0);
});
