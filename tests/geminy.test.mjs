import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const roster = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const sheetOf = n => roster.find(c => c.nom === n);
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
const KRUX = 'Krux & Acronix';

test('Geminy: two actions a turn, and the same one twice is allowed', async () => {
  await newFight({ teamA: [KRUX], teamB: ['Kadgar'], seed: 3 });
  const k = byName(KRUX), foe = byName('Kadgar');
  k.x = 5; k.y = 5; foe.x = 6; foe.y = 5;
  foe.currentHp = foe.maxHp = 500;
  toTurn(KRUX);
  assert.equal(L.actionBudget(k), 2);
  forceD20(15, 3);
  L.handleAttack(k.id, foe.id); settle();
  assert.equal(S.hasActed, false, 'one action left');
  assert.equal(L.activeCombatant().name, KRUX);
  forceD20(15, 3);
  L.handleAttack(k.id, foe.id); settle();
  assert.equal(S.actionsDone.length === 2 || L.activeCombatant().name !== KRUX, true);
});

test('Vision of Time: a natural 1 is a plain 2, and disadvantage is gone', async () => {
  await newFight({ teamA: [KRUX], teamB: ['Kadgar'], seed: 3 });
  const k = byName(KRUX);
  forceD20(1);
  const r = L.rollD20For(k);
  assert.equal(r.value, 2);
  assert.equal(r.isNat1, false);
  k.statusEffects.push({ name: 'disadvantage', turnsLeft: 3, uses: 3 });
  forceD20(17, 1);
  assert.equal(L.rollD20For(k).value, 17, 'only one die, no keep-the-lower');
});

test('other fighters still fumble on a 1 and keep disadvantage', async () => {
  await newFight({ teamA: ['Kadgar'], teamB: [KRUX], seed: 3 });
  const kad = byName('Kadgar');
  forceD20(1);
  assert.equal(L.rollD20For(kad).isNat1, true);
  kad.statusEffects.push({ name: 'disadvantage', turnsLeft: 3, uses: 3 });
  forceD20(17, 4);
  assert.equal(L.rollD20For(kad).value, 4);
});

test('Play: sheds every hindrance from an ally and gives advantage on the next d20', async () => {
  await newFight({ teamA: [KRUX, 'Kadgar'], teamB: ['Alicia'], seed: 4 });
  const k = byName(KRUX), ally = byName('Kadgar');
  k.x = 3; k.y = 3; ally.x = 5; ally.y = 3;
  L.applyStatus(ally, 'stun');
  assert.ok(ally.statusEffects.some(e => e.name.toLowerCase() === 'stun'));
  toTurn(KRUX);
  L.handleCastAbility(k.id, 'Play', [ally.id]);
  settle();
  assert.ok(!ally.statusEffects.some(e => e.name.toLowerCase() === 'stun'));
  assert.ok(ally.statusEffects.some(e => e.name === 'advantage'));
});

test('Forward: foes in the area lose 1d4 spell slots each and the caster gains none', async () => {
  await newFight({ teamA: [KRUX], teamB: ['Kadgar', 'Alicia'], seed: 6 });
  const k = byName(KRUX), a = byName('Kadgar'), b = byName('Alicia');
  k.x = 3; k.y = 3; a.x = 8; a.y = 3; b.x = 9; b.y = 3;
  a.spellSlots = b.spellSlots = 10;
  k.spellSlots = 20;
  toTurn(KRUX);
  forceD20(20, 1, 1);   // the blast lands; the foes defend badly
  L.handleCastAbility(k.id, 'Forward', [a.id, b.id], { x: 8, y: 3 });
  settle();
  const lost = 20 - (a.spellSlots + b.spellSlots);
  assert.ok(lost > 0, `foes lost slots (${lost})`);
  assert.equal(k.spellSlots, 19, 'only the cost of Forward is gone');
});

test('Backward: gives back what the target lost since its last turn began', async () => {
  await newFight({ teamA: [KRUX, 'Kadgar'], teamB: ['Alicia'], seed: 7 });
  const k = byName(KRUX), ally = byName('Kadgar');
  k.x = 3; k.y = 3; ally.x = 4; ally.y = 3;
  toTurn('Kadgar');
  const before = ally.currentHp;
  L.applyDamage(ally, 30, 'physical', ['physical'], true);
  const hurt = before - ally.currentHp;
  assert.ok(hurt > 0);
  toTurn(KRUX);
  L.handleCastAbility(k.id, 'Backward', [ally.id]);
  settle();
  assert.equal(ally.currentHp, before);
  assert.equal(ally.hurtSinceTurn, 0);
});

test('Krux & Acronix sheet carries the tags the engine reads', () => {
  const s = sheetOf(KRUX);
  assert.ok(s.passif.find(p => p.nom === 'Geminy').tags.includes('geminy'));
  assert.ok(s.passif.find(p => p.nom === 'Vision of Time').tags.includes('visionOfTime'));
  const move = n => s.moveSet.find(m => m.base.nom === n);
  assert.ok(move('Backward').base.tags.includes('rewind'));
  assert.ok(move('Play').base.tags.includes('cleans') && move('Play').base.tags.includes('adv_next'));
  assert.equal(move('Forward').drainSlots, '1d4');
  assert.equal(move('Forward').drainDestroy, true);
});
