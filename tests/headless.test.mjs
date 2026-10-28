import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const names = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8')).map(c => c.nom);
const teamA = names.slice(0, 5);
const teamB = names.slice(5, 10);

test('newFight 5v5 sets up a combat on distinct walkable cells', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  assert.equal(L.S.combatants.length, 10);
  assert.equal(L.S.phase, 'combat');
  const keys = new Set(L.S.combatants.map(c => `${c.x},${c.y}`));
  assert.equal(keys.size, 10);
  for (const c of L.S.combatants) assert.ok(isWalkableG(L.S.currentMap, c.x, c.y));
});

test('same seed gives the same initiative order, different seeds differ', async () => {
  const order = async seed => { await newFight({ teamA, teamB, seed }); return L.S.initiativeOrder.join(','); };
  assert.equal(await order(7), await order(7));
  const orders = new Set();
  for (const seed of [1, 2, 3, 4, 5]) orders.add(await order(seed));
  assert.ok(orders.size > 1);
});

test('a stunned unit is skipped synchronously in headless mode', async () => {
  await newFight({ teamA, teamB, seed: 3 });
  const second = L.getCombatant(L.S.initiativeOrder[1]);
  const third  = L.getCombatant(L.S.initiativeOrder[2]);
  second.statusEffects.push({ name: 'stun', turnsLeft: 2 });
  L.handlePass();
  assert.equal(L.S.currentTurnIndex, 2);
  assert.equal(L.activeCombatant().id, third.id);
});

test('unknown names throw with close suggestions', async () => {
  await assert.rejects(
    newFight({ teamA: ['Zhuqiao, Vermillon Bird'], teamB, seed: 1 }),
    /Zhuqiao, Vermillion Bird/);
});

test('headless mode never touches render hooks or the DOM', async () => {
  let calls = 0;
  const saved = { ...L._R };
  for (const k of Object.keys(L._R)) L._R[k] = () => { calls++; };
  const doc = globalThis.document;
  globalThis.document = new Proxy({}, { get() { throw new Error('document touched'); } });
  try {
    assert.equal(L.isHeadless(), true);
    await newFight({ teamA, teamB, seed: 2 });
    L.handlePass();
    L.enterAimMode({ name: 'x' }, 'spell');
    L.exitAimMode();
    L.cancelAim();
    assert.equal(calls, 0);
  } finally { globalThis.document = doc; Object.assign(L._R, saved); }
});

test('setHeadless can be switched back off', () => {
  L.setHeadless(false);
  assert.equal(L.isHeadless(), false);
  L.setHeadless(true);
  assert.equal(L.isHeadless(), true);
});
