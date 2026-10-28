import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom, mulberry32 } = await import('../js/rng.js');
const { snapshot, restore } = await import('../js/ai/snapshot.js');
const names = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8')).map(c => c.nom);
const teamA = names.slice(0, 5);
const teamB = names.slice(5, 10);

const { S } = L;
const plain = () => JSON.stringify(S, (k, v) =>
  k === 'currentMap' || k === 'sourceChar' || k === 'abilities' ? undefined
  : v instanceof Map ? [...v] : v);
const play = () => { for (let i = 0; i < 6; i++) L.handlePass(); L.applyDamage(S.combatants[0], 15); };

test('restore rewinds the fight in place and keeps references', async () => {
  await newFight({ teamA, teamB, seed: 5 });
  const ref = S, c0 = S.combatants[0], abilities = c0.abilities, map = S.currentMap;
  const before = plain(), logLen = S.log.length;
  const snap = snapshot();
  play();
  assert.notEqual(plain(), before);
  restore(snap);
  assert.equal(S, ref);
  assert.equal(S.combatants[0], c0);
  assert.equal(S.combatants[0].abilities, abilities);
  assert.equal(S.currentMap, map);
  assert.equal(S.log.length, logLen);
  assert.equal(plain(), before);
  play();
  restore(snap);
  assert.equal(plain(), before);
});

test('Map fields survive a round trip', async () => {
  await newFight({ teamA, teamB, seed: 5 });
  S.reachableCells = new Map([['1,2', { x: 1, y: 2 }]]);
  const snap = snapshot();
  S.reachableCells = new Map();
  restore(snap);
  assert.ok(S.reachableCells instanceof Map);
  assert.deepEqual([...S.reachableCells], [['1,2', { x: 1, y: 2 }]]);
});

test('replaying after restore is deterministic', async () => {
  await newFight({ teamA, teamB, seed: 5 });
  const snap = snapshot();
  setRandom(mulberry32(7)); play();
  const first = plain();
  restore(snap);
  setRandom(mulberry32(7)); play();
  assert.equal(plain(), first);
});

test('200 snapshot+restore cycles on a 5v5 fight are fast', async () => {
  await newFight({ teamA, teamB, seed: 5 });
  const t = performance.now();
  for (let i = 0; i < 200; i++) restore(snapshot());
  assert.ok(performance.now() - t < 500);
});
