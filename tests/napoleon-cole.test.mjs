import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { settleReacts } = await import('../js/ai/apply.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const byName = name => S.combatants.find(c => c.name.startsWith(name));
const toTurn = name => {
  for (let i = 0; i < 80 && !L.activeCombatant().name.startsWith(name); i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.ok(L.activeCombatant().name.startsWith(name), `reached ${name}'s turn`);
  return L.activeCombatant();
};
const place = (c, x, y) => { c.x = x; c.y = y; };
function freeRun(len) {
  const { cols, rows } = S.currentMap.grid;
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - len; x++) {
    let ok = true;
    for (let i = 0; i <= len && ok; i++) ok = isWalkableG(S.currentMap, x + i, y) && !L.isOccupied(x + i, y);
    if (ok) return { x, y };
  }
  throw new Error('no free run on the map');
}
const logText = () => S.log.map(e => e.text);
const status = (c, name) => c.statusEffects.find(e => e.name === name);
const ability = (c, name) => c.abilities.find(a => a.name === name);

// The next d20s come out as `values`; then every die lands in the middle
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}
// The next random draws are a d6 of `face`
function forceD6(face) {
  const queue = [(face - 0.5) / 6];
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}

// Cole alone with Ras, both standing on a free run
async function coleFight(seed = 1) {
  await newFight({ teamA: ['Cole Climber'], teamB: ['Ras'], seed });
  const cole = byName('Cole Climber'), ras = byName('Ras');
  const spot = freeRun(5);
  place(cole, spot.x, spot.y);
  place(ras, spot.x + 1, spot.y);
  return { cole, ras };
}
async function napFight(seed = 1) {
  await newFight({ teamA: ['Napoléon'], teamB: ['Ras'], seed });
  const nap = byName('Napo'), ras = byName('Ras');
  const spot = freeRun(5);
  place(nap, spot.x, spot.y);
  place(ras, spot.x + 1, spot.y);
  return { nap, ras };
}

// ── Stone Skin ─────────────────────────────────────────────────────────────

test('Stone Skin cast on the owner\'s own turn gives 10 flat reduction and ends the turn', async () => {
  const { cole } = await coleFight();
  toTurn('Cole');
  const slots = cole.spellSlots, serial = S.turnSerial;
  L.handleCastAbility(cole.id, 'Stone Skin', [cole.id]);
  const skin = status(cole, 'damage_reduction');
  assert.ok(skin, 'the reduction is up');
  assert.equal(skin.amount, 10);
  assert.equal(cole.spellSlots, slots - 1);
  assert.notEqual(S.turnSerial, serial, 'the turn ended');
});

test('Stone Skin takes 10 off every hit, not just the first', async () => {
  const { cole } = await coleFight();
  toTurn('Cole');
  L.handleCastAbility(cole.id, 'Stone Skin', [cole.id]);
  for (let hit = 0; hit < 3; hit++) {
    const before = cole.currentHp;
    L.applyDamage(cole, 25, 'physical', ['physical']);
    assert.equal(before - cole.currentHp, 15, `hit ${hit + 1} loses 25 - 10`);
  }
});

test('Stone Skin lasts three of the owner\'s turns', async () => {
  const { cole } = await coleFight();
  toTurn('Cole');
  L.handleCastAbility(cole.id, 'Stone Skin', [cole.id]);
  for (let turn = 1; turn <= 3; turn++) {
    toTurn('Cole');
    assert.ok(status(cole, 'damage_reduction'), `still up at the start of turn ${turn}`);
    L.handlePass();
  }
  toTurn('Cole');
  assert.equal(status(cole, 'damage_reduction'), undefined, 'gone at the fourth');
});

