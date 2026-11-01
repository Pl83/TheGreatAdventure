import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

const byName = name => S.combatants.find(c => c.name === name);
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  return L.activeCombatant();
};
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const logText = () => S.log.map(e => e.text).join('\n');
const ability = (c, n) => c.abilities.find(a => a.name === n);

test('Eragon follows the doc: 55 HP, Archmage, Runik Mage, the new spells and the changed dice', async () => {
  await newFight({ teamA: ['Eragon'], teamB: ['Kay Climber'], seed: 1 });
  const e = byName('Eragon');
  assert.equal(e.maxHp, 55);
  assert.equal(e.maxSpellSlots, 20);
  const passives = e.sourceChar.passif.map(p => p.nom);
  assert.ok(['Archmage', 'Runik Mage', 'Know Advantage'].every(p => passives.includes(p)));
  assert.ok(!ability(e, 'Runique Precast'));
  assert.equal(ability(e, 'Fire Tornado').dice, '3d12');
  assert.equal(ability(e, 'Ice Coffin').dice, '2d12');
  assert.equal(ability(e, 'Shield').dice, '30');
  assert.equal(ability(e, 'Water Dragon').dice, '3d12');
  assert.equal(ability(e, 'Water Dragon').splashDice, '1d8');
  for (const n of ['Arcane Missile', 'Mana Wall', 'Meteor Shower']) assert.ok(ability(e, n), n);
  assert.equal(L.damTypeFromTags(ability(e, 'Dragon Breath (Fire)').tags), 'fire');
  assert.equal(L.damTypeFromTags(ability(e, 'Dragon Breath (Ice)').tags), 'ice');
  assert.equal(L.damTypeFromTags(ability(e, 'Dragon Breath (Lightning)').tags), 'lightning');
  assert.ok(!ability(e, 'Dragon Breath'));
});

test('Kadgar breathes fire, ice or lightning, by choosing the spell', async () => {
  await newFight({ teamA: ['Kadgar'], teamB: ['Kay Climber'], seed: 1 });
  const k = byName('Kadgar');
  const types = ['Fire', 'Ice', 'Lightning'].map(el => L.damTypeFromTags(ability(k, `Dragon Breath (${el})`).tags));
  assert.deepEqual(types, ['fire', 'ice', 'lightning']);
  assert.ok(!ability(k, 'Dragon Breath'));
});

test('thermal shock: a fire attack on a frozen target thaws it and adds 2d12', async () => {
  await newFight({ teamA: ['Eragon'], teamB: ['Kay Climber'], seed: 1 });
  const kay = byName('Kay Climber');
  kay.maxHp = kay.currentHp = 9999;
  const hit = (tags, type) => { const hp = kay.currentHp; L.applyDamage(kay, 10, type, tags); return hp - kay.currentHp; };
  L.applyStatus(kay, 'gel');
  assert.ok(kay.statusEffects.some(e => e.name.toLowerCase() === 'gel'), 'fixture: frozen');
  assert.equal(hit(['magic', 'ice'], 'ice'), 10, 'ice does not shatter it');
  assert.ok(kay.statusEffects.some(e => e.name.toLowerCase() === 'gel'));
  const lost = hit(['magic', 'fire'], 'fire');
  assert.ok(lost >= 12 && lost <= 34, `lost ${lost}`);
  assert.ok(!kay.statusEffects.some(e => e.name.toLowerCase() === 'gel'), 'thawed');
  assert.match(logText(), /Thermal shock/);
  assert.equal(hit(['magic', 'fire'], 'fire'), 10, 'nothing left to shatter');
});

test('Arcane Canal gives 4 slots to the allies, not to Eragon', async () => {
  await newFight({ teamA: ['Eragon', 'Kay Climber'], teamB: ['Ras'], seed: 1 });
  const e = byName('Eragon'), kay = byName('Kay Climber');
  toTurn('Eragon');
  e.spellSlots = 10; kay.spellSlots = 1;
  L.handleCastAbility(e.id, 'Arcane Canal', [e.id, kay.id]);
  settle();
  assert.equal(kay.spellSlots, 5);
  assert.equal(e.spellSlots, 8, 'paid 2, regained nothing');
});

test('Water Dragon and Marrow Spear hurt the bystanders with their own dice', async () => {
  for (const [caster, spell, max] of [['Eragon', 'Water Dragon', 8], ['Oslo', 'Marrow Spear', 6]]) {
    let seen = 0;
    for (let seed = 1; seed <= 25 && !seen; seed++) {
      await newFight({ teamA: [caster], teamB: ['Ras', 'Kay Climber'], seed });
      const me = byName(caster), ras = byName('Ras'), kay = byName('Kay Climber');
      me.x = 10; me.y = 10; ras.x = 12; ras.y = 10; kay.x = 12; kay.y = 11;
      ras.maxHp = ras.currentHp = kay.maxHp = kay.currentHp = 9999;
      toTurn(caster);
      L.handleCastAbility(me.id, spell, [ras.id]);
      settle();
      const m = logText().match(/Kay Climber is caught by the splash for (\d+)/);
      if (m) { seen++; assert.ok(Number(m[1]) <= max * 2, `${spell} splash ${m[1]}`); }
    }
    assert.ok(seen, `${spell} splashed someone`);
  }
});

test('Oslo: Marrow Spear 1d8, Bone Prison roots 1 time in 2, Serpent Blade poisons 1 time in 2, Warden and Ranger passives', async () => {
  await newFight({ teamA: ['Oslo'], teamB: ['Kay Climber'], seed: 1 });
  const o = byName('Oslo');
  assert.equal(ability(o, 'Marrow Spear').dice, '1d8');
  assert.equal(ability(o, 'Marrow Spear').splashDice, '1d6');
  assert.equal(ability(o, 'Bone Prison').effect, '1d2 root');
  assert.equal(o.sourceChar.baseAtk.effect, '1d2 poison');
  const names = o.sourceChar.passif.map(p => p.nom);
  assert.ok(names.includes('Warden of the Wilds') && names.includes('Ranger'));
});

test('Sun\'s Divine Staff is 2d8+1d6+6', async () => {
  await newFight({ teamA: ['Sun'], teamB: ['Kay Climber'], seed: 1 });
  assert.equal(byName('Sun').sourceChar.baseAtk.dices, '2d8+1d6+6');
});
