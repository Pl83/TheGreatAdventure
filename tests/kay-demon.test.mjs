import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;
const byName = name => S.combatants.find(c => c.name === name);

test('Kay Demon takes 15 less from every magic hit, and physical blows in full', async () => {
  await newFight({ teamA: ['Kay Demon'], teamB: ['Kay Climber'], seed: 1 });
  const demon = byName('Kay Demon');
  assert.deepEqual(demon.sourceChar.immunities, []);
  demon.maxHp = demon.currentHp = 9999;
  const lose = (amount, tags) => { const hp = demon.currentHp; L.applyDamage(demon, amount, 'fire', tags); return hp - demon.currentHp; };
  assert.equal(lose(40, ['fire', 'magic']), 25);
  assert.equal(lose(10, ['fire', 'magic']), 0, 'a weak spell is wiped out');
  assert.equal(lose(40, ['physical']), 40);
});

test('Volcana has no miss chance left; Sensei Lloyd has 70 HP', async () => {
  await newFight({ teamA: ['Kay Demon', 'Sensei Lloyd'], teamB: ['Kay Climber'], seed: 1 });
  const volcana = byName('Kay Demon').abilities.find(a => a.name === 'Volcana');
  assert.ok(!volcana.effect && !/miss/i.test(volcana.description ?? ''));
  assert.equal(byName('Sensei Lloyd').maxHp, 70);
});