test('Stone Skin used as a react takes 10 off the hit that triggered it and stays up', async () => {
  const { cole, ras } = await coleFight();
  toTurn('Ras');
  forceD20(15, 5);
  L.handleAttack(ras.id, cole.id);
  assert.equal(S.awaitingReact, true);
  const hp = cole.currentHp;
  L.resumePendingAction(ability(cole, 'Stone Skin'));
  assert.ok(logText().some(t => /shaves/.test(t)), 'the reduction bit');
  assert.ok(status(cole, 'damage_reduction'), 'and it lasts');
  assert.ok(cole.currentHp > hp - 100 && cole.currentHp <= hp, 'the blow was not simply blocked away');
  assert.ok(!logText().some(t => /blocks with Stone Skin/.test(t)));
});

// ── Wind's Whim ────────────────────────────────────────────────────────────

test('Wind\'s Whim cast on the owner\'s own turn gives +4 on defense against ranged attacks only', async () => {
  const { nap, ras } = await napFight();
  toTurn('Napo');
  L.handleCastAbility(nap.id, "Wind's Whim", [nap.id]);
  assert.ok(status(nap, 'ranged_guard'));
  place(ras, nap.x + 4, nap.y);
  assert.equal(L.defenseBonus(nap, ras, null), 4, 'a blow from four cells away');
  place(ras, nap.x + 1, nap.y);
  assert.equal(L.defenseBonus(nap, ras, null), 0, 'a blow from next to him');
});

test('Wind\'s Whim lasts two of the owner\'s turns', async () => {
  const { nap } = await napFight();
  toTurn('Napo');
  L.handleCastAbility(nap.id, "Wind's Whim", [nap.id]);
  for (let turn = 1; turn <= 2; turn++) {
    toTurn('Napo');
    assert.ok(status(nap, 'ranged_guard'), `still up at the start of turn ${turn}`);
    L.handlePass();
  }
  toTurn('Napo');
  assert.equal(status(nap, 'ranged_guard'), undefined);
});

