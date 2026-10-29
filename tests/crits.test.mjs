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
  for (let i = 0; i < 60 && !L.activeCombatant().name.startsWith(name); i++) {
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

// The next d20s come out as `values`, in order; after that every die lands in the middle (d20 = 11, d6 = 4)
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}

async function duel(seed = 1) {
  await newFight({ teamA: ['Ras'], teamB: ['Kay Climber'], seed });
  return { ras: byName('Ras'), kay: byName('Kay Climber') };
}

// ── The attack matrix ──────────────────────────────────────────────────────

test('natural 1 against natural 1: the blow is rolled and both take half', async () => {
  const { ras, kay } = await duel();
  forceD20(1, 1);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, true);
  assert.equal(r.mutual, true);
  assert.ok(r.damage > 0);
  assert.equal(r.recoil, r.damage, 'the attacker takes the same half');
  assert.equal(r.freeAction, false);
});

test('natural 1 against natural 20: the attack fails and the defender earns a free action', async () => {
  const { ras, kay } = await duel();
  forceD20(1, 20);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, false);
  assert.equal(r.freeAction, true);
});

test('natural 20 against natural 20: a plain hit with no bonus', async () => {
  const { ras, kay } = await duel();
  forceD20(20, 20);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, true);
  assert.equal(r.bonusMult, 1);
  assert.equal(r.guaranteed, false);
  assert.match(r.breakdown, /1d6/);
  assert.doesNotMatch(r.breakdown, /[24]d6/);
});

test('natural 20 against natural 1: a hit whose dice are rolled four times over', async () => {
  const { ras, kay } = await duel();
  forceD20(20, 1);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, true);
  assert.equal(r.bonusMult, 4);
  assert.equal(r.guaranteed, true);
  assert.match(r.breakdown, /4d6/);
});

test('natural 20 against an ordinary roll: a hit with the dice doubled', async () => {
  const { ras, kay } = await duel();
  forceD20(20, 10);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, true);
  assert.equal(r.bonusMult, 2);
  assert.equal(r.guaranteed, true);
  assert.match(r.breakdown, /2d6/);
});

test('an ordinary roll against a natural 1: a hit with the dice doubled', async () => {
  const { ras, kay } = await duel();
  forceD20(2, 1);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, true);
  assert.equal(r.bonusMult, 2);
  assert.equal(r.guaranteed, true);
  assert.match(r.breakdown, /2d6/);
});

test('natural 1 against an ordinary roll: a miss, and the defender earns a free action', async () => {
  const { ras, kay } = await duel();
  forceD20(1, 10);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, false);
  assert.equal(r.freeAction, true);
});

test('an ordinary roll against a natural 20: a miss, and the defender earns a free action', async () => {
  const { ras, kay } = await duel();
  forceD20(15, 20);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, false);
  assert.equal(r.freeAction, true);
});

test('ordinary rolls still compare, and the attacker wins a tie', async () => {
  const { ras, kay } = await duel();
  forceD20(12, 9);
  const hit = L.resolveAttack(ras, kay, '1d6');
  assert.equal(hit.hit, true);
  assert.equal(hit.bonusMult, 1);
  assert.equal(hit.freeAction, false);
  forceD20(5, 12);
  const miss = L.resolveAttack(ras, kay, '1d6');
  assert.equal(miss.hit, false);
  assert.equal(miss.freeAction, false, 'an ordinary miss gives nothing');
});

test('a sure-hit lands on a natural 20 defense, with no free action for the defender', async () => {
  const { ras, kay } = await duel();
  ras.statusEffects.push({ name: 'sure_hit', turnsLeft: 2, dice: null, damType: null, notes: '' });
  forceD20(12, 20);
  const r = L.resolveAttack(ras, kay, '1d6');
  assert.equal(r.hit, true);
  assert.equal(r.freeAction, false);
});

// ── The 1d2 rider ──────────────────────────────────────────────────────────

test('a guaranteed hit applies a 1d2 effect every time, an ordinary hit only half the time', async () => {
  let ordinary = 0;
  for (let seed = 1; seed <= 40; seed++) {
    await newFight({ teamA: ['Ras'], teamB: ['Kay Climber'], seed });
    const kay = byName('Kay Climber');
    L.applyMoveEffect({ effect: '1d2 burn', tags: [] }, kay, true);
    assert.ok(kay.statusEffects.some(e => e.name.toLowerCase() === 'burn'), `seed ${seed}: guaranteed`);
    kay.statusEffects = [];
    L.applyMoveEffect({ effect: '1d2 burn', tags: [] }, kay);
    if (kay.statusEffects.some(e => e.name.toLowerCase() === 'burn')) ordinary++;
  }
  assert.ok(ordinary > 5 && ordinary < 35, `an ordinary hit lands the rider only sometimes (${ordinary}/40)`);
});

