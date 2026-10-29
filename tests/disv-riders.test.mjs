import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { settleReacts } = await import('../js/ai/apply.js');
const { setRandom, mulberry32 } = await import('../js/rng.js');
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
const has = (c, name) => c.statusEffects.some(e => e.name === name);

// The next d20s come out as `values`; then every die lands in the middle
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}

// `caster` casts `move` on Ras and cannot miss (a sure-hit), so the rider is the only thing in question
async function castOnRas(caster, move, seed = 1) {
  await newFight({ teamA: [caster], teamB: ['Ras'], seed });
  const me = byName(caster.split(',')[0]), ras = byName('Ras');
  toTurn(caster.split(',')[0]);
  const spot = freeRun(6);
  place(me, spot.x, spot.y);
  place(ras, spot.x + 3, spot.y);
  me.spellSlots = me.maxSpellSlots = 9;
  me.statusEffects.push({ name: 'sure_hit', turnsLeft: 2, dice: null, damType: null, notes: '' });
  L.handleCastAbility(me.id, move, [ras.id]);
  if (S.awaitingReact) settleReacts(() => null);
  return { me, ras };
}

// ── Moves that leave their targets at disadvantage for a turn ──────────────

for (const [who, move] of [
  ['Vorrakan Duskbane', 'Earthquake'], ['Cole Climber', 'Quake Wave'], ['Morrow', 'Wind Tornado'],
  ['MaracachaCoocaracha', 'Vicious Mockery'], ['Jay, Azure Dragon', 'Azure Dragon Roar'],
]) {
  test(`${move} leaves its target rolling with disadvantage`, async () => {
    const { ras } = await castOnRas(who, move);
    assert.ok(has(ras, 'hindered'), 'the target is hindered');
  });
}

test('a hindered unit rolls its attack and its defense twice and keeps the worse', async () => {
  const { ras } = await castOnRas('Morrow', 'Wind Tornado');
  const me = byName('Morrow');
  forceD20(15, 4, 12);   // Ras attacks: 15 & 4 kept 4; Morrow defends: 12
  const r = L.resolveAttack(ras, me, '1d6');
  assert.equal(r.atkRoll, 4);
  forceD20(15, 14, 3);   // Morrow attacks Ras: 15; Ras defends with 14 & 3
  const back = L.resolveAttack(me, ras, '1d6');
  assert.equal(back.defRoll, 3, 'the defense takes the lower of 14 and 3');
  assert.ok(logText().some(t => /Disadvantage \(Ras\)/.test(t)));
});

test('the disadvantage lasts one of the target\'s turns and no longer', async () => {
  const { ras } = await castOnRas('Morrow', 'Wind Tornado');
  toTurn('Ras');
  assert.ok(has(ras, 'hindered'), 'still on during its turn');
  L.handlePass();
  toTurn('Ras');
  assert.ok(!has(ras, 'hindered'), 'gone by the turn after');
});

test('a second cast refreshes the disadvantage instead of stacking it', async () => {
  const { me, ras } = await castOnRas('Morrow', 'Wind Tornado');
  toTurn('Morrow');
  me.statusEffects.push({ name: 'sure_hit', turnsLeft: 2, dice: null, damType: null, notes: '' });
  L.handleCastAbility(me.id, 'Wind Tornado', [ras.id]);
  if (S.awaitingReact) settleReacts(() => null);
  assert.equal(ras.statusEffects.filter(e => e.name === 'hindered').length, 1);
});

test('a warded target is not hindered', async () => {
  await newFight({ teamA: ['Morrow'], teamB: ['Ras'], seed: 1 });
  const me = byName('Morrow'), ras = byName('Ras');
  toTurn('Morrow');
  const spot = freeRun(6);
  place(me, spot.x, spot.y); place(ras, spot.x + 3, spot.y);
  ras.statusEffects.push({ name: 'ward', turnsLeft: 3, dice: null, damType: null, notes: '' });
  me.statusEffects.push({ name: 'sure_hit', turnsLeft: 2, dice: null, damType: null, notes: '' });
  L.handleCastAbility(me.id, 'Wind Tornado', [ras.id]);
  if (S.awaitingReact) settleReacts(() => null);
  assert.ok(!has(ras, 'hindered'));
});

test('a target that evades the area is not hindered', async () => {
  await newFight({ teamA: ['Morrow'], teamB: ['Ras'], seed: 1 });
  const me = byName('Morrow'), ras = byName('Ras');
  toTurn('Morrow');
  const spot = freeRun(6);
  place(me, spot.x, spot.y); place(ras, spot.x + 3, spot.y);
  forceD20(3, 19);   // 19 beats 3 by more than 5: it slips away
  L.handleCastAbility(me.id, 'Wind Tornado', [ras.id]);
  if (S.awaitingReact) settleReacts(() => null);
  assert.ok(!has(ras, 'hindered'));
});

// ── Ice Coffin: the next saving throw ──────────────────────────────────────

test('Ice Coffin makes the next defense roll of its target a disadvantage, and only that roll', async () => {
  const { ras } = await castOnRas('Eragon', 'Ice Coffin');
  const me = byName('Eragon');
  assert.ok(has(ras, 'hindered_def'));
  forceD20(15, 9, 14);   // Ras attacks Eragon: not affected
  L.resolveAttack(ras, me, '1d6');
  assert.ok(has(ras, 'hindered_def'), 'an attack roll does not spend it');
  forceD20(15, 14, 3);   // Eragon attacks Ras: Ras defends with 14 & 3
  const r = L.resolveAttack(me, ras, '1d6');
  assert.equal(r.defRoll, 3);
  assert.ok(!has(ras, 'hindered_def'), 'and the defense roll spends it');
});

// ── Field of Corruption: a 1d2 chance of disadvantage on attacks ───────────

test('Field of Corruption hinders attack rolls only, and only some of the time', async () => {
  let hindered = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const { ras } = await castOnRas('Meï', 'Field of Corruption', seed);
    if (!has(ras, 'hindered_atk')) continue;
    hindered++;
    const me = byName('Meï');
    forceD20(15, 4, 12);   // Ras attacks Meï at disadvantage
    assert.equal(L.resolveAttack(ras, me, '1d6').atkRoll, 4);
    forceD20(15, 9, 14);   // Ras defends Meï's blow: not at disadvantage
    assert.equal(L.resolveAttack(me, ras, '1d6').defRoll, 9);
  }
  assert.ok(hindered > 3 && hindered < 21, `a 1d2 chance (${hindered}/24)`);
});

// ── The old pieces keep working ────────────────────────────────────────────

test('Fire Tornado still lifts disadvantage from allies', async () => {
  await newFight({ teamA: ['Eragon', 'Ras'], teamB: ['Kay Climber'], seed: 1 });
  const eragon = byName('Eragon'), ras = byName('Ras'), kay = byName('Kay Climber');
  toTurn('Eragon');
  const spot = freeRun(6);
  place(eragon, spot.x, spot.y); place(ras, spot.x + 1, spot.y); place(kay, spot.x + 4, spot.y);
  for (const name of ['hindered', 'hindered_atk', 'hindered_def']) ras.statusEffects.push({ name, turnsLeft: 3, dice: null, damType: null, notes: '' });
  eragon.statusEffects.push({ name: 'sure_hit', turnsLeft: 2, dice: null, damType: null, notes: '' });
  L.handleCastAbility(eragon.id, 'Fire Tornado', [kay.id]);
  if (S.awaitingReact) settleReacts(() => null);
  assert.ok(!has(ras, 'hindered') && !has(ras, 'hindered_atk') && !has(ras, 'hindered_def'));
});
