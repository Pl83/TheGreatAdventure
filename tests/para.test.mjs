import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const pass = () => { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); };
const logText = () => S.log.map(e => e.text);
const count = re => logText().filter(t => re.test(t)).length;
const ALWAYS = () => 0.999;   // 1d2 comes up 2: stunned
const NEVER  = () => 0.001;   // 1d2 comes up 1: acts

async function paralysed(rng, target = 'Kay Climber') {
  await newFight({ teamA: ['Ras'], teamB: [target], seed: 1 });
  const kay = S.combatants[1];
  setRandom(rng);
  L.applyStatus(kay, 'para');
  return kay;
}
// Plays rounds until the next 8 turns of Kay's have started
function playKayTurns(kay, n) {
  const start = () => count(/^Kay Climber$/);
  const base = start();
  for (let i = 0; i < 200 && start() - base < n; i++) pass();
}

test('Para lasts three of its owner\'s turns', async () => {
  const kay = await paralysed(NEVER);
  const turnsWithPara = [];
  for (let i = 0; i < 200 && turnsWithPara.length < 5; i++) {
    pass();
    if (L.activeCombatant() === kay) turnsWithPara.push(kay.statusEffects.some(e => e.name === 'Para'));
  }
  assert.deepEqual(turnsWithPara.slice(0, 4), [true, true, true, false]);
});

test('each turn it is on, Para has a 1d2 chance to stun: a 2 loses the turn', async () => {
  const kay = await paralysed(ALWAYS);
  playKayTurns(kay, 4);
  assert.equal(count(/Kay Climber is Stun and cannot act/), 3, 'three turns lost, one per turn of the para');
  assert.ok(!kay.statusEffects.some(e => e.name === 'Para'), 'the para is over');
  assert.ok(!kay.statusEffects.some(e => e.name === 'Stun'), 'and so is the stun');
});

test('a 1 on the roll lets it act, though still paralysed', async () => {
  const kay = await paralysed(NEVER);
  playKayTurns(kay, 3);
  assert.equal(count(/Kay Climber is \w+ and cannot act/), 0);
  assert.equal(count(/Kay Climber resists stun/), 3, 'one roll per turn of the para');
});

test('Para alone does not stop the unit acting or reacting', async () => {
  const kay = await paralysed(NEVER);
  assert.equal(L.hasControlEffect(kay), null);
});

test('a unit immune to stun shrugs the roll off', async () => {
  const kay = await paralysed(ALWAYS);
  kay.sourceChar = { ...kay.sourceChar, immunities: ['stun'] };
  playKayTurns(kay, 3);
  assert.equal(count(/Kay Climber is \w+ and cannot act/), 0);
});

test('the status table says so', () => {
  assert.match(L.findEffect('Para').notes, /3 turns/);
});
