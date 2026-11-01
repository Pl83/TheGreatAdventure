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
  assert.equal(L.activeCombatant().name, name);
  return L.activeCombatant();
};
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const logText = () => S.log.map(e => e.text).join('\n');

// Sora and a mecha (Pixal), a living ally (Rox), against one foe
async function setup(extra = 'Rox') {
  await newFight({ teamA: ['Sora', 'Pixal', extra], teamB: ['Kay Climber'], seed: 1 });
  const sora = byName('Sora'), pixal = byName('Pixal'), mate = byName(extra);
  sora.x = 10; sora.y = 10; pixal.x = 11; pixal.y = 10; mate.x = 9; mate.y = 10;
  toTurn('Sora');
  return { sora, pixal, mate };
}

test('Remake mends a wounded mecha ally', async () => {
  const { sora, pixal } = await setup();
  pixal.currentHp = 10;
  L.handleCastAbility(sora.id, 'Remake', [pixal.id]);
  settle();
  assert.ok(pixal.currentHp >= 31, `mended to ${pixal.currentHp}`);
});

test('Remake refuses a living ally, and costs nothing', async () => {
  const { sora, mate } = await setup();
  mate.currentHp = 10;
  const slots = sora.spellSlots;
  L.handleCastAbility(sora.id, 'Remake', [mate.id]);
  settle();
  assert.equal(mate.currentHp, 10);
  assert.equal(sora.spellSlots, slots);
  assert.equal(L.activeCombatant(), sora, 'the turn is still open');
  assert.match(logText(), /only mends machines/);
});

test('Remake is not available when no machine stands with Sora', async () => {
  await newFight({ teamA: ['Sora', 'Rox'], teamB: ['Kay Climber'], seed: 1 });
  const sora = byName('Sora');
  assert.ok(!L.hasValidTarget(sora, sora.abilities.find(a => a.name === 'Remake')));
});

test('a classic heal does nothing to a machine', async () => {
  const { pixal } = await setup();
  pixal.currentHp = 10;
  L.applyHeal(pixal, '20');
  assert.equal(pixal.currentHp, 10);
  assert.match(logText(), /machine/);
  L.applyHeal(pixal, '20', 'Remake', true);
  assert.equal(pixal.currentHp, 30, 'a repair works');
});

test('a classic heal still works on the living', async () => {
  const { mate } = await setup();
  mate.currentHp = 10;
  L.applyHeal(mate, '20');
  assert.equal(mate.currentHp, 30);
});

test('regen on a machine does not tick', async () => {
  const { pixal } = await setup();
  pixal.currentHp = 10;
  pixal.statusEffects.push({ name: 'regen', turnsLeft: 5, dice: '10', damType: null, notes: '' });
  L.tickTurn(pixal);
  assert.equal(pixal.currentHp, 10);
});

test('a form that sheds the mecha tag (Zane in Dragon Form) can be healed the classic way again', async () => {
  await newFight({ teamA: ['Zane Climber'], teamB: ['Kay Climber'], seed: 1 });
  const zane = byName('Zane Climber');
  assert.ok(L.isMecha(zane));
  zane.isTransformed = true;
  assert.ok(!L.isMecha(zane));
  zane.currentHp = 10;
  L.applyHeal(zane, '20');
  assert.equal(zane.currentHp, 30);
});

test('the AI does not waste a heal on a machine, nor Remake on the living', async () => {
  const { enumeratePlans } = await import('../js/ai/candidates.js');
  const { sora, pixal, mate } = await setup();
  pixal.currentHp = 10; mate.currentHp = 10;
  const remakes = enumeratePlans(sora).filter(p => p.action.ability === 'Remake');
  assert.ok(remakes.length > 0, 'Remake is offered');
  assert.ok(remakes.every(p => p.action.targetIds.every(id => id === pixal.id)), 'only on the machine');
});
