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
const ability = (c, n) => c.abilities.find(a => a.name === n);

test('Thormak: Fire Spear is 1d20 on the target and 1d12 around it; Blink is instant', async () => {
  await newFight({ teamA: ['Thormak, The Titan Slayer'], teamB: ['Kay Climber'], seed: 1 });
  const t = byName('Thormak, The Titan Slayer');
  assert.equal(ability(t, 'Fire Spear').dice, '1d20');
  assert.equal(ability(t, 'Fire Spear').splashDice, '1d12');
  assert.ok(ability(t, 'Blink').isInstant);
});

test('Ras: Hunter Instinct is instant, so the sure hit can be followed by the attack in the same turn', async () => {
  await newFight({ teamA: ['Ras'], teamB: ['Kay Climber'], seed: 1 });
  const ras = byName('Ras'), kay = byName('Kay Climber');
  ras.x = 10; ras.y = 10; kay.x = 11; kay.y = 10;
  assert.ok(ability(ras, 'Hunter Instinct').isInstant);
  toTurn('Ras');
  const serial = S.turnSerial;
  L.handleCastAbility(ras.id, 'Hunter Instinct', [ras.id]); settle();
  assert.equal(L.activeCombatant(), ras, 'still Ras\'s turn');
  assert.equal(S.turnSerial, serial);
  assert.ok(ras.statusEffects.some(e => e.name === 'sure_hit'));
  L.handleAttack(ras.id, kay.id); settle();
  assert.match(S.log.map(e => e.text).join('\n'), /sure hit/);
});

test('Cinder: Shatterspin only exists in Blood Cinder, which defends with advantage', async () => {
  await newFight({ teamA: ['Cinder'], teamB: ['Kay Climber'], seed: 1 });
  const c = byName('Cinder');
  assert.ok(!ability(c, 'Shatterspin'), 'not in the base form');
  toTurn('Cinder');
  L.handleTransform(c.id);
  assert.ok(c.isTransformed);
  assert.ok(ability(c, 'Shatterspin'), 'in the blood form');
  assert.ok(c.sourceChar.transformation.passif.some(p => p.nom === 'Smoke Body' && p.tags.includes('adv')));
});

test('Blink and Hunter Instinct use no action, but are not offered as reactions to a blow', async () => {
  await newFight({ teamA: ['Thormak, The Titan Slayer', 'Ras'], teamB: ['Kay Climber'], seed: 1 });
  for (const name of ['Thormak, The Titan Slayer', 'Ras']) {
    const names = L.getReacts(byName(name)).map(a => a.name);
    assert.ok(!names.includes('Blink') && !names.includes('Hunter Instinct'), `${name}: ${names}`);
  }
});
