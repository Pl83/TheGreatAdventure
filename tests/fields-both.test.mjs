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
const pass = () => { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); };
const toTurn = name => {
  for (let i = 0; i < 80 && !L.activeCombatant().name.startsWith(name); i++) pass();
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
const has = (c, name) => c.statusEffects.some(e => e.name.toLowerCase() === name);
const ALWAYS = () => 0.999;
const MIDDLE = () => 0.5;

// Meï, her ally Kadgar (wounded and burning) and the foe Ras stand close; Kay is far off
async function setup(seed = 1) {
  await newFight({ teamA: ['Meï', 'Kadgar'], teamB: ['Ras', 'Kay Climber'], seed });
  const mei = byName('Meï'), ally = byName('Kadgar'), ras = byName('Ras'), kay = byName('Kay Climber');
  toTurn('Meï');
  const spot = freeRun(8);
  place(mei, spot.x, spot.y);
  place(ally, spot.x + 1, spot.y);
  place(ras, spot.x + 3, spot.y);
  place(kay, spot.x + 8, spot.y);
  mei.ki = mei.maxKi = 99;
  ally.currentHp = ally.maxHp - 30;
  L.applyStatus(ally, 'burn');
  return { mei, ally, ras, kay };
}
function cast(mei, name, on) {
  L.handleCastAbility(mei.id, name, [on.id]);
  if (S.awaitingReact) settleReacts(() => null);
}

test('Field of Flower is a field of allies: it heals and cleanses those inside at the cast', async () => {
  const { mei, ally, ras } = await setup();
  setRandom(MIDDLE);
  ras.currentHp -= 20;
  L.applyStatus(ras, 'burn');
  const hp = ally.currentHp, rasHp = ras.currentHp;
  cast(mei, 'Field of Flower', mei);
  assert.equal(S.fields.length, 1);
  assert.equal(S.fields[0].roundsLeft, 5);
  assert.equal(ally.currentHp - hp, 10, 'the ally gains 10');
  assert.ok(!has(ally, 'burn'), 'and loses the burn');
  assert.equal(ras.currentHp, rasHp, 'a foe is not healed');
  assert.ok(has(ras, 'burn'), 'nor cleansed');
});

test('it works again at the start of each turn of the allies inside, once per round', async () => {
  const { mei, ally } = await setup();
  setRandom(MIDDLE);
  cast(mei, 'Field of Flower', mei);
  ally.currentHp = ally.maxHp - 30;
  L.applyStatus(ally, 'poison');
  const round = S.roundNumber;
  toTurn('Kadgar');
  if (S.roundNumber === round) pass(), toTurn('Kadgar');
  assert.equal(ally.currentHp, ally.maxHp - 23, 'ten back at the start of its turn, after the poison tick of 3');
  assert.ok(!has(ally, 'poison'));
  const heals = logText().filter(t => /Kadgar.*recovers 10 HP/.test(t)).length;
  const before = ally.currentHp;
  for (let i = 0; i < 3 && L.activeCombatant().name.startsWith('Kadgar'); i++) pass();
  assert.ok(heals >= 1 && ally.currentHp >= before);
});

test('an ally outside the field is not touched', async () => {
  const { mei, ally } = await setup();
  setRandom(MIDDLE);
  place(ally, mei.x + 10, mei.y);
  const hp = ally.currentHp;
  cast(mei, 'Field of Flower', mei);
  assert.ok(ally.currentHp <= hp, 'only the burn touched it');
  assert.ok(has(ally, 'burn'));
});

test('Meï can keep both fields up: each works on its own side and they fade on their own', async () => {
  const { mei, ally, ras } = await setup();
  setRandom(ALWAYS);
  cast(mei, 'Field of Corruption', ras);
  toTurn('Meï');
  cast(mei, 'Field of Flower', mei);
  assert.deepEqual(S.fields.map(f => f.name).sort(), ['Field of Corruption', 'Field of Flower']);
  assert.ok(has(ras, 'para') && has(ras, 'burn'), 'the foe is corrupted');
  assert.ok(!logText().some(t => /Ras.*recovers/.test(t)), 'and not healed');
  assert.ok(!has(ally, 'para') && !has(ally, 'poison'), 'the ally is not corrupted');
  assert.ok(!has(ally, 'burn'), 'but is cleansed');
  const flower = S.fields.find(f => f.name === 'Field of Flower');
  const corruption = S.fields.find(f => f.name === 'Field of Corruption');
  assert.equal(corruption.roundsLeft - flower.roundsLeft, -1, 'the Flower was raised a round later and lasts a round longer');
  for (let i = 0; i < 200 && S.fields.some(f => f.name === 'Field of Corruption'); i++) pass();
  assert.deepEqual(S.fields.map(f => f.name), ['Field of Flower'], 'the older field fades first');
  assert.ok(logText().some(t => /Field of Corruption fades/.test(t)));
});

test('casting the same field again replaces it instead of piling up', async () => {
  const { mei } = await setup();
  setRandom(MIDDLE);
  cast(mei, 'Field of Flower', mei);
  toTurn('Meï');
  mei.ki = 99;
  cast(mei, 'Field of Flower', mei);
  assert.equal(S.fields.length, 1);
  assert.equal(S.fields[0].roundsLeft, 5, 'with a fresh duration');
});

test('the map and the panel show both fields in their own colour', async () => {
  const { mei, ras } = await setup();
  setRandom(ALWAYS);
  cast(mei, 'Field of Corruption', ras);
  toTurn('Meï');
  cast(mei, 'Field of Flower', mei);
  const R = await import('../js/field-strip.js');
  assert.deepEqual([...new Set(S.fields.map(f => f.kind))].sort(), ['foes', 'allies'].sort());
  const html = R.fieldStripHTML();
  assert.match(html, /Field of Corruption/);
  assert.match(html, /Field of Flower/);
  assert.match(html, /field-foes/);
  assert.match(html, /field-allies/);
});
