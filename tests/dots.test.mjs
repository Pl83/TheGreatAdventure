import { test } from 'node:test';
import assert from 'node:assert/strict';
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
const logText = () => S.log.map(e => e.text);
const named = (c, name) => c.statusEffects.filter(e => e.name.toLowerCase() === name);
const MIDDLE = () => 0.5;   // every die lands in the middle: 1d4 = 3, 2d4 = 6

async function duel(attacker = 'Ras', target = 'Kay Climber', seed = 1) {
  await newFight({ teamA: [attacker], teamB: [target], seed });
  return { a: S.combatants[0], t: S.combatants[1] };
}

// ── The table ──────────────────────────────────────────────────────────────

test('the status table: Poison and Toxic, Burn and Calcinated, Bleed and Hemoragie', () => {
  const row = n => L.findEffect(n);
  assert.deepEqual([row('Burn').dice, row('Burn').type], ['1d4', 'fire']);
  assert.deepEqual([row('Calcinated').dice, row('Calcinated').type], ['2d4', 'fire']);
  assert.deepEqual([row('Poison').dice, row('Poison').type], ['1d4', 'poison']);
  assert.deepEqual([row('Toxic').dice, row('Toxic').type], ['2d4', 'poison']);
  assert.deepEqual([row('Bleed').dice, row('Bleed').type], ['1d4', 'physical']);
  assert.deepEqual([row('Hemoragie').dice, row('Hemoragie').type], ['2d4', 'physical']);
  assert.equal(row('Toxic shock'), null, 'the old name is gone');
});

// ── Duration and damage each turn ──────────────────────────────────────────

for (const [name, turns, dice] of [['burn', 3, 'Burn'], ['poison', 3, 'Poison'], ['calcinated', 5, 'Calcinated'], ['toxic', 5, 'Toxic']]) {
  test(`${name} deals damage at the start of each of the target's turns, for ${turns} turns`, async () => {
    const { t } = await duel();
    setRandom(MIDDLE);
    L.applyStatus(t, name);
    for (let i = 0; i < 60 && named(t, name).length; i++) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
    assert.equal(named(t, name).length, 0, 'it wore off');
    const ticks = logText().filter(x => new RegExp(`Kay Climber takes \\d+ \\S+ from ${dice}`).test(x));
    assert.equal(ticks.length, turns);
  });
}

for (const [name, turns] of [['bleed', 3], ['hemoragie', 5]]) {
  test(`${name} deals nothing on its own and lasts ${turns} of the target's turns`, async () => {
    const { t } = await duel();
    setRandom(MIDDLE);
    const hp = t.currentHp;
    L.applyStatus(t, name);
    for (let turn = 1; turn <= turns; turn++) {
      toTurn('Kay');
      assert.equal(named(t, name).length, 1, `still on at the start of turn ${turn}`);
      L.handlePass();
    }
    toTurn('Kay');
    assert.equal(named(t, name).length, 0, 'gone at the next one');
    assert.equal(t.currentHp, hp, 'standing still costs nothing');
  });
}

// ── Bleed and Hemoragie hurt when the target moves ─────────────────────────

// Kay's turn with `effect` on, and a reachable cell exactly `steps` away
function moveSetup(effect, steps) {
  const kay = toTurn('Kay');
  L.applyStatus(kay, effect);
  L.enterMoveMode();
  const cell = [...S.reachableCells].find(([k, d]) => d === steps && !L.isOccupied(...k.split(',').map(Number), kay.id));
  assert.ok(cell, `a cell ${steps} steps away`);
  const [x, y] = cell[0].split(',').map(Number);
  return { kay, x, y };
}

test('Bleed costs 1d4 once for a move, however far it goes', async () => {
  await duel();
  setRandom(MIDDLE);
  const { kay, x, y } = moveSetup('bleed', 4);
  const hp = kay.currentHp;
  L.handleMoveClick(x, y);
  assert.equal(hp - kay.currentHp, 3);
  assert.equal(logText().filter(t => /Kay Climber bleeds/.test(t)).length, 1);
});

test('Hemoragie costs 2d4 for every cell walked', async () => {
  await duel();
  setRandom(MIDDLE);
  const { kay, x, y } = moveSetup('hemoragie', 4);
  const hp = kay.currentHp;
  L.handleMoveClick(x, y);
  assert.equal(hp - kay.currentHp, 24, '4 cells of 2d4 (6)');
});