// ── Through the real attack action ─────────────────────────────────────────

const hpOf = c => c.currentHp;

test('a mutual fumble hurts both fighters for the same amount', async () => {
  const { ras, kay } = await duel();
  toTurn('Ras');
  const spot = freeRun(2);
  place(ras, spot.x, spot.y);
  place(kay, spot.x + 1, spot.y);
  const kayBefore = hpOf(kay);
  forceD20(1, 1);
  L.handleAttack(ras.id, kay.id);
  if (S.awaitingReact) settleReacts(() => null);
  const recoil = logText().map(t => t.match(/Ras takes (\d+) from the botched blow/)).find(Boolean);
  assert.ok(recoil, 'the attacker is hurt by their own blunder');
  assert.ok(Number(recoil[1]) > 0);
  assert.equal(kayBefore - hpOf(kay), Number(recoil[1]), 'both take the same half');
});

test('after a fumble the defender strikes back with a free action', async () => {
  const { ras, kay } = await duel();
  toTurn('Ras');
  const spot = freeRun(2);
  place(ras, spot.x, spot.y);
  place(kay, spot.x + 1, spot.y);
  const rasHp = hpOf(ras);
  forceD20(1, 10, 15, 3);
  L.handleAttack(ras.id, kay.id);
  if (S.awaitingReact) settleReacts(() => null);
  assert.ok(logText().some(t => /Kay Climber.*free action/i.test(t)), 'the free action is announced');
  assert.ok(hpOf(ras) < rasHp, 'the free blow landed');
});

test('a defender a few cells away dashes in to take the free action', async () => {
  const { ras, kay } = await duel();
  const spot = freeRun(4);
  place(ras, spot.x, spot.y);
  place(kay, spot.x + 3, spot.y);
  forceD20(15, 3);
  L.resolveFreeAction(kay, ras, { type: 'attack' });
  assert.ok(Math.max(Math.abs(kay.x - ras.x), Math.abs(kay.y - ras.y)) <= 1, 'Kay closed the gap');
  assert.ok(logText().some(t => /Kay Climber.*free action/i.test(t)));
});

test('a defender who cannot reach the attacker does nothing with the free action', async () => {
  const { ras, kay } = await duel();
  const spot = freeRun(2);
  place(ras, spot.x, spot.y);
  place(kay, spot.x + 1, spot.y);
  kay.speed = 1;
  // Move Kay out of reach: further than a dash and a step can cover
  const { cols, rows } = S.currentMap.grid;
  let far = null;
  for (let y = 1; y < rows - 1 && !far; y++) for (let x = 1; x < cols - 1; x++) {
    if (isWalkableG(S.currentMap, x, y) && !L.isOccupied(x, y) && Math.max(Math.abs(x - ras.x), Math.abs(y - ras.y)) > 9) { far = { x, y }; break; }
  }
  assert.ok(far, 'a distant cell exists');
  place(kay, far.x, far.y);
  const before = hpOf(ras);
  forceD20(15, 3);
  L.resolveFreeAction(kay, ras, { type: 'attack' });
  assert.equal(hpOf(ras), before);
  assert.ok(logText().some(t => /cannot reach/i.test(t)));
});

// ── The player's choice ────────────────────────────────────────────────────

test('a human defender is asked what to do with the free action', async () => {
  const { ras, kay } = await duel();
  toTurn('Ras');
  const spot = freeRun(2);
  place(ras, spot.x, spot.y);
  place(kay, spot.x + 1, spot.y);
  S.promptFreeAction = true;
  const serial = S.turnSerial;
  forceD20(1, 10);
  L.handleAttack(ras.id, kay.id);
  if (S.awaitingReact) settleReacts(() => null);
  assert.ok(S.awaitingFree, 'the fight waits for the answer');
  assert.equal(S.awaitingFree.actorId, kay.id);
  assert.equal(S.turnSerial, serial, 'the turn has not moved on');
  const types = L.freeActionOptions(kay, ras).map(o => o.type);
  assert.ok(types.includes('attack') && types.includes('none'));

  L.handleFreeAction({ type: 'none' });
  assert.equal(S.awaitingFree, null);
  assert.notEqual(S.turnSerial, serial, 'the turn moved on');
  S.promptFreeAction = false;
});

