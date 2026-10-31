import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
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
const ability = (c, name) => c.abilities.find(a => a.name === name);

// The next d20s come out as `values`; then every die lands in the middle
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}

async function fight(a, b, seed = 1) {
  await newFight({ teamA: [a], teamB: [b], seed });
  const x = byName(a), y = byName(b);
  const spot = freeRun(5);
  place(x, spot.x, spot.y);
  place(y, spot.x + 2, spot.y);
  return { x, y };
}

// ── magicRoll: Kadgar's passives ───────────────────────────────────────────

test('Kadgar\'s spells carry Archmage, Great Staff and Runik Mage on top of their dice', async () => {
  const { x: kadgar, y: ras } = await fight('Kadgar', 'Ras');
  toTurn('Kadgar');
  forceD20(15, 5);
  L.handleCastAbility(kadgar.id, 'Arcane Missile', [ras.id]);
  if (S.awaitingReact) L.resumePendingAction(null);
  const text = logText().join('\n');
  for (const nom of ['Archmage', 'Great Staff', 'Runik Mage']) assert.match(text, new RegExp(nom), `${nom} is in the breakdown`);
});

test('the same bonuses reach an area spell, and a basic attack gets none of them', async () => {
  const { x: kadgar, y: ras } = await fight('Kadgar', 'Ras');
  toTurn('Kadgar');
  forceD20(15, 5);
  L.handleCastAbility(kadgar.id, 'Thunder Storm', [ras.id], { x: ras.x, y: ras.y });
  for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo();
  assert.match(logText().join('\n'), /Archmage/, 'the area spell carries Archmage');

  const before = S.log.length;
  forceD20(15, 5);
  const r = L.resolveAttack(kadgar, ras, '1d6');
  assert.ok(!/Archmage/.test(r.breakdown), 'a physical blow is no spell roll');
  assert.equal(S.log.length >= before, true);
});

test('Great Staff turns a natural 1 on a spell into a 2, three times a fight', async () => {
  const { x: kadgar, y: ras } = await fight('Kadgar', 'Ras');
  for (let i = 1; i <= 3; i++) {
    forceD20(1, 1, 5);
    const r = L.resolveAttack(kadgar, ras, '1d6', ability(kadgar, 'Arcane Missile'));
    assert.equal(r.fumble, false, `the ${i}th fumble is turned away`);
  }
  forceD20(1, 1, 5);
  const fourth = L.resolveAttack(kadgar, ras, '1d6', ability(kadgar, 'Arcane Missile'));
  assert.equal(fourth.fumble, true, 'the staff is spent');
});

// ── Authority against Anti-Magic ───────────────────────────────────────────

const HELA = 'Hela, Goddess of Death';

test('Hela shrugs off a spell from someone with Authority below 8', async () => {
  const { x: kadgar, y: hela } = await fight('Kadgar', HELA);
  const hp = hela.currentHp;
  L.applyDamage(hela, 40, 'lightning', ['magic', 'lightning']);
  assert.ok(hela.currentHp >= hp - 20, 'the magic half is turned away');
  const pure = hela.currentHp;
  L.applyDamage(hela, 40, null, ['magic']);
  assert.equal(hela.currentHp, pure, 'a pure spell does nothing');
  assert.ok(kadgar);
});

test('a physical blow still hurts her', async () => {
  const { y: hela } = await fight('Kadgar', HELA);
  const hp = hela.currentHp;
  L.applyDamage(hela, 10, 'physical', ['physical']);
  assert.ok(hela.currentHp < hp);
});

test('a status from Authority below 8 is turned away', async () => {
  const { y: hela } = await fight('Kadgar', HELA);
  L.applyStatus(hela, 'stun');
  assert.ok(!hela.statusEffects.some(e => e.name === 'stun'), 'no stun from Authority 0');
});

test('an Authority 8 relic pierces Anti-Magic: Hela\'s Balmung hurts Hela in full', async () => {
  await newFight({ teamA: [HELA], teamB: [HELA], seed: 3 });
  const [a, b] = S.combatants;
  const spot = freeRun(5);
  place(a, spot.x, spot.y);
  place(b, spot.x + 1, spot.y);
  const balmung = ability(a, 'Balmung (Sealed)');
  assert.equal(balmung.authority, 8);
  toTurn(a.name);
  const act = L.activeCombatant();
  const foe = S.combatants.find(c => c.teamIndex !== act.teamIndex);
  const hp = foe.currentHp;
  forceD20(15, 5);
  L.handleCastAbility(act.id, 'Balmung (Sealed)', [foe.id]);
  for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo();
  assert.ok(foe.currentHp < hp, 'the blow landed');
  assert.ok(logText().some(t => /pierces .*Anti-Magic/.test(t)), 'and the log says why');
});
