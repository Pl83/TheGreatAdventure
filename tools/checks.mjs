// Development-only: checks a running fight against the rules of the character sheets and files breaches.
//   createChecker(chars, seed) -> { beforeAction(actorId), afterAction(plan, result, actorId, round),
//                                   turnOf(unitId), afterReact(unitId, ability, turn), finish(end) }
// The ledger of casts comes from the plans the runner applied plus the sheets (cooldown: 99 = once per fight,
// cooldown: N = N owner turns locked), never from the engine's own cooldown counters.
import { installShims } from './headless.mjs';
import { makeViolation } from './violations.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { isWalkableG } = await import('../js/dungeon-loader.js');

const { S } = L;
const RESOURCES = ['spellSlots', 'ki', 'souls'];

export function createChecker(chars, seed) {
  const sheets = new Map(chars.map(c => [c.nom, c]));
  const ledger = new Map();   // `${unitId}/${ability}` -> { uses, lastTurn }; a unit gets one turn per round, so the round is its turn number
  const seen = new Set();     // a breach that keeps standing is filed once
  let wasKo = false;

  const file = (out, kind, detail, round) => {
    const key = `${kind}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(makeViolation(kind, detail, seed, round));
  };
  const cell = c => `(${c.x}, ${c.y})`;

  // Domain effects can waive a cooldown (abilityAvailable). Conservative: skip the cooldown check
  // for a unit while its domain is active and has any effect that applies on 'cooldown'.
  const cooldownWaived = unit => unit.domainActive
    && (sheets.get(unit.name)?.domain?.effects ?? []).some(e => e.applyOn?.includes('cooldown'));

  function checkState(out, round) {
    const living = [];
    for (const c of S.combatants) {
      if (c.currentHp > c.maxHp || c.currentHp < 0) file(out, 'hp-out-of-range', `${c.name}: HP ${c.currentHp}/${c.maxHp}`, round);
      for (const key of RESOURCES) {
        if (c[key] < 0) file(out, 'resource-negative', `${c.name}: ${key} is ${c[key]}`, round);
      }
      if (!c.isKO) living.push(c);
    }
    for (const c of living) {
      if (S.currentMap && !isWalkableG(S.currentMap, c.x, c.y)) {
        file(out, 'cell-unwalkable', `${c.name} stands on unwalkable cell ${cell(c)}`, round);
      }
    }
    for (let i = 0; i < living.length; i++) {
      for (let j = i + 1; j < living.length; j++) {
        if (living[i].x === living[j].x && living[i].y === living[j].y) {
          file(out, 'cell-conflict', `${living[i].name} and ${living[j].name} share cell ${cell(living[i])}`, round);
        }
      }
    }
  }

  function checkCast(out, unit, ability, round) {
    const move = sheets.get(unit.name)?.moveSet?.find(m => m.base?.nom === ability);
    if (!move) return;
    const key = `${unit.id}/${ability}`;
    const entry = ledger.get(key);
    if (entry && move.cooldown === 99) {
      file(out, 'once-per-fight-reuse', `${unit.name} cast ${ability} again on turn ${round} (first on turn ${entry.lastTurn})`, round);
    } else if (entry && move.cooldown > 0 && move.cooldown < 99 && round - entry.lastTurn < move.cooldown + 1 && !cooldownWaived(unit)) {
      file(out, 'cooldown-ignored', `${unit.name} cast ${ability} on turn ${round}, locked until turn ${entry.lastTurn + move.cooldown + 1} (cooldown ${move.cooldown})`, round);
    }
    const uses = (entry?.uses ?? 0) + 1;
    if (move.charges > 0 && uses > move.charges) {
      file(out, 'charges-exceeded', `${unit.name} cast ${ability} for use ${uses} but the sheet allows ${move.charges} charges`, round);
    }
    ledger.set(key, { uses, lastTurn: round });
  }

  return {
    // Call before applyPlan: remembers whether the actor was already KO
    beforeAction(actorId) {
      wasKo = !!L.getCombatant(actorId)?.isKO;
    },

    // actorId and round are captured before applyPlan: the turn has usually moved on by the time it returns
    afterAction(plan, result, actorId, round = S.roundNumber) {
      const out = [];
      const unit = L.getCombatant(actorId);
      const name = unit?.name ?? `unit ${actorId}`;
      if (!result.accepted) {
        file(out, 'rejected-plan', `${name}: ${JSON.stringify(plan.action)} (${result.reason})`, round);
      } else {
        if (wasKo) file(out, 'ko-acted', `${name} was KO but its plan was accepted: ${JSON.stringify(plan.action)}`, round);
        if (unit && plan.action?.type === 'cast') checkCast(out, unit, plan.action.ability, round);
      }
      wasKo = false;
      checkState(out, round);
      return out;
    },

    // The owner turns unitId has begun: the round, less one while its turn this round has not come up yet. A
    // turn cast happens on the owner's turn (its round); a react can come before the owner's turn in a round
    // and then follows the owner's previous turn, which is what its cooldown counts from.
    turnOf(unitId) {
      const slot = S.initiativeOrder.indexOf(unitId);
      return S.roundNumber - (slot > S.currentTurnIndex ? 1 : 0);
    },

    // Call for each react played (unitId's ability, at the owner turn turnOf gave when it was chosen): it is cast
    // like any move, so the same once-per-fight, cooldown and charge rules apply
    afterReact(unitId, ability, turn) {
      const out = [];
      const unit = L.getCombatant(unitId);
      if (unit) checkCast(out, unit, ability, turn);
      checkState(out, S.roundNumber);
      return out;
    },

    // Call once the loop is over; end = { winner, rounds, maxRounds }
    finish({ winner, rounds, maxRounds }) {
      const out = [];
      if (winner === null) file(out, 'stalled', `no winner after ${rounds} of ${maxRounds} rounds`, rounds);
      return out;
    },
  };
}
