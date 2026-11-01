import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

const HUI = 'Huītzilōpōchtli';
const byName = name => S.combatants.find(c => c.name === name);
const ability = (c, n) => c.abilities.find(a => a.name === n);

test('Sacrifice executes under 10% of the target HP, never below a floor of 10 HP', async () => {
  const cases = [['Kay Climber', 10, false], ['Kay Climber', 9, true], ['Hela, Goddess of Death', 44, true], ['Hela, Goddess of Death', 46, false]];
  for (const [name, hp, dies] of cases) {
    await newFight({ teamA: [HUI], teamB: [name], seed: 1 });
    const hui = byName(HUI), victim = byName(name);
    const sacrifice = ability(hui, 'Sacrifice');
    assert.ok(sacrifice.tags.includes('execute'));
    victim.currentHp = hp;
    L.executeStrike(hui, victim, sacrifice);
    assert.equal(victim.isKO, dies, `${name} at ${hp}/${victim.maxHp}`);
  }
  await newFight({ teamA: [HUI], teamB: ['Hela, Goddess of Death', 'Kay Climber'], seed: 1 });
  assert.equal(L.executeThreshold(byName('Hela, Goddess of Death')), 45);
  assert.equal(L.executeThreshold(byName('Kay Climber')), 10);
});

test('Grand Destruct grounds a flier one time in two; Explode Catapult bleeds one time in two', async () => {
  await newFight({ teamA: [HUI], teamB: ['Kay Climber'], seed: 1 });
  const hui = byName(HUI);
  assert.equal(ability(hui, 'Grand Destruct').groundChance, 0.5);
  assert.equal(ability(hui, 'Explode Catapult').effect, '1d2 bleed');
});

test('Morrow stays immune to physical, and Wind Tornado hinders one time in two', async () => {
  await newFight({ teamA: ['Morrow'], teamB: ['Kay Climber'], seed: 1 });
  const m = byName('Morrow');
  assert.deepEqual(m.sourceChar.immunities, ['physical']);
  assert.equal(ability(m, 'Wind Tornado').inflicts.chance, 0.5);
  assert.equal(ability(m, 'Wind Cutter').targetKind, 'enemy');
  assert.ok(ability(m, 'Wind Cutter').isCone);
});
