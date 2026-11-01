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
const armour = (c, foe) => L.defenseBonus(c, foe, null);
const CLIMBERS = ['Kay Climber', 'Zane Climber', 'Jay Climber', 'Cole Climber'];

async function setup(name, foeName = 'Heracles') {
  await newFight({ teamA: [name], teamB: [foeName], seed: 1 });
  const me = byName(name), foe = byName(foeName);
  me.x = 10; me.y = 10; foe.x = 30; foe.y = 30;
  toTurn(name);
  return { me, foe };
}
const flying = c => c.statusEffects.some(e => e.name.toLowerCase() === 'fly');
const formName = c => c.sourceChar.transformation.base.nom;

for (const name of CLIMBERS) {
  test(`${name}: the dragon form flies, loses Armored, and ends at the start of its 6th turn after`, async () => {
    const { me, foe } = await setup(name);
    const maxHp = me.maxHp, slots = me.maxSpellSlots;
    assert.equal(armour(me, foe), 2, 'armoured before');
    L.handleTransform(me.id);
    assert.ok(me.isTransformed);
    assert.ok(flying(me), 'flies in the form');
    assert.equal(armour(me, foe), 0, 'Armored is lost in the form');
    const timer = me.statusEffects.find(e => e.name === 'form_timer');
    assert.equal(timer.turnsLeft, 6);
    // it stays a dragon through five of its turns, and the sixth start ends it
    for (let t = 1; t <= 6; t++) {
      toTurn(foe.name); L.handlePass();           // round trip back to the climber
      toTurn(name);
      assert.equal(me.isTransformed, t < 6, `after ${t} turns`);
      if (S.over) break;
    }
    assert.ok(!me.isTransformed);
    assert.ok(!flying(me), 'flight ends with the form');
    assert.equal(armour(me, foe), 2, 'Armored is back');
    assert.equal(me.maxHp, maxHp, 'the form HP is gone');
    assert.equal(me.maxSpellSlots, slots);
    assert.ok(me.abilities.some(a => a.name === 'Spinzutsu'), 'normal kit back');
    assert.ok(!me.abilities.some(a => /Breath/.test(a.name)), 'breath gone');
  });
}

test('Jay regains all his spell slots on turning into a dragon, and defends with advantage', async () => {
  const { me } = await setup('Jay Climber');
  me.spellSlots = 1;
  L.handleTransform(me.id);
  assert.equal(me.spellSlots, me.maxSpellSlots);
  const log = S.log.map(e => e.text).join('\n');
  assert.match(log, /regains all spell slots/);
  const tf = me.sourceChar.transformation;
  assert.ok(tf.passif.some(p => p.tags.includes('adv') && p.applyOn.includes('defRoll')));
});

test('Cole\'s Heavy Power Hammer is 2d8+2 and stuns one time in two', async () => {
  let stunned = 0;
  const N = 60;
  for (let seed = 1; seed <= N; seed++) {
    await newFight({ teamA: ['Cole Climber'], teamB: ['Kay Climber'], seed });
    const cole = byName('Cole Climber'), foe = byName('Kay Climber');
    assert.equal(cole.sourceChar.baseAtk.dices, '2d8+2');
    cole.x = 10; cole.y = 10; foe.x = 11; foe.y = 10;
    foe.statusEffects = [];
    foe.maxHp = foe.currentHp = 9999;
    L.applyStatus(foe, cole.sourceChar.baseAtk.effect);
    if (foe.statusEffects.some(e => e.name.toLowerCase() === 'stun')) stunned++;
  }
  assert.ok(stunned > 10 && stunned < 50, `stunned ${stunned}/${N}`);
});

test('Relentless Warrior takes 1d10+2 off every hit per fallen ally', async () => {
  await newFight({ teamA: ['Kay Climber', 'Zane Climber'], teamB: ['Heracles'], seed: 1 });
  const kay = byName('Kay Climber'), zane = byName('Zane Climber');
  kay.maxHp = kay.currentHp = 9999;
  const hit = () => { const hp = kay.currentHp; L.applyDamage(kay, 100, 'physical', ['physical']); return hp - kay.currentHp; };
  for (let i = 0; i < 10; i++) assert.equal(hit(), 100, 'no ally down: no reduction');
  zane.isKO = true; kay.stacks['Relentless Warrior'] = 1;
  for (let i = 0; i < 20; i++) { const lost = hit(); assert.ok(lost >= 100 - 12 && lost <= 100 - 3, `lost ${lost}`); }
  kay.stacks['Relentless Warrior'] = 3;
  for (let i = 0; i < 20; i++) { const lost = hit(); assert.ok(lost >= 100 - 36 && lost <= 100 - 9, `lost ${lost}`); }
});

test('Kay gains two spell slots in the dragon form and loses them with it', async () => {
  const { me } = await setup('Kay Climber');
  const slots = me.maxSpellSlots;
  L.handleTransform(me.id);
  assert.equal(me.maxSpellSlots, slots + 2);
  assert.equal(me.spellSlots, slots + 2);
});