test('choosing the strike makes the defender hit back', async () => {
  const { ras, kay } = await duel();
  toTurn('Ras');
  const spot = freeRun(2);
  place(ras, spot.x, spot.y);
  place(kay, spot.x + 1, spot.y);
  S.promptFreeAction = true;
  forceD20(1, 10);
  L.handleAttack(ras.id, kay.id);
  if (S.awaitingReact) settleReacts(() => null);
  const before = hpOf(ras);
  forceD20(15, 3);
  L.handleFreeAction({ type: 'attack' });
  if (S.awaitingReact) settleReacts(() => null);
  assert.ok(hpOf(ras) < before);
  S.promptFreeAction = false;
});

test('a mage with a free action may cast a spell at the attacker', async () => {
  await newFight({ teamA: ['Ras'], teamB: ['Kadgar'], seed: 3 });
  const ras = byName('Ras'), kadgar = byName('Kadgar');
  const spot = freeRun(3);
  place(ras, spot.x, spot.y);
  place(kadgar, spot.x + 2, spot.y);
  const spells = L.freeActionOptions(kadgar, ras).filter(o => o.type === 'spell');
  assert.ok(spells.length > 0, 'at least one spell is offered');
  const spell = spells[0].ability;
  const slots = kadgar.spellSlots, ki = kadgar.ki;
  setRandom(mulberry32(5));
  const before = hpOf(ras);
  L.resolveFreeAction(kadgar, ras, { type: 'spell', abilityName: spell.name });
  assert.ok(logText().some(t => t.includes(spell.name)), 'the spell is cast');
  assert.ok(hpOf(ras) < before || kadgar.spellSlots < slots || kadgar.ki < ki, 'it cost something or hurt');
});

// ── Area moves: the caster rolls once, every victim defends against that roll ──

async function stormAt(victims = ['Ras']) {
  await newFight({ teamA: ['Susano'], teamB: [...victims, 'Kay Climber'], seed: 1 });
  const kadgar = byName('Susano'), ras = byName('Ras');
  toTurn('Susano');
  const spot = freeRun(4);
  place(kadgar, spot.x, spot.y);
  place(ras, spot.x + 2, spot.y);
  return { kadgar, ras };
}
// Casts Fire Ball (1d10+10) on Ras with the d20s given, declining every react
function storm(kadgar, ras, ...d20s) {
  forceD20(...d20s);
  L.handleCastAbility(kadgar.id, 'Fire Ball', [ras.id]);
  if (S.awaitingReact) settleReacts(() => null);
}
const hitLine = name => logText().find(t => new RegExp(`${name} is hit for`).test(t));
const dieCount = (line, sides) => Number(line?.match(new RegExp(String.raw`(\d+)d${sides}\[`))?.[1]);

test('area: a natural 20 against a natural 20 defense is a plain full hit', async () => {
  const { kadgar, ras } = await stormAt();
  storm(kadgar, ras, 20, 20);
  assert.equal(dieCount(hitLine('Ras'), 10), 1);
});

test('area: a natural 20 against an ordinary defense doubles the dice', async () => {
  const { kadgar, ras } = await stormAt();
  storm(kadgar, ras, 20, 10);
  assert.equal(dieCount(hitLine('Ras'), 10), 2);
});

test('area: a natural 20 against a natural 1 defense rolls the dice four times', async () => {
  const { kadgar, ras } = await stormAt();
  storm(kadgar, ras, 20, 1);
  assert.equal(dieCount(hitLine('Ras'), 10), 4);
});

test('area: an ordinary roll against a natural 1 defense doubles the dice', async () => {
  const { kadgar, ras } = await stormAt();
  storm(kadgar, ras, 12, 1);
  assert.equal(dieCount(hitLine('Ras'), 10), 2);
});

test('area: an ordinary roll against an ordinary defense keeps the old rule', async () => {
  const { kadgar, ras } = await stormAt();
  storm(kadgar, ras, 15, 9);
  assert.equal(dieCount(hitLine('Ras'), 10), 1, 'full damage, one set of dice');
});

