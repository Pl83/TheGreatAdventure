import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
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
const has = (c, name) => c.statusEffects.some(e => e.name === name);
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}

// Kadgar with Rox beside him against two foes
async function setup(foes = ['Kay Climber', 'Eragon'], seed = 1) {
  await newFight({ teamA: ['Kadgar', 'Rox'], teamB: foes, seed });
  const kadgar = byName('Kadgar'), rox = byName('Rox'), foe = byName(foes[0]);
  kadgar.x = 10; kadgar.y = 10; rox.x = 9; rox.y = 10; foe.x = 11; foe.y = 10;
  toTurn('Kadgar');
  return { kadgar, rox, foe };
}
const ability = (c, name) => c.abilities.find(a => a.name === name);

test('Kadgar knows the doc spells, and Recursing Shield and Mana Wall are instants', async () => {
  const { kadgar } = await setup();
  for (const n of ['Greater Invisibility', 'Greater Levitation', 'Mana Wall', 'Binding', 'Meteor Shower', 'Dispel Magic']) {
    assert.ok(ability(kadgar, n), n);
  }
  assert.equal(ability(kadgar, 'Meteor Shower').dice, '4d10');
  assert.ok(ability(kadgar, 'Recursing Shield').isInstant);
  assert.ok(ability(kadgar, 'Mana Wall').isInstant && ability(kadgar, 'Mana Wall').isReact);
  assert.ok(ability(kadgar, 'Dispel Magic').isInstant);
});

test('Greater Levitation: the caster and the allies near him fly for 5 turns, the far ones do not', async () => {
  const { kadgar, rox } = await setup();
  const far = byName('Kay Climber'); far.x = 30; far.y = 30;
  L.handleCastAbility(kadgar.id, 'Greater Levitation', [kadgar.id]);
  settle();
  assert.ok(has(kadgar, 'fly') && has(rox, 'fly'));
  assert.equal(rox.statusEffects.find(e => e.name === 'fly').turnsLeft, 5);
  assert.ok(!has(far, 'fly'));
});

test('Greater Invisibility: hidden units are attacked at disadvantage', async () => {
  const { kadgar, rox, foe } = await setup();
  L.handleCastAbility(kadgar.id, 'Greater Invisibility', [kadgar.id]);
  settle();
  assert.ok(has(kadgar, 'invisible') && has(rox, 'invisible'));
  toTurn(foe.name);
  foe.x = rox.x + 1; foe.y = rox.y;
  forceD20(18, 17, 5);
  L.handleAttack(foe.id, rox.id);
  settle();
  assert.match(logText(), /cannot be seen/);
  assert.match(logText(), /Disadvantage \(Kay Climber\)/);
});

test('Dispel Magic: cast on a target it strips the boons, and it costs no action', async () => {
  const { kadgar, foe } = await setup();
  foe.statusEffects.push({ name: 'damage_shield', turnsLeft: 99, shieldHp: 30, dice: null, damType: null, notes: '' });
  foe.statusEffects.push({ name: 'fly', turnsLeft: 4, dice: null, damType: null, notes: '' });
  L.handleCastAbility(kadgar.id, 'Dispel Magic', [foe.id]);
  settle();
  assert.ok(!has(foe, 'damage_shield') && !has(foe, 'fly'));
  assert.equal(S.hasActed, false, 'an instant');
  assert.equal(L.activeCombatant(), kadgar);
});

test('Dispel Magic as a react is offered against a spell, not against a basic attack', async () => {
  const { kadgar } = await setup();
  const spell = { tags: ['magic'], source: 'spell' };
  assert.ok(L.getReacts(kadgar, spell).some(a => a.name === 'Dispel Magic'));
  assert.ok(!L.getReacts(kadgar, null).some(a => a.name === 'Dispel Magic'));
  assert.ok(!L.getReacts(kadgar, { tags: ['physical'], source: 'technique' }).some(a => a.name === 'Dispel Magic'));
});

test('Mana Wall shields the caster and the allies beside him', async () => {
  const { kadgar, rox } = await setup();
  L.handleCastAbility(kadgar.id, 'Mana Wall', [kadgar.id]);
  settle();
  for (const c of [kadgar, rox]) {
    assert.equal(c.statusEffects.find(e => e.name === 'damage_shield')?.shieldHp, 20, c.name);
  }
});

test('Binding stuns on a hit', async () => {
  const { kadgar, foe } = await setup();
  let stunned = 0;
  for (let seed = 1; seed <= 12 && !stunned; seed++) {
    const ctx = await setup(['Kay Climber', 'Eragon'], seed);
    forceD20(19, 2);
    L.handleCastAbility(ctx.kadgar.id, 'Binding', [ctx.foe.id]);
    settle();
    stunned = ctx.foe.statusEffects.some(e => e.name.toLowerCase() === 'stun') ? 1 : 0;
  }
  assert.ok(stunned, 'a hit stuns (1d2 stun: it can take a few tries)');
  assert.ok(kadgar && foe);
});

test('the Great Staff gives a second action, but it must be a spell', async () => {
  const { kadgar, foe } = await setup();
  forceD20(15, 5);
  L.handleCastAbility(kadgar.id, 'Arcane Missile', [foe.id]);
  settle();
  assert.equal(L.activeCombatant(), kadgar, 'the turn is still open after one spell');
  const serial = S.turnSerial;
  foe.x = kadgar.x + 1; foe.y = kadgar.y;
  L.handleAttack(kadgar.id, foe.id);   // not a spell
  assert.equal(S.turnSerial, serial, 'a basic attack is refused');
  assert.match(logText(), /allows a second spell only/);
  forceD20(15, 5);
  L.handleCastAbility(kadgar.id, 'Arcane Missile', [foe.id]);   // the same spell again is fine
  settle();
  assert.ok(S.turnSerial > serial, 'two spells end the turn');
});

test('a non-spell first action leaves Kadgar a single action', async () => {
  const { kadgar, foe } = await setup();
  foe.x = kadgar.x + 1; foe.y = kadgar.y;
  const serial = S.turnSerial;
  forceD20(15, 5);
  L.handleAttack(kadgar.id, foe.id);
  settle();
  assert.ok(S.turnSerial > serial);
});
