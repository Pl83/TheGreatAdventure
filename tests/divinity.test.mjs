import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const HELA = 'Hela, Goddess of Death';
const byName = name => S.combatants.find(c => c.name === name);
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.equal(L.activeCombatant().name, name);
  return L.activeCombatant();
};
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const logText = () => S.log.map(e => e.text).join('\n');
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}

async function duel(a, b, seed = 1) {
  await newFight({ teamA: [a], teamB: [b], seed });
  const x = byName(a), y = byName(b);
  x.x = 10; x.y = 10; y.x = 11; y.y = 10;
  return { x, y };
}

test('Hela, Chronos and Nirvana carry the divinity tag; Susano outside Nirvana does not', async () => {
  const { x: hela } = await duel(HELA, 'Kay Climber');
  assert.ok(L.hasDivinity(hela));
  const { x: chronos } = await duel('Chronos, Monarch of Time', 'Kay Climber');
  assert.ok(L.hasDivinity(chronos));
  const { x: susano } = await duel('Susano', 'Kay Climber');
  assert.ok(!L.hasDivinity(susano));
  assert.ok(!L.unitHasTag(susano, 'divinity'));
  susano.isTransformed = true;
  assert.ok(L.hasDivinity(susano), 'Nirvana is a divinity');
  assert.ok(L.unitHasTag(susano, 'divinity'));
});

test('a divinity acts twice a turn, with two different actions', async () => {
  const { x: hela, y: kay } = await duel(HELA, 'Kay Climber');
  toTurn(HELA);
  forceD20(15, 5);
  L.handleAttack(hela.id, kay.id);
  settle();
  assert.equal(L.activeCombatant(), hela, 'the turn is still open');
  assert.equal(S.hasActed, false);
  assert.deepEqual(S.actionsDone, ['attack']);

  const serial = S.turnSerial;
  L.handleAttack(hela.id, kay.id);   // the same action again
  assert.equal(S.turnSerial, serial, 'refused');
  assert.equal(L.activeCombatant(), hela);
  assert.match(logText(), /must differ/);

  L.handleCastAbility(hela.id, 'Death Gaze', [kay.id]);   // a different one
  settle();
  assert.ok(S.turnSerial > serial || L.activeCombatant() !== hela, 'the second action ends the turn');
});

test('an ordinary fighter still has one action', async () => {
  const { x: kay, y: foe } = await duel('Kay Climber', 'Kadgar');
  toTurn('Kay Climber');
  const serial = S.turnSerial;
  forceD20(15, 5);
  L.handleAttack(kay.id, foe.id);
  settle();
  assert.ok(S.turnSerial > serial, 'the turn moved on');
});

const CHRONOS = 'Chronos, Monarch of Time';

test('Chronos: two actions a turn, the second a different one', async () => {
  const { x: chronos, y: foe } = await duel(CHRONOS, 'Kay Climber');
  toTurn(CHRONOS);
  forceD20(15, 5);
  L.handleAttack(chronos.id, foe.id);
  settle();
  assert.deepEqual(S.actionsDone, ['attack']);
  const serial = S.turnSerial;
  L.handleCastAbility(chronos.id, 'Stasis', [foe.id]);
  settle();
  assert.ok(S.turnSerial > serial, 'Stasis was the second action');
});

test('Borrowed Time (an instant) adds a third action to a divinity, and still costs none', async () => {
  const { x: chronos, y: foe } = await duel(CHRONOS, 'Kay Climber');
  toTurn(CHRONOS);
  forceD20(15, 5);
  L.handleAttack(chronos.id, foe.id);
  settle();
  L.handleCastAbility(chronos.id, 'Borrowed Time', [chronos.id]);
  settle();
  assert.deepEqual(S.actionsDone, ['attack'], 'the instant spent no action');
  assert.equal(S.bonusActions, 1);
  L.handleCastAbility(chronos.id, 'Stasis', [foe.id]);
  settle();
  assert.equal(L.activeCombatant(), chronos, 'two actions spent, a third is left');
  const serial = S.turnSerial;
  L.handleCastAbility(chronos.id, 'Withering Hour', [foe.id]);
  settle();
  assert.ok(S.turnSerial > serial, 'three actions spent: the turn moved on');
});

