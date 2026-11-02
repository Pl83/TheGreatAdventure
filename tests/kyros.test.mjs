import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const roster = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const byName = name => S.combatants.find(c => c.name === name);
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.equal(L.activeCombatant().name, name);
  return L.activeCombatant();
};
const settle = () => { for (let i = 0; i < 20 && S.awaitingReact; i++) L.handleReactNo(); };
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}
const ab = (c, n) => c.abilities.find(a => a.name === n);

async function fight() {
  await newFight({ teamA: ['Kyros'], teamB: ['Kadgar', 'Aron'], seed: 9 });
  const k = byName('Kyros'), a = byName('Kadgar'), b = byName('Aron');
  k.x = 5; k.y = 5; a.x = 7; a.y = 5; b.x = 8; b.y = 5;
  a.currentHp = a.maxHp = 500; b.currentHp = b.maxHp = 500;
  return { k, a, b };
}

test('the sheet: two splash relics, once a fight, no execute tag', () => {
  const k = roster.find(c => c.nom === 'Kyros');
  const fire = k.moveSet.find(m => m.base.nom === "Destiny's Fire");
  const slash = k.moveSet.find(m => m.base.nom === 'The End Slash');
  assert.equal(fire.target, 'splash'); assert.equal(fire.base.dices, '1d20'); assert.equal(fire.splashDice, '1d20+1d6');
  assert.equal(slash.target, 'splash'); assert.equal(slash.base.dices, '2d20'); assert.equal(slash.splashDice, '1d20');
  assert.ok(!slash.base.tags.includes('execute'));
  assert.equal(fire.cooldown, 99); assert.equal(slash.cooldown, 99);
});

test("Destiny's Fire is refused above 30 HP and open at 30 or less", async () => {
  const { k } = await fight();
  k.currentHp = 31;
  assert.equal(L.abilityAvailable(k, ab(k, "Destiny's Fire")), false);
  k.currentHp = 30;
  assert.equal(L.abilityAvailable(k, ab(k, "Destiny's Fire")), true);
});

test('The End Slash needs under 25 HP', async () => {
  const { k } = await fight();
  k.currentHp = 25;
  assert.equal(L.abilityAvailable(k, ab(k, 'The End Slash')), false);
  k.currentHp = 24;
  assert.equal(L.abilityAvailable(k, ab(k, 'The End Slash')), true);
});

test("casting Destiny's Fire hits the target and lights the +1d10 for the rest of the fight", async () => {
  const { k, a, b } = await fight();
  k.currentHp = 20;
  toTurn('Kyros');
  assert.ok(!k.statusEffects.some(e => e.name === 'destiny_fire'));
  forceD20(18, 1);
  L.handleCastAbility(k.id, "Destiny's Fire", [a.id]);
  settle();
  assert.ok(a.currentHp < a.maxHp, 'the target is burnt');
  assert.ok(b.currentHp < b.maxHp, 'so is the one beside it');
  assert.ok(k.statusEffects.some(e => e.name === 'destiny_fire'));
  assert.ok(!L.abilityAvailable(k, ab(k, "Destiny's Fire")), 'once a fight');
});

test("the passive +1d10 is off until Destiny's Fire is cast", async () => {
  const { k, a } = await fight();
  toTurn('Kyros');
  const dmg = () => { a.currentHp = a.maxHp; forceD20(15, 1); const hp = a.currentHp; L.handleAttack(k.id, a.id); settle(); return hp - a.currentHp; };
  k.x = 6; k.y = 5;
  const off = dmg();
  k.statusEffects.push({ name: 'destiny_fire', turnsLeft: 999 });
  toTurn('Kyros');
  const on = dmg();
  assert.ok(off > 0 && on > off, `off ${off}, on ${on}`);
});

test('The End Slash: paralyses the target, burns those around it, heals Kyros', async () => {
  const { k, a, b } = await fight();
  k.x = 6; k.y = 5; a.x = 8; a.y = 5; b.x = 9; b.y = 5;   // the target is 2 away, the bystander beside it
  k.currentHp = 10;
  toTurn('Kyros');
  forceD20(18, 1);
  L.handleCastAbility(k.id, 'The End Slash', [a.id]);
  settle();
  assert.ok(a.statusEffects.some(e => e.name.toLowerCase() === 'para'), 'target paralysed');
  assert.ok(b.statusEffects.some(e => e.name.toLowerCase() === 'burn'), 'bystander burnt');
  assert.ok(!b.statusEffects.some(e => e.name.toLowerCase() === 'para'), 'bystander not paralysed');
  assert.ok(k.currentHp > 10, `Kyros healed (${k.currentHp})`);
});
