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
const has = (c, name) => c.statusEffects.some(e => e.name.toLowerCase() === name);
const ALWAYS = () => 0.999;   // every 1dN comes up N: the effect lands
const NEVER  = () => 0.001;   // every 1dN comes up 1: the effect is resisted

// Meï stands on a free run with Ras three cells away; Kay is far off and an ally (Kadgar) stands beside Meï
async function setup(seed = 1, rng = null) {
  await newFight({ teamA: ['Meï', 'Kadgar'], teamB: ['Ras', 'Kay Climber'], seed });
  const mei = byName('Meï'), ally = byName('Kadgar'), ras = byName('Ras'), kay = byName('Kay Climber');
  toTurn('Meï');
  const spot = freeRun(8);
  place(mei, spot.x, spot.y);
  place(ras, spot.x + 3, spot.y);
  place(ally, spot.x + 4, spot.y);
  place(kay, spot.x + 8, spot.y);
  mei.ki = mei.maxKi = 99;
  if (rng) setRandom(rng);
  return { mei, ally, ras, kay };
}
function cast(mei, ras) {
  L.handleCastAbility(mei.id, 'Field of Corruption', [ras.id]);
  if (S.awaitingReact) settleReacts(() => null);
}

test('Field of Corruption raises a field that lasts five rounds, costs the ki and ends the turn', async () => {
  const { mei, ras } = await setup(1, NEVER);
  const ki = mei.ki, serial = S.turnSerial, hp = ras.currentHp;
  cast(mei, ras);
  assert.equal(S.fields.length, 1);
  assert.equal(S.fields[0].casterId, mei.id);
  assert.equal(S.fields[0].roundsLeft, 5);
  assert.equal(ki - mei.ki, 10);
  assert.notEqual(S.turnSerial, serial, 'the turn ended');
  assert.equal(ras.currentHp, hp, 'a field deals no damage');
});

test('the foes inside meet the field at once, each effect on its own 1d2', async () => {
  const { mei, ras } = await setup(1, ALWAYS);
  cast(mei, ras);
  for (const name of ['para', 'poison', 'burn', 'bleed']) assert.ok(has(ras, name), `${name} lands on a 2`);
  const { mei: m2, ras: r2 } = await setup(1, NEVER);
  cast(m2, r2);
  for (const name of ['para', 'poison', 'burn', 'bleed']) assert.ok(!has(r2, name), `${name} is resisted on a 1`);
  assert.ok(has(r2, 'hindered_atk'), 'the disadvantage on attacks is its own 1d2');
});

test('the four effects are independent and each lands about half the time, bleed included', async () => {
  const seen = { para: 0, poison: 0, burn: 0, bleed: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const { mei, ras } = await setup(seed);
    cast(mei, ras);
    for (const name of Object.keys(seen)) if (has(ras, name)) seen[name]++;
  }
  for (const [name, n] of Object.entries(seen)) assert.ok(n > 6 && n < 34, `${name} ${n}/40`);
});

test('only foes inside the field are touched', async () => {
  const { mei, ally, ras, kay } = await setup(1, ALWAYS);
  cast(mei, ras);
  assert.ok(has(ras, 'para'));
  assert.ok(!has(kay, 'para'), 'a foe far outside is untouched');
  assert.ok(!has(ally, 'para') && !has(ally, 'burn'), 'an ally inside is untouched');
});

test('a foe that stays in the field is exposed again at the start of each of its turns', async () => {
  const { mei, ras } = await setup(1, NEVER);
  cast(mei, ras);
  const castRound = S.roundNumber;
  assert.ok(!has(ras, 'para'));
  setRandom(ALWAYS);
  for (let i = 0; i < 80 && S.roundNumber < castRound + 2; i++) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  assert.ok(has(ras, 'para'), 'a turn later the field has caught it');
});

test('each foe rolls once per round at most, five times in all, then the field fades', async () => {
  const { mei, ras } = await setup(1, NEVER);
  cast(mei, ras);
  for (let i = 0; i < 160 && S.fields.length > 0; i++) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  assert.equal(S.fields.length, 0, 'the field is gone');
  assert.equal(logText().filter(t => /Ras resists para/.test(t)).length, 5);
  assert.ok(logText().some(t => /Field of Corruption fades/.test(t)));
});

test('a foe that walks out of the field is no longer exposed', async () => {
  const { mei, ras } = await setup(1, NEVER);
  cast(mei, ras);
  const { x, y } = S.fields[0];
  place(ras, x + 9, y);
  for (let i = 0; i < 160 && S.fields.length > 0; i++) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  assert.equal(logText().filter(t => /Ras resists para/.test(t)).length, 1, 'only the first exposure');
});
