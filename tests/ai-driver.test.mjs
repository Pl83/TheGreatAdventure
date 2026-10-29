import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const D = await import('../js/combat-ai-driver.js');
const { createBrain } = await import('../js/ai/brain.js');

const { S } = L;
const THORMAK = 'Thormak, The Titan Slayer';
const KADGAR  = 'Kadgar';

function useBot(team) {
  D.setAiBrain(createBrain({ budget: { sims: 25 }, seed: 5 }));
  S.aiTeam = team;
}

test('with no bot team nothing is pending and stepAI does nothing', async () => {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed: 1 });
  S.aiTeam = null;
  assert.equal(D.pendingAiDecision(), null);
  const serial = S.turnSerial;
  assert.equal(D.stepAI(), false);
  assert.equal(S.turnSerial, serial);
  assert.equal(D.aiStatusHTML(), '');
});

test('the bot is asked only on its own units\' turns', async () => {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed: 1 });
  useBot(1);
  const mine = L.activeCombatant().teamIndex === 1;
  assert.equal(D.pendingAiDecision(), mine ? 'turn' : null);
  assert.equal(D.controlledByAi(L.activeCombatant()), mine);
  if (!mine) {
    L.handlePass();
    assert.equal(D.pendingAiDecision(), 'turn');
  }
  assert.match(D.aiStatusHTML(), /Bot \(Team II\) is thinking/);
});

test('a bot turn plays and hands the turn on', async () => {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed: 2 });
  useBot(0);
  if (D.pendingAiDecision() !== 'turn') L.handlePass();
  const logLen = S.log.length;
  assert.equal(D.stepAI(), true);
  assert.ok(S.log.length > logLen, 'the bot did something');
});

test('the bot ends its turn within a few decisions (an instant cast keeps the turn open)', async () => {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed: 2 });
  useBot(0);
  if (D.pendingAiDecision() !== 'turn') L.handlePass();
  const serial = S.turnSerial;
  for (let i = 0; i < 4 && S.turnSerial === serial; i++) D.stepAI();
  assert.notEqual(S.turnSerial, serial);
});

test('a fight against a passive player ends, and the bot wins it', async () => {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed: 3 });
  useBot(0);
  for (let i = 0; i < 400 && S.phase === 'combat'; i++) {
    if (D.stepAI()) continue;
    // The "human" declines every react and passes every turn
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.equal(S.phase, 'victory');
  assert.equal(S.winnerTeam, 0);
});

test('the bot answers a react prompt aimed at its own unit, and not one aimed at the player', async () => {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed: 4 });
  if (L.activeCombatant().name !== THORMAK) L.handlePass();
  const thormak = L.activeCombatant();
  const kadgar  = S.combatants.find(c => c.name === KADGAR);
  const cell = L.freeCellAdjacentTo(kadgar, thormak, thormak.id);
  thormak.x = cell.x; thormak.y = cell.y;
  L.handleAttack(thormak.id, kadgar.id);
  assert.ok(S.awaitingReact, 'Kadgar has a react to offer');

  S.aiTeam = thormak.teamIndex;   // the bot plays the attacker: the prompt is the player's
  assert.equal(D.pendingAiDecision(), null);

  useBot(kadgar.teamIndex);       // the bot plays the defender
  assert.equal(D.pendingAiDecision(), 'react');
  assert.match(D.aiStatusHTML(), /choosing a reaction/);
  assert.equal(D.stepAI(), true);
  assert.equal(S.awaitingReact, false);
});

test('setAiTeam and loadAiTeam round-trip through storage, and bad values mean no bot', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k),
  };
  D.setAiTeam(1);
  S.aiTeam = null;
  D.loadAiTeam();
  assert.equal(S.aiTeam, 1);
  D.setAiTeam(0);
  D.loadAiTeam();
  assert.equal(S.aiTeam, 0);
  D.setAiTeam(null);
  D.loadAiTeam();
  assert.equal(S.aiTeam, null);
  D.setAiTeam(7);
  assert.equal(S.aiTeam, null);
});
