import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

const byName = name => S.combatants.find(c => c.name === name);
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  return L.activeCombatant();
};
const logText = () => S.log.map(e => e.text).join('\n');
const ability = (c, n) => c.abilities.find(a => a.name === n);

async function setup(hero, seed = 1) {
  await newFight({ teamA: [hero], teamB: ['Kay Climber'], seed });
  const me = byName(hero), foe = byName('Kay Climber');
  me.x = 10; me.y = 10; foe.x = 11; foe.y = 10;
  foe.maxHp = foe.currentHp = 9999;
  return { me, foe };
}

// a basic attack that lands, retried turn after turn
function landBasicAttack(me, foe) {
  for (let i = 0; i < 40; i++) {
    toTurn(me.name);
    const before = foe.currentHp;
    L.handleAttack(me.id, foe.id); settle();
    if (foe.currentHp < before) return before - foe.currentHp;
  }
  throw new Error('the attack never landed');
}

test('Blood Magic: every hit heals her for half of the damage it dealt', async () => {
  const { me, foe } = await setup('Vampire Sienna');
  me.statusEffects = [];
  let dealt = 0, healed = 0;
  for (let i = 0; i < 40 && !dealt; i++) {
    toTurn(me.name);
    me.currentHp = 20;
    const before = foe.currentHp;
    L.handleAttack(me.id, foe.id); settle();
    dealt = before - foe.currentHp;
    healed = me.currentHp - 20;
  }
  assert.ok(dealt > 0, 'a hit landed');
  assert.equal(healed, Math.floor(dealt / 2));
  assert.match(logText(), /Blood Magic drain/);
});

test('Blood Magic: healing past full HP becomes a blood shield', async () => {
  const { me, foe } = await setup('Vampire Sienna');
  let shield = null, dealt = 0;
  for (let i = 0; i < 40 && !shield; i++) {
    toTurn(me.name);
    me.currentHp = me.maxHp - 1;
    me.statusEffects = me.statusEffects.filter(e => e.name !== 'damage_shield');
    const before = foe.currentHp;
    L.handleAttack(me.id, foe.id); settle();
    dealt = before - foe.currentHp;
    shield = me.statusEffects.find(e => e.name === 'damage_shield') ?? null;
  }
  assert.ok(shield, 'a shield appeared');
  assert.equal(me.currentHp, me.maxHp);
  assert.equal(shield.shieldHp, Math.floor(dealt / 2) - 1, 'everything past the one missing HP');
});

test('Blood Magic: she regenerates 10 HP at the start of her turn', async () => {
  const { me } = await setup('Vampire Sienna');
  toTurn(me.name);
  L.handlePass(); settle();
  me.currentHp = 50;
  S.log = [];
  toTurn(me.name);
  assert.match(logText(), /Vampire Sienna recovers 10 HP/);
});

test('Bite takes spell slots and ki from the target', async () => {
  const { me, foe } = await setup('Vampire Sienna');
  let drained = false;
  for (let i = 0; i < 60 && !drained; i++) {
    toTurn(me.name);
    foe.spellSlots = 6; foe.ki = 6;
    me.spellSlots = 2;
    L.handleCastAbility(me.id, 'Bite', [foe.id]); settle();
    drained = foe.spellSlots < 6;
  }
  assert.ok(drained, 'a bite landed');
  assert.ok(foe.spellSlots >= 2 && foe.spellSlots <= 5, `1d4 slots taken, ${foe.spellSlots} left`);
  assert.ok(foe.ki >= 0 && foe.ki <= 4, `2d4 ki taken, ${foe.ki} left`);
  assert.ok(me.spellSlots > 2, 'she keeps the slots');
});

test('SteamGun: a basic attack right after a technique sets the target on fire', async () => {
  const { me, foe } = await setup('Sienna');
  let burned = false;
  for (let i = 0; i < 40 && !burned; i++) {
    toTurn(me.name);
    foe.statusEffects = [];
    L.handleCastAbility(me.id, 'Healing Potion', [me.id]); settle();
    toTurn(me.name);
    L.handleAttack(me.id, foe.id); settle();
    burned = foe.statusEffects.some(e => e.name.toLowerCase() === 'burn');
  }
  assert.ok(burned, 'burn after technique + attack');
  assert.match(logText(), /SteamGun scorches/);
});

test('SteamGun: an attack that follows another attack does not burn', async () => {
  const { me, foe } = await setup('Sienna');
  for (let i = 0; i < 6; i++) { landBasicAttack(me, foe); }
  assert.ok(!foe.statusEffects.some(e => e.name.toLowerCase() === 'burn'));
});

test('SteamGun: two techniques in a row halve the second one\'s damage', async () => {
  const { me, foe } = await setup('Sienna');
  const range = ability(me, 'Range Mode');
  const first = r => r.breakdown.includes('STEAMGUN');
  me.prevKind = 'technique';
  let halved = null;
  for (let i = 0; i < 60 && !halved; i++) {
    const r = L.resolveAttack(me, foe, range.dice, range);
    if (r.hit) halved = r;
  }
  assert.ok(halved && first(halved), halved?.breakdown);
  me.prevKind = 'attack';
  let normal = null;
  for (let i = 0; i < 60 && !normal; i++) {
    const r = L.resolveAttack(me, foe, range.dice, range);
    if (r.hit) normal = r;
  }
  assert.ok(normal && !first(normal), normal?.breakdown);
});
