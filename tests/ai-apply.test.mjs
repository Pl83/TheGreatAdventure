import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { applyPlan, settleReacts } = await import('../js/ai/apply.js');
const names = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8')).map(c => c.nom);
const teamA = names.slice(0, 5);
const teamB = names.slice(5, 10);

const { S } = L;
const KADGAR  = 'Kadgar';                     // Greater Teleportation: a teleport react
const THORMAK = 'Thormak, The Titan Slayer';  // Blink: a self-cast teleport

// A free walkable cell within `range` of `c`, at least 2 cells away from it
function freeCellNear(c, range) {
  for (let d = 2; d <= range; d++) {
    for (let x = c.x - d; x <= c.x + d; x++) {
      for (let y = c.y - d; y <= c.y + d; y++) {
        if (L.chebyshev(c, { x, y }) !== d) continue;
        if (isWalkableG(S.currentMap, x, y) && !L.isOccupied(x, y)) return { x, y };
      }
    }
  }
  return null;
}

// Thormak's turn, standing next to Kadgar
async function duel(seed = 1) {
  await newFight({ teamA: [THORMAK], teamB: [KADGAR], seed });
  if (L.activeCombatant().name !== THORMAK) L.handlePass();
  const thormak = L.activeCombatant();
  const kadgar  = S.combatants.find(c => c.name === KADGAR);
  const cell = L.freeCellAdjacentTo(kadgar, thormak, thormak.id);
  thormak.x = cell.x; thormak.y = cell.y;
  return { thormak, kadgar };
}

test('a pass plan is accepted and ends the turn', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const serial = S.turnSerial;
  const r = applyPlan({ move: null, action: { type: 'pass' } });
  assert.equal(r.accepted, true);
  assert.notEqual(S.turnSerial, serial);
});

test('an attack on an out-of-reach target is rejected and keeps the turn', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const active = L.activeCombatant();
  const far = L.enemies(active).find(e => !L.targetInRange(active, e, null).inRange);
  assert.ok(far, 'fixture needs an enemy out of reach');
  const serial = S.turnSerial;
  const r = applyPlan({ move: null, action: { type: 'attack', targetId: far.id } });
  assert.equal(r.accepted, false);
  assert.ok(r.reason);
  assert.equal(S.turnSerial, serial);
  assert.equal(S.hasActed, false);
});

test('a failed move is skipped but the action still runs', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const active = L.activeCombatant();
  const r = applyPlan({ move: { x: active.x + 99, y: active.y }, action: { type: 'pass' } });
  assert.equal(r.accepted, true);
  assert.match(r.reason, /move/);
});

test('settleReacts with no choice declines the react and plays none', async () => {
  const { thormak, kadgar } = await duel();
  const r = applyPlan({ move: null, action: { type: 'attack', targetId: kadgar.id } });
  assert.equal(r.accepted, true);
  assert.equal(S.awaitingReact, true);
  assert.equal(settleReacts(() => null), 0);
  assert.equal(S.awaitingReact, false);
  assert.equal(S.pendingAction, null);
  assert.notEqual(L.activeCombatant().id, thormak.id);
});

test('a teleport react with a legal dest moves the reactor there', async () => {
  const { kadgar } = await duel();
  applyPlan({ move: null, action: { type: 'attack', targetId: kadgar.id } });
  const dest = freeCellNear(kadgar, 5);
  const n = settleReacts(() => ({ combatantId: kadgar.id, abilityName: 'Greater Teleportation', dest }));
  assert.equal(n, 1);
  assert.deepEqual({ x: kadgar.x, y: kadgar.y }, dest);
  assert.equal(S.teleportMode, false);
  assert.equal(S.awaitingReact, false);
  assert.equal(S.pendingAction, null);
});

test('a teleport react with an illegal dest still resolves, never stuck in teleport mode', async () => {
  const { thormak, kadgar } = await duel();
  applyPlan({ move: null, action: { type: 'attack', targetId: kadgar.id } });
  const n = settleReacts(() => ({ combatantId: kadgar.id, abilityName: 'Greater Teleportation', dest: { x: thormak.x, y: thormak.y } }));
  assert.equal(n, 1);
  assert.equal(S.teleportMode, false);
  assert.equal(S.awaitingReact, false);
  assert.equal(S.pendingAction, null);
  assert.ok(!(kadgar.x === thormak.x && kadgar.y === thormak.y));
});

test('a teleport cast is completed at plan.action.dest', async () => {
  const { thormak } = await duel();
  const dest = freeCellNear(thormak, 5);
  const r = applyPlan({ move: null, action: { type: 'cast', ability: 'Blink', targetIds: [thormak.id], dest } });
  assert.equal(r.accepted, true);
  assert.equal(S.teleportMode, false);
  assert.deepEqual({ x: thormak.x, y: thormak.y }, dest);
});

test('handleTeleportClick on an occupied cell returns false and stays in teleport mode', async () => {
  const { thormak, kadgar } = await duel();
  L.enterTeleportMode(thormak, 10);
  assert.equal(L.handleTeleportClick(kadgar.x, kadgar.y), false);
  assert.equal(S.teleportMode, true);
  const dest = freeCellNear(thormak, 5);
  assert.equal(L.handleTeleportClick(dest.x, dest.y), true);
  assert.equal(S.teleportMode, false);
});