test('Wind\'s Whim as a react can turn a ranged hit already rolled into a miss', async () => {
  await newFight({ teamA: ['Napoléon'], teamB: ['Susano'], seed: 1 });
  const nap = byName('Napo'), susano = byName('Susano');
  const spot = freeRun(5);
  place(nap, spot.x, spot.y);
  place(susano, spot.x + 3, spot.y);
  toTurn('Susano');
  const spell = susano.abilities.find(a => a.name === 'Ice Coffin');
  assert.ok(spell && spell.dice && !spell.isAoe && !spell.isCone && !spell.isSplash, 'fixture: a single-target spell');
  forceD20(12, 10);
  L.handleCastAbility(susano.id, spell.name, [nap.id]);
  assert.equal(S.awaitingReact, true);
  const hp = nap.currentHp;
  L.resumePendingAction(ability(nap, "Wind's Whim"));
  assert.equal(nap.currentHp, hp, '12 against 10+4 misses');
  assert.ok(logText().some(t => /Wind's Whim lifts/.test(t)));
});

// ── Destiny Gamble ─────────────────────────────────────────────────────────

test('Destiny Gamble on a 1 costs Napoléon 10 HP', async () => {
  const { nap } = await napFight();
  toTurn('Napo');
  const hp = nap.currentHp, serial = S.turnSerial;
  forceD6(1);
  L.handleCastAbility(nap.id, 'Destiny Gamble', [nap.id]);
  assert.equal(hp - nap.currentHp, 10);
  assert.notEqual(S.turnSerial, serial, 'the cast ends the turn');
  assert.equal(status(nap, 'gamble_bonus'), undefined);
  assert.equal(status(nap, 'destiny_crit'), undefined);
});

test('Destiny Gamble on 2 to 5 adds 2d8 to the next attack, once', async () => {
  for (const face of [2, 5]) {
    const { nap, ras } = await napFight();
    toTurn('Napo');
    forceD6(face);
    L.handleCastAbility(nap.id, 'Destiny Gamble', [nap.id]);
    assert.ok(status(nap, 'gamble_bonus'), `face ${face}`);
    forceD20(15, 5);
    const first = L.resolveAttack(nap, ras, '1d6');
    assert.match(first.breakdown, /2d8/, 'the bonus is on the blow');
    assert.equal(status(nap, 'gamble_bonus'), undefined, 'and it is spent');
    forceD20(15, 5);
    assert.doesNotMatch(L.resolveAttack(nap, ras, '1d6').breakdown, /2d8/);
  }
});

test('Destiny Gamble on a 6 makes the next attack a sure hit and a critical', async () => {
  const { nap, ras } = await napFight();
  toTurn('Napo');
  forceD6(6);
  L.handleCastAbility(nap.id, 'Destiny Gamble', [nap.id]);
  assert.ok(status(nap, 'destiny_crit'));
  forceD20(3, 19);   // the dice alone would miss
  const r = L.resolveAttack(nap, ras, '1d6');
  assert.equal(r.hit, true);
  assert.equal(r.crit, true);
  assert.ok(r.bonusMult >= 2, 'the dice are doubled');
  assert.equal(status(nap, 'destiny_crit'), undefined, 'spent');
});

// ── Dual Wielder ───────────────────────────────────────────────────────────

const strikes = who => logText().filter(t => new RegExp(String.raw`^${who}\S* (hits|misses) `).test(t));

test('Dual Wielder swings a second time when the first blow lands', async () => {
  const { nap, ras } = await napFight();
  toTurn('Napo');
  forceD20(15, 5, 15, 5);
  L.handleAttack(nap.id, ras.id);
  if (S.awaitingReact) settleReacts(() => null);
  assert.equal(strikes('Napo').length, 2, 'two blows');
});

test('Dual Wielder does not swing again after a miss', async () => {
  const { nap, ras } = await napFight();
  toTurn('Napo');
  forceD20(5, 15);
  L.handleAttack(nap.id, ras.id);
  if (S.awaitingReact) settleReacts(() => null);
  assert.equal(strikes('Napo').length, 1);
});

test('Dual Wielder is two blows at most, and others get one', async () => {
  const { nap, ras } = await napFight();
  toTurn('Napo');
  forceD20(15, 5, 15, 5, 15, 5);
  L.handleAttack(nap.id, ras.id);
  if (S.awaitingReact) settleReacts(() => null);
  assert.equal(strikes('Napo').length, 2);
  toTurn('Ras');
  forceD20(15, 5, 15, 5);
  L.handleAttack(ras.id, nap.id);
  if (S.awaitingReact) settleReacts(() => null);
  assert.equal(strikes('Ras').length, 1);
});

// ── Djinn's Luck ───────────────────────────────────────────────────────────

test('Djinn\'s Luck rerolls a 1 on Napoléon\'s defense', async () => {
  const { nap, ras } = await napFight();
  forceD20(15, 1, 12);
  const r = L.resolveAttack(ras, nap, '1d6');
  assert.equal(r.defRoll, 12);
  assert.ok(logText().some(t => /Djinn's Luck/.test(t)));
});

test('Djinn\'s Luck rerolls a 1 on Napoléon\'s attack', async () => {
  const { nap, ras } = await napFight();
  forceD20(1, 14, 5);
  const r = L.resolveAttack(nap, ras, '1d6');
  assert.equal(r.atkRoll, 14);
  assert.equal(r.fumble, false);
});

test('Djinn\'s Luck works once per turn, and comes back with the next one', async () => {
  const { nap, ras } = await napFight();
  toTurn('Napo');
  forceD20(15, 1, 12);
  assert.equal(L.resolveAttack(ras, nap, '1d6').defRoll, 12);
  forceD20(15, 1, 12);
  assert.equal(L.resolveAttack(ras, nap, '1d6').defRoll, 1, 'the second 1 stands');
  L.handlePass();
  toTurn('Napo');
  forceD20(15, 1, 12);
  assert.equal(L.resolveAttack(ras, nap, '1d6').defRoll, 12, 'a new turn, a new reroll');
});

test('nobody else rerolls a 1', async () => {
  const { nap, ras } = await napFight();
  forceD20(1, 12);
  assert.equal(L.resolveAttack(ras, nap, '1d6').atkRoll, 1);
});