test('Final Reckoning gives Hela a third action', async () => {
  const { x: hela, y: kay } = await duel(HELA, 'Kay Climber');
  toTurn(HELA);
  kay.maxHp = kay.currentHp = 5000;   // survives the crit, so the fight goes on
  assert.equal(L.actionBudget(hela), 2);
  L.handleCastAbility(hela.id, 'Final Reckoning', [hela.id]);   // her first action
  settle();
  assert.ok(hela.statusEffects.some(e => e.name === 'final_reckoning'), 'the cast starts it');
  assert.equal(L.actionBudget(hela), 3);
  assert.equal(L.activeCombatant(), hela);
  L.handleCastAbility(hela.id, 'Death Gaze', [kay.id]);
  settle();
  assert.equal(L.activeCombatant(), hela, 'two actions spent, a third is left');
  const serial = S.turnSerial;
  L.handleCastAbility(hela.id, 'Soul Obliteration', [kay.id]);
  settle();
  assert.ok(S.turnSerial > serial, 'the third action ends the turn');
});

test('Hela keeps Final Reckoning when she resurrects, so three actions on her next turn', async () => {
  const { x: hela } = await duel(HELA, 'Kay Climber');
  toTurn(HELA);
  L.applyDamage(hela, 5000, 'physical', ['physical', 'unblockabled']);
  assert.ok(!hela.isKO, 'resurrected');
  assert.equal(L.actionBudget(hela), 3);
});

test('Nirvana: transforming uses the turn, grants permanent flight, and the second action starts next turn', async () => {
  const { x: susano, y: foe } = await duel('Susano', 'Kay Climber');
  toTurn('Susano');
  assert.ok(!susano.statusEffects.some(e => e.name === 'fly'));
  const serial = S.turnSerial;
  L.handleTransform(susano.id);
  assert.ok(susano.isTransformed);
  assert.ok(susano.statusEffects.some(e => e.name === 'fly'), 'flies in Nirvana');
  assert.ok(S.turnSerial > serial, 'transforming ended the turn');
  toTurn('Susano');
  assert.equal(S.hasActed, false);
  forceD20(15, 5);
  L.handleAttack(susano.id, foe.id);
  settle();
  assert.equal(L.activeCombatant(), susano, 'a divinity in Nirvana has a second action');
});

test('Susano matches the doc: 15 slots, Fire Ball 1d12+10, Golden Beam 2d20+25, Nirvana cleaver 2d10+10', async () => {
  const { x: susano } = await duel('Susano', 'Kay Climber');
  assert.equal(susano.maxSpellSlots, 15);
  const sheet = susano.sourceChar;
  assert.equal(sheet.moveSet.find(m => m.base.nom === 'Fire Ball').base.dices, '1d12+10');
  assert.equal(sheet.transformation.baseAtk.dices, '2d10+10');
  const nirvana = sheet.transformation.moveSet;
  assert.equal(nirvana.find(m => m.base.nom === 'Fire Ball').base.dices, '1d12+10');
  assert.equal(nirvana.find(m => m.base.nom === 'Golden Beam').base.dices, '2d20+25');
});

test('Jeagen deals +1d20 to a divinity and nothing extra to anyone else', async () => {
  const jeagen = 'Jeagen, White Tiger';
  const hit = async (foe, ...d20s) => {
    const { x, y } = await duel(jeagen, foe);
    toTurn(jeagen);
    forceD20(...d20s);
    L.handleAttack(x.id, y.id);
    settle();
    return logText();
  };
  // Hela's Death Presence gives the first attack disadvantage: two attack d20s, then her defence
  assert.match(await hit(HELA, 18, 17, 5), /Divine Hunter\[1d20/);
  assert.doesNotMatch(await hit('Kay Climber', 18, 5), /Divine Hunter/);
});
