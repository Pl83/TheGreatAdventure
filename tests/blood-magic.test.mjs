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

test('Blood Magic: her 10 HP regeneration makes no blood shield, even at full HP', async () => {
  const { me } = await setup('Vampire Sienna');
  toTurn(me.name);
  L.handlePass(); settle();
  me.statusEffects = me.statusEffects.filter(e => e.name !== 'damage_shield');
  me.currentHp = me.maxHp - 3;   // the regeneration would overflow by 7
  toTurn(me.name);
  assert.equal(me.currentHp, me.maxHp);
  assert.ok(!me.statusEffects.some(e => e.name === 'damage_shield'), 'no shield from a regeneration');
});

test('Range Mode is a long mono shot with a splash; Rodent Mode is a flamethrower cone', async () => {
  for (const hero of ['Sienna', 'Vampire Sienna']) {
    const { me } = await setup(hero);
    const range = ability(me, 'Range Mode'), rodent = ability(me, 'Rodent Mode');
    assert.equal(range.isSplash, true, hero);
    assert.equal(range.splashDice, '1d10');
    assert.equal(range.range, 12);
    assert.equal(rodent.isCone, true, hero);
  }
});

test('her roll bonuses count: Precise Shot on the ranged mode, Basic Training on weapons only', async () => {
  const { me, foe } = await setup('Vampire Sienna');
  const range = ability(me, 'Range Mode'), torpedo = ability(me, 'Blood Torpedo');
  let shot = null, spell = null;
  for (let i = 0; i < 80 && !(shot && spell); i++) {
    if (!shot) { const r = L.resolveAttack(me, foe, range.dice, range); if (r.hit) shot = r; }
    if (!spell) { const r = L.resolveAttack(me, foe, torpedo.dice, torpedo); if (r.hit) spell = r; }
  }
  assert.match(shot.breakdown, /Precise Shot/);
  assert.match(shot.breakdown, /Basic Training/);
  assert.doesNotMatch(spell.breakdown, /Basic Training/, 'a spell is no weapon roll');
  assert.doesNotMatch(spell.breakdown, /Precise Shot/);
});

test('Battle Medic: her Healing Potion heals 1d10+2 and 3 more', async () => {
  const { me } = await setup('Sienna');
  let min = 99, max = 0;
  for (let i = 0; i < 60; i++) {
    toTurn(me.name);
    me.currentHp = 10;
    L.handleCastAbility(me.id, 'Healing Potion', [me.id]); settle();
    const got = me.currentHp - 10;
    min = Math.min(min, got); max = Math.max(max, got);
  }
  assert.ok(min >= 6, `at least 1+2+3, saw ${min}`);
  assert.ok(max <= 15, `at most 10+2+3, saw ${max}`);
});

test('Hypnosis: on a success Vampire Sienna steers her target\'s next action', async () => {
  const { me, foe } = await setup('Vampire Sienna');
  let seized = false;
  for (let i = 0; i < 60 && !seized; i++) {
    toTurn(me.name);
    me.spellSlots = 5;
    foe.statusEffects = [];
    L.handleCastAbility(me.id, 'Hypnosis', [foe.id]); settle();
    seized = foe.statusEffects.some(e => e.name === 'puppeteered' && e.controllerId === me.id);
  }
  assert.ok(seized, 'the target was put under her control');
});

test('SteamGun: a basic attack right after Range Mode or Rodent Mode sets the target on fire', async () => {
  for (const mode of ['Range Mode', 'Rodent Mode']) {
    const { me, foe } = await setup('Sienna');
    let burned = false;
    for (let i = 0; i < 60 && !burned; i++) {
      toTurn(me.name);
      foe.statusEffects = []; me.cooldowns = {};
      L.handleCastAbility(me.id, mode, [foe.id]); settle();
      foe.statusEffects = foe.statusEffects.filter(e => e.name.toLowerCase() !== 'burn');   // Rodent burns on its own
      toTurn(me.name);
      L.handleAttack(me.id, foe.id); settle();
      burned = foe.statusEffects.some(e => e.name.toLowerCase() === 'burn');
    }
    assert.ok(burned, `burn after ${mode} + attack`);
    assert.match(logText(), /SteamGun scorches/);
  }
});

test('SteamGun: Healing Potion before the attack does not count', async () => {
  const { me, foe } = await setup('Sienna');
  for (let i = 0; i < 12; i++) {
    toTurn(me.name);
    foe.statusEffects = [];
    L.handleCastAbility(me.id, 'Healing Potion', [me.id]); settle();
    toTurn(me.name);
    L.handleAttack(me.id, foe.id); settle();
    assert.ok(!foe.statusEffects.some(e => e.name.toLowerCase() === 'burn'), `no burn on try ${i}`);
  }
});

test('SteamGun: an attack that follows another attack does not burn', async () => {
  const { me, foe } = await setup('Sienna');
  for (let i = 0; i < 6; i++) { landBasicAttack(me, foe); }
  assert.ok(!foe.statusEffects.some(e => e.name.toLowerCase() === 'burn'));
});

test('SteamGun: Range Mode or Rodent Mode right after the other halves the damage, not after another technique', async () => {
  const { me, foe } = await setup('Sienna');
  const range = ability(me, 'Range Mode');
  const landed = () => {
    for (let i = 0; i < 80; i++) { const r = L.resolveAttack(me, foe, range.dice, range); if (r.hit) return r; }
    throw new Error('no hit');
  };
  me.prevKind = 'steamMode';
  assert.match(landed().breakdown, /STEAMGUN/);
  me.prevKind = 'technique';
  assert.doesNotMatch(landed().breakdown, /STEAMGUN/, 'Healing Potion is not a mode');
  me.prevKind = 'attack';
  assert.doesNotMatch(landed().breakdown, /STEAMGUN/);
});
