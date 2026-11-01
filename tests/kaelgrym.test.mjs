import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

const KAEL = 'Kaelgrym';
const byName = name => S.combatants.find(c => c.name.startsWith(name));
const ability = (c, n) => c.abilities.find(a => a.name === n);
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const toTurn = name => {
  for (let i = 0; i < 80 && !L.activeCombatant().name.startsWith(name); i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
};

async function setup(foe = 'Kay Climber') {
  await newFight({ teamA: [KAEL], teamB: [foe], seed: 1 });
  const k = byName(KAEL), f = byName(foe);
  k.x = 10; k.y = 10; f.x = 11; f.y = 10;
  f.maxHp = f.currentHp = 9999;
  toTurn(KAEL);
  return { k, f };
}

test('Cauterise heals 1d6+2 every time Kaelgrym takes damage', async () => {
  const { k } = await setup();
  k.maxHp = k.currentHp = 500;
  for (let i = 0; i < 20; i++) {
    const before = k.currentHp;
    L.applyDamage(k, 30, 'physical', ['physical']);
    const net = before - k.currentHp;
    assert.ok(net >= 30 - 8 && net <= 30 - 3, 'net loss ' + net);
  }
});

test('ice damage is cut by 1d4+2', async () => {
  const { k } = await setup();
  k.maxHp = k.currentHp = 500;
  const before = k.currentHp;
  L.applyDamage(k, 50, 'ice', ['ice', 'magic']);
  assert.ok(before - k.currentHp <= 50 - 3, 'lost ' + (before - k.currentHp));
});

test('Final Brasero spends every spell slot and leaves the target calcinated', async () => {
  const { k, f } = await setup();
  k.spellSlots = 5;
  k.statusEffects.push({ name: 'sure_hit', turnsLeft: 2, dice: null, damType: null, notes: '' });
  L.handleCastAbility(k.id, 'Final Brasero', [f.id]); settle();
  assert.equal(k.spellSlots, 0);
  assert.match(S.log.map(e => e.text).join(' '), /d20/);
  assert.ok(f.statusEffects.some(e => e.name.toLowerCase() === 'calcinated'), 'calcinated');
});

test('Raging Chopper is a cone, with 1d8+4 more on the main target', async () => {
  const { k } = await setup();
  const rc = ability(k, 'Raging Chopper');
  assert.equal(rc.targetType ?? rc.target, 'cone');
  assert.equal(rc.primaryBonus, '1d8+4');
});

test('Reaver bleeds and the awakened Bane burns, as 1d2 effects', async () => {
  const { k } = await setup();
  assert.equal(ability(k, 'Reaver').effect, '1d2 bleed');
  assert.equal(ability(k, "Ifrit's Bane (Awake)").effect, '1d2 burn');
});

test('the monster tag is carried by the monsters of the doc, and Beast Slayer reads it', () => {
  const chars = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
  for (const p of ['Morrow', 'Baal', 'Spheras Nightmare', 'Fire Spirit', 'Golem', 'Floating Head', 'Amalgame', 'Vampire Sienna']) {
    const c = chars.find(x => x.nom.startsWith(p));
    assert.ok(c && c.tags.includes('monster'), p);
  }
  const k = chars.find(x => x.nom === KAEL);
  assert.equal(k.passif.find(p => p.nom === 'Beast Slayer').condition.targetHasTag, 'monster');
});
