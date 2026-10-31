import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const CHRONOS = 'Chronos, Monarch of Time';
const roster = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const sheet = roster.find(c => c.nom === CHRONOS);

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
const ability = (c, name) => c.abilities.find(a => a.name === name);
const logText = () => S.log.map(e => e.text).join('\n');

// The next d20s come out as `values`; then every die lands in the middle
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };

async function duel(foe, seed = 1) {
  await newFight({ teamA: [CHRONOS], teamB: [foe], seed });
  const x = byName('Chronos'), y = byName(foe);
  const spot = freeRun(5);
  place(x, spot.x, spot.y);
  place(y, spot.x + 1, spot.y);
  toTurn('Chronos');
  return { x, y };
}

// ── The sheet ──────────────────────────────────────────────────────────────

test('Chronos is on the roster as a primordial god: Authority 9, immune to status, a Complet domain', () => {
  assert.ok(sheet, 'he is in characters.json');
  assert.equal(sheet.autority, 9);
  assert.deepEqual(sheet.immunities, ['status']);
  assert.ok(sheet.passif.some(p => p.authorityGate === 9), 'his status immunity gives way to Authority 9 only');
  assert.equal(sheet.domain.name, 'Chronostasis');
  assert.equal(sheet.domain.type, 'Complet');
  assert.equal(sheet.domain.rafinement, 7);
});

test('Archive of Ibis gives advantage on attack rolls, spell rolls and defense rolls', () => {
  const p = sheet.passif.find(q => q.nom === 'Archive of Ibis');
  assert.ok(p.tags.includes('adv'));
  assert.deepEqual([...p.applyOn].sort(), ['atkRoll', 'defRoll', 'magicRoll']);
});

test('the four gods he took are in his kit, none of them by name', () => {
  const text = JSON.stringify(sheet).toLowerCase();
  for (const god of ['norn', 'thoth', 'kala', 'janus']) assert.ok(!text.includes(god), god);
  for (const move of ['Three Threads', 'Withering Hour', 'Two-Faced Door']) assert.ok(sheet.moveSet.some(m => m.base.nom === move), move);
  assert.equal(sheet.moveSet.find(m => m.base.nom === 'Three Threads').charges, 3, 'one thread per Norn');
});

// ── Stasis ─────────────────────────────────────────────────────────────────

test('Stasis stuns Hela despite her status immunity, because Authority 9 beats her gate of 8', async () => {
  const { x, y } = await duel('Hela, Goddess of Death');
  forceD20(19, 19, 2);
  L.handleCastAbility(x.id, 'Stasis', [y.id]);
  settle();
  assert.ok(y.statusEffects.some(e => e.name.toLowerCase() === 'stun'), logText());
});

// ── Withering Hour ─────────────────────────────────────────────────────────

test('Withering Hour poisons the target and arms Chronos: his landed basic attacks then cut max HP, and the cuts stack', async () => {
  const { x, y } = await duel('White');
  forceD20(19, 19, 2);
  L.handleCastAbility(x.id, 'Withering Hour', [y.id]);
  settle();
  assert.ok(x.statusEffects.some(e => e.name === 'withering'), 'Chronos is armed');
  assert.ok(y.statusEffects.some(e => /toxic/i.test(e.name)), 'the target is poisoned');
  const max0 = y.maxHp;
  for (let n = 1; n <= 2; n++) {
    toTurn('Chronos');
    x.statusEffects.find(e => e.name === 'withering').turnsLeft = 3;
    forceD20(19, 19, 2);
    L.handleAttack(x.id, y.id);
    settle();
    assert.equal(y.maxHp, max0 - 25 * n, `after hit ${n}`);
    assert.ok(y.currentHp <= y.maxHp);
  }
});

test('without Withering Hour a basic attack leaves max HP alone', async () => {
  const { x, y } = await duel('Kaelgrym');
  const max0 = y.maxHp;
  forceD20(19, 19, 2);
  L.handleAttack(x.id, y.id);
  settle();
  assert.equal(y.maxHp, max0);
  assert.ok(y.currentHp < max0, 'but the hit landed');
});

// ── Hand of the Hour ───────────────────────────────────────────────────────

test('his basic attack walks through Hela\'s Weapon Wall', async () => {
  const { x, y } = await duel('Hela, Goddess of Death');
  y.statusEffects.push({ name: 'damage_shield', shieldHp: 40, turnsLeft: 5, dice: null, damType: null, notes: '' });
  const before = y.currentHp;
  forceD20(19, 19, 19, 2, 2);   // Death Presence makes the first attack clumsy, so give it plenty of good dice
  L.handleAttack(x.id, y.id);
  settle();
  const shield = y.statusEffects.find(e => e.name === 'damage_shield');
  assert.equal(shield?.shieldHp, 40, 'the wall is untouched');
  assert.ok(y.currentHp < before, logText());
});

// ── Rewind ─────────────────────────────────────────────────────────────────

test('a killing blow sends Chronos back: HP restored, hindrances undone, once per fight', async () => {
  const { x } = await duel('Kaelgrym');
  x.statusEffects.push({ name: 'burn', turnsLeft: 3, dice: '1d4', damType: 'fire', notes: '' });
  L.applyDamage(x, 10000, 'physical', ['physical'], true);
  assert.equal(x.isKO, false, 'he stands');
  assert.ok(x.currentHp >= 200, `HP ${x.currentHp}`);
  assert.equal(x.statusEffects.length, 0, 'the burning is undone');
  assert.ok(x.usedThisFight.includes('Rewind'));
  L.applyDamage(x, 10000, 'physical', ['physical'], true);
  assert.equal(x.isKO, true, 'the second death is final');
});

test('Rewind returns him to where he stood two rounds ago, when that cell is free', async () => {
  const { x } = await duel('Kaelgrym');
  x.trail = [{ hp: 400, x: x.x - 1, y: x.y }, { hp: 300, x: x.x, y: x.y }];
  const home = { x: x.x - 1, y: x.y };
  L.applyDamage(x, 10000, 'physical', ['physical'], true);
  assert.deepEqual({ x: x.x, y: x.y }, home);
  assert.equal(x.currentHp, 400);
});

test('Rewind is not a move to cast, and Borrowed Time is not a reaction', async () => {
  const { x } = await duel('Kaelgrym');
  assert.equal(ability(x, 'Rewind').reactOnly, true);
  assert.ok(ability(x, 'Rewind').tags.includes('onDeath'));
  assert.ok(ability(x, 'Borrowed Time').tags.includes('extraAction'));
});

// ── Borrowed Time ──────────────────────────────────────────────────────────

test('Borrowed Time gives the action back after he has acted, and only once', async () => {
  const { x, y } = await duel('Kaelgrym');
  S.hasActed = true;   // he has already acted this turn
  L.handleCastAbility(x.id, 'Borrowed Time', [x.id]);
  settle();
  assert.equal(S.hasActed, false, 'and may act again');
  assert.ok(x.usedThisFight.includes('Borrowed Time'));
  assert.ok(!L.abilityAvailable(x, ability(x, 'Borrowed Time')), 'once per fight');
});

// ── The round trail ────────────────────────────────────────────────────────

test('each new round records where every unit stands, two rounds deep', async () => {
  const { x } = await duel('Kaelgrym');
  const startRound = S.roundNumber;
  while (S.roundNumber < startRound + 3) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  assert.equal(x.trail.length, 2);
  assert.ok(x.trail.every(t => Number.isInteger(t.hp) && Number.isInteger(t.x)));
});