test('stacked bleeds and hemoragies each take their share of the move', async () => {
  await duel();
  setRandom(MIDDLE);
  const { kay, x, y } = moveSetup('bleed', 2);
  L.applyStatus(kay, 'bleed');
  L.applyStatus(kay, 'hemoragie');
  const hp = kay.currentHp;
  L.handleMoveClick(x, y);
  assert.equal(hp - kay.currentHp, 3 + 3 + 12, 'two bleeds and 2 cells of hemoragie');
});

test('a unit that does not move is not hurt by bleeding', async () => {
  await duel();
  setRandom(MIDDLE);
  const kay = toTurn('Kay');
  L.applyStatus(kay, 'bleed');
  L.applyStatus(kay, 'hemoragie');
  const hp = kay.currentHp;
  L.handlePass();
  assert.equal(kay.currentHp, hp);
});

// ── Stacking ───────────────────────────────────────────────────────────────

test('dots stack: a second burn is a second copy, with its own damage and its own timer', async () => {
  const { t } = await duel();
  setRandom(MIDDLE);
  L.applyStatus(t, 'burn');
  L.applyStatus(t, 'burn');
  assert.equal(named(t, 'burn').length, 2);
  const hp = t.currentHp;
  toTurn('Kay');
  assert.equal(hp - t.currentHp, 6, 'two ticks of 1d4 (3 each)');
  // a copy added later expires later: two ticks in, a third burn joins the two that have one tick left
  L.handlePass(); toTurn('Kay');
  L.applyStatus(t, 'burn');
  assert.equal(named(t, 'burn').length, 3);
  L.handlePass(); toTurn('Kay');
  assert.equal(named(t, 'burn').length, 1, 'the first two wore off, the late one has two ticks left');
});

test('stacked poisons and calcinated tick together', async () => {
  const { t } = await duel();
  setRandom(MIDDLE);
  L.applyStatus(t, 'poison');
  L.applyStatus(t, 'poison');
  L.applyStatus(t, 'calcinated');
  const hp = t.currentHp;
  toTurn('Kay');
  assert.equal(hp - t.currentHp, 3 + 3 + 6);
});

// ── Wet puts out burning ───────────────────────────────────────────────────

test('becoming wet puts out every Burn but not Calcinated', async () => {
  const { t } = await duel();
  L.applyStatus(t, 'burn');
  L.applyStatus(t, 'burn');
  L.applyStatus(t, 'calcinated');
  L.applyStatus(t, 'wet');
  assert.equal(named(t, 'burn').length, 0);
  assert.equal(named(t, 'calcinated').length, 1);
  assert.ok(logText().some(x => /puts out/i.test(x)));
});

// ── Immunities ─────────────────────────────────────────────────────────────

test('mecha are immune to Bleed and Hemoragie, a Zane in Dragon Form is not', async () => {
  for (const mecha of ['Pixal', 'Future Zane', 'Zane Climber']) {
    const { t } = await duel('Ras', mecha);
    L.applyStatus(t, 'bleed');
    L.applyStatus(t, 'hemoragie');
    assert.equal(t.statusEffects.length, 0, `${mecha} cannot bleed`);
  }
  const { t } = await duel('Ras', 'Zane Climber');
  t.isTransformed = true;
  L.applyStatus(t, 'bleed');
  assert.equal(named(t, 'bleed').length, 1, 'no longer a machine');
});

test('a mecha still burns and is poisoned', async () => {
  const { t } = await duel('Ras', 'Pixal');
  L.applyStatus(t, 'burn');
  L.applyStatus(t, 'poison');
  assert.equal(t.statusEffects.length, 2);
});

test('an immunity to a dot covers its upgrade: poison covers Toxic, bleed covers Hemoragie', async () => {
  const { t } = await duel('Ras', 'Kaelgrym');
  assert.ok(t.sourceChar.immunities.includes('poison'), 'the immunity is written poison now');
  L.applyStatus(t, 'poison');
  L.applyStatus(t, 'toxic');
  assert.equal(t.statusEffects.length, 0);
  t.sourceChar = { ...t.sourceChar, immunities: ['bleed'] };
  L.applyStatus(t, 'hemoragie');
  assert.equal(t.statusEffects.length, 0);
});

// ── Moves apply the right dot ──────────────────────────────────────────────

test('a poison tag applies Poison, not Toxic', async () => {
  const { t } = await duel();
  L.applyMoveEffect({ effect: 'poison', tags: [] }, t);
  assert.equal(named(t, 'poison').length, 1);
  assert.equal(named(t, 'toxic').length, 0);
});
