import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

const HELA = 'Hela, Goddess of Death';
const byName = name => S.combatants.find(c => c.name === name);
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  return L.activeCombatant();
};

async function setup() {
  await newFight({ teamA: [HELA], teamB: ['Kay Climber'], seed: 1 });
  const hela = byName(HELA), kay = byName('Kay Climber');
  hela.x = 10; hela.y = 10; kay.x = 11; kay.y = 10;
  kay.maxHp = kay.currentHp = 5000;
  toTurn(HELA);
  return { hela, kay };
}

test('Hela follows the doc: 20 slots, Anti-Magic up to Authority 9, Undying Queen heals 30', async () => {
  const { hela } = await setup();
  const sheet = hela.sourceChar;
  assert.equal(sheet.spellSlot, 20);
  assert.equal(sheet.passif.find(p => p.nom === 'Anti-Magic').authorityGate, 9);
  assert.equal(sheet.passif.find(p => p.nom === 'Undying Queen').dices, '30');
});

test('Perfect Reflection sends the spell back as cast, not doubled', async () => {
  const { hela } = await setup();
  assert.ok(hela.abilities.find(a => a.name === 'Perfect Reflection').tags.includes('reflect_plain'));
});

test('Death Gaze: disadvantage for two turns, and a stun only half the time', async () => {
  let stunned = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    await newFight({ teamA: [HELA], teamB: ['Kay Climber'], seed });
    const hela = byName(HELA), kay = byName('Kay Climber');
    hela.x = 10; hela.y = 10; kay.x = 11; kay.y = 10;
    toTurn(HELA);
    L.handleCastAbility(hela.id, 'Death Gaze', [kay.id]);
    settle();
    const hindered = kay.statusEffects.find(e => e.name === 'hindered');
    assert.ok(hindered, 'always hindered');
    assert.equal(hindered.turnsLeft, 3);
    if (kay.statusEffects.some(e => e.name.toLowerCase() === 'stun')) stunned++;
  }
  assert.ok(stunned > 5 && stunned < N - 5, `stunned ${stunned}/${N}`);
});

test('Final Reckoning heals 1d10 at the start of each of her turns', async () => {
  const { hela } = await setup();
  hela.statusEffects.push({ name: 'final_reckoning', turnsLeft: 999, dice: '2d12', damType: null, notes: '' });
  hela.currentHp = hela.maxHp - 100;
  L.tickTurn(hela);
  const gained = hela.currentHp - (hela.maxHp - 100);
  assert.ok(gained >= 1 && gained <= 10, `gained ${gained}`);
});

test('Anti-magic Slash: 2d12+4, cooldown 4, seals magic (silence)', async () => {
  const { hela } = await setup();
  const slash = hela.abilities.find(a => a.name === 'Anti-magic Slash');
  assert.equal(slash.dice, '2d12+4');
  assert.equal(slash.cooldownTurns, 4);
  assert.equal(slash.effect, 'silence');
});