test('area: both fumble, the victim takes half and the caster takes the same', async () => {
  const { kadgar, ras } = await stormAt();
  const hp = ras.currentHp;
  storm(kadgar, ras, 1, 1);
  const recoil = logText().map(t => t.match(/Susano takes (\d+) from the botched blow/)).find(Boolean);
  assert.ok(recoil, 'the caster is hurt');
  assert.equal(hp - ras.currentHp, Number(recoil[1]));
});

test('area: a caster natural 1 fails against an ordinary defense and the victim earns a free action', async () => {
  const { kadgar, ras } = await stormAt();
  const hp = ras.currentHp;
  storm(kadgar, ras, 1, 10);
  assert.equal(hitLine('Ras'), undefined, 'no damage');
  assert.equal(ras.currentHp, hp);
  assert.ok(logText().some(t => /Ras.*free action/i.test(t)));
});

test('area: a natural 20 defense against an ordinary roll takes no damage and earns a free action', async () => {
  const { kadgar, ras } = await stormAt();
  const hp = ras.currentHp;
  storm(kadgar, ras, 12, 20);
  assert.equal(hitLine('Ras'), undefined);
  assert.equal(ras.currentHp, hp);
  assert.ok(logText().some(t => /Ras.*free action/i.test(t)));
});

test('splash: the bystanders defend against the primary roll under the same rules', async () => {
  await newFight({ teamA: ['Eragon'], teamB: ['Ras', 'Kay Climber'], seed: 1 });
  const eragon = byName('Eragon'), ras = byName('Ras'), kay = byName('Kay Climber');
  toTurn('Eragon');
  const spot = freeRun(4);
  place(eragon, spot.x, spot.y); place(ras, spot.x + 2, spot.y); place(kay, spot.x + 2, spot.y + 1);
  forceD20(20, 10);
  L.handleCastAbility(eragon.id, 'Water Dragon', [ras.id]);
  if (S.awaitingReact) settleReacts(() => null);
  const caught = logText().find(t => /Kay Climber is caught by the splash/.test(t));
  assert.ok(caught, 'Kay is caught');
  assert.equal(dieCount(caught, 12), 4, 'a natural 20 doubles 2d12');
});

// ── A free-action spell gives its target a react ───────────────────────────

async function freeSpellDuel() {
  await newFight({ teamA: ['Susano'], teamB: ['Kay Climber'], seed: 3 });
  const kadgar = byName('Susano'), kay = byName('Kay Climber');
  const spot = freeRun(3);
  place(kadgar, spot.x, spot.y);
  place(kay, spot.x + 2, spot.y);
  const spell = L.freeActionOptions(kadgar, kay).find(o => o.type === 'spell').ability;
  assert.ok(L.getReacts(kay, spell).length > 0, 'fixture: Kay has a react against the spell');
  return { kadgar, kay, spell };
}

test('a free spell stops for the target\'s react before it resolves', async () => {
  const { kadgar, kay, spell } = await freeSpellDuel();
  const serial = S.turnSerial;
  const handedOff = L.resolveFreeAction(kadgar, kay, { type: 'spell', abilityName: spell.name });
  assert.equal(handedOff, true, 'the spell carries on through the react flow');
  assert.equal(S.awaitingReact, true);
  assert.equal(S.reactOptions[0].combatantId, kay.id);
  assert.equal(S.turnSerial, serial, 'not resolved yet');
});

test('a person who picks a free spell moves the turn on exactly once', async () => {
  const { kadgar, kay, spell } = await freeSpellDuel();
  S.awaitingFree = { actorId: kadgar.id, targetId: kay.id, instant: false };
  const serial = S.turnSerial;
  L.handleFreeAction({ type: 'spell', abilityName: spell.name });
  if (S.awaitingReact) L.handleReactNo();
  assert.equal(S.awaitingReact, false);
  assert.equal(S.awaitingFree, null);
  assert.equal(S.turnSerial, serial + 1);
});

test('a free spell does not earn its target a free action of their own', async () => {
  const { kadgar, kay, spell } = await freeSpellDuel();
  forceD20(5, 20);
  L.resolveFreeAction(kadgar, kay, { type: 'spell', abilityName: spell.name });
  if (S.awaitingReact) L.handleReactNo();
  assert.equal(kay.freeActionTarget, null);
  assert.ok(!logText().some(t => /Kay Climber takes a free action/.test(t)));
});
