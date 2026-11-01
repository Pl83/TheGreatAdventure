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
const logText = () => S.log.map(e => e.text).join('\n');

async function setup() {
  await newFight({ teamA: ['Wyldfire'], teamB: ['Kay Climber'], seed: 1 });
  const wyld = byName('Wyldfire'), foe = byName('Kay Climber');
  wyld.x = 10; wyld.y = 10; foe.x = 11; foe.y = 10;
  toTurn('Wyldfire');
  return { wyld, foe };
}

test('Wyldfire is immune to poison', async () => {
  const { wyld } = await setup();
  L.applyStatus(wyld, 'poison');
  assert.ok(!wyld.statusEffects.some(e => e.name === 'poison'));
  assert.match(logText(), /immune to poison/);
});

test('toxic still takes hold of Wyldfire, but hurts for only 1d4 a turn', async () => {
  const { wyld } = await setup();
  L.applyStatus(wyld, 'toxic');
  const toxic = wyld.statusEffects.find(e => e.name.toLowerCase() === 'toxic');
  assert.ok(toxic, 'toxic applies');
  for (let i = 0; i < 25; i++) {
    const hp = wyld.currentHp;
    toxic.turnsLeft = 5; toxic.ticks = 0;
    L.tickTurn(wyld);
    const lost = hp - wyld.currentHp;
    assert.ok(lost >= 1 && lost <= 4, `lost ${lost}`);
    wyld.currentHp = wyld.maxHp;
  }
});

test('toxic keeps its usual damage on anyone without the cap', async () => {
  const { foe } = await setup();
  L.applyStatus(foe, 'toxic');
  const toxic = foe.statusEffects.find(e => e.name.toLowerCase() === 'toxic');
  assert.ok(toxic && toxic.dice, 'a toxic with its own dice');
  assert.equal(foe.sourceChar.dotDamage, undefined);
});

test('Heat Projectile is two spells, one fire and one ice, the element picked by choosing the spell', async () => {
  const { wyld } = await setup();
  const fire = wyld.abilities.find(a => a.name === 'Heat Projectile (Fire)');
  const ice = wyld.abilities.find(a => a.name === 'Heat Projectile (Ice)');
  assert.ok(fire && ice);
  assert.equal(fire.dice, '2d8+2');
  assert.equal(L.damTypeFromTags(fire.tags), 'fire');
  assert.equal(L.damTypeFromTags(ice.tags), 'ice');
  assert.ok(!wyld.abilities.some(a => a.name === 'Heat Projectile'));
});

test('Pixal shoots a Gun for 2d6+4, physical with ice', async () => {
  await newFight({ teamA: ['Pixal'], teamB: ['Kay Climber'], seed: 1 });
  const pixal = byName('Pixal');
  assert.equal(pixal.sourceChar.baseAtk.nom, 'Gun');
  assert.equal(pixal.sourceChar.baseAtk.dices, '2d6+4');
  assert.deepEqual(pixal.sourceChar.baseAtk.tags, ['physical', 'ice']);
});
