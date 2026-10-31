// Development-only: plays one complete fight headlessly between two brains and reports what happened.
//   Brain = { chooseTurn(teamIndex): TurnPlan, chooseReact(): ReactChoice, takeErrors?(): Error[] }
import { readFile } from 'node:fs/promises';
import { installShims, newFight } from './headless.mjs';
import { createChecker } from './checks.mjs';
import { makeViolation } from './violations.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { applyPlan, settleReacts } = await import('../js/ai/apply.js');
const { greedyBrain } = await import('../js/ai/greedy.js');
const { createBrain } = await import('../js/ai/brain.js');
const { decidingTeam } = await import('../js/ai/search.js');

const { S } = L;
const CONTROLS = ['stun', 'para', 'gel', 'freeze', 'fear'];
const MAX_ACTIONS_PER_TURN = 5;   // instant casts leave the turn open; this bounds a brain that chains them
const MAX_STEPS = 5000;           // hard stop against a fight that never advances
const CHARS = JSON.parse(await readFile(new URL('../js/characters.json', import.meta.url), 'utf8'));

const controlsOn = c => new Set(c.statusEffects.map(e => e.name.toLowerCase()).filter(n => CONTROLS.includes(n)));
const bump = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };

// The brain for one seat of one fight: 'greedy', or a fresh 'ai' brain with the given budget. Its seed mixes the
// fight's seed with the team it plays for, so each fight's decisions replay from its seed and two ai seats in
// the same fight never share a lookahead stream.
export function makeBrain(kind, budget, seed, team, weights) {
  if (kind !== 'ai') return greedyBrain;
  return createBrain({ budget, weights, seed: (Math.imul(seed, 0x9E3779B1) ^ Math.imul(team + 1, 0x85EBCA77)) >>> 0 });
}

export async function playFight({ teamA, teamB, seed, map, brains, maxRounds = 40 }) {
  await newFight({ teamA, teamB, seed, map });
  const checker = createChecker(CHARS, seed);
  const result = {
    seed, winner: null, rounds: 1, firstKo: null, kos: [], moveUses: {}, oncePerFightUses: 0, reactsPlayed: 0,
    controlThenAlly: 0, stalled: false, maxDecisionMs: 0, violations: [],
  };
  const timed = fn => {
    const t0 = performance.now();
    try { return fn(); } finally { result.maxDecisionMs = Math.max(result.maxDecisionMs, performance.now() - t0); }
  };
  // Asks a brain for a decision; errors it recovered from (it has already fallen back) are filed as exceptions,
  // and so are errors it recorded before failing outright
  const ask = (brain, decide) => {
    try {
      return timed(decide);
    } finally {
      for (const err of brain.takeErrors?.() ?? []) {
        result.violations.push(makeViolation('exception', `brain fallback: ${err.message}`, seed, S.roundNumber));
      }
    }
  };
  const noteKos = () => {
    for (const c of S.combatants) if (c.isKO && !result.kos.includes(c.name)) result.kos.push(c.name);
  };
  // Control statuses currently on a unit that an enemy's move put there: { targetId, status, controller, counted }
  let controls = [];
  const trackControl = (actor, before) => {
    for (const t of S.combatants) {
      if (t.teamIndex === actor.teamIndex) continue;
      for (const status of controlsOn(t)) {
        if (!before.get(t.id)?.has(status)) controls.push({ targetId: t.id, status, controller: actor, counted: false });
      }
    }
  };

  let steps = 0, actions = 0, lastTurn = -1, crashed = false;
  try {
    while (S.phase === 'combat' && S.roundNumber <= maxRounds && steps++ < MAX_STEPS) {
      if (S.awaitingReact) {
        // The first option's owner decides for the whole prompt
        const reactor = () => brains[L.getCombatant(S.reactOptions[0].combatantId).teamIndex];
        // Reacts the brains chose among the options offered: played, so checked against the sheets like moves
        const played = [];
        result.reactsPlayed += settleReacts(() => {
          const brain = reactor();
          const choice = ask(brain, () => brain.chooseReact());
          if (choice && S.reactOptions.some(o => o.combatantId === choice.combatantId && o.ability.name === choice.abilityName)) {
            played.push({ choice, turn: checker.turnOf(choice.combatantId) });
          }
          return choice;
        });
        for (const { choice, turn } of played) result.violations.push(...checker.afterReact(choice.combatantId, choice.abilityName, turn));
        noteKos();
        continue;
      }
      const unit = L.activeCombatant();
      if (S.turnSerial !== lastTurn) { lastTurn = S.turnSerial; actions = 0; }
      controls = controls.filter(k => controlsOn(L.getCombatant(k.targetId)).has(k.status));
      if (actions >= MAX_ACTIONS_PER_TURN) { L.handlePass(); continue; }
      actions++;

      // A puppeteered unit's turn is decided by its controller's side
      const team = decidingTeam(unit);
      const brain = brains[team];
      const plan = ask(brain, () => brain.chooseTurn(team));
      const ability = plan.action?.type === 'cast' ? unit.abilities.find(a => a.name === plan.action.ability) : null;
      const before = new Map(S.combatants.map(c => [c.id, controlsOn(c)]));
      const pending = controls.filter(k => !k.counted && k.controller.teamIndex === unit.teamIndex && k.controller.id !== unit.id);
      const actorId = unit.id, round = S.roundNumber;   // the turn has usually moved on once applyPlan returns
      checker.beforeAction(actorId);
      const outcome = applyPlan(plan);
      result.violations.push(...checker.afterAction(plan, outcome, actorId, round));
      if (outcome.accepted) {
        const a = plan.action;
        if (a.type === 'attack') bump(result.moveUses, `${unit.name} / attack`);
        if (ability) {
          bump(result.moveUses, `${unit.name} / ${ability.name}`);
          if (ability.isOncePerFight) result.oncePerFightUses++;
        }
        const hit = a.type === 'attack' ? [a.targetId] : ability && ability.dice && !ability.isHeal ? a.targetIds ?? [] : [];
        for (const k of pending) if (hit.includes(k.targetId)) { k.counted = true; result.controlThenAlly++; }
        trackControl(unit, before);
      } else {
        L.handlePass();
      }
      noteKos();
    }
  } catch (err) {
    crashed = true;
    result.violations.push(makeViolation('exception', `${err.stack ?? err}`, seed, S.roundNumber));
  }
  noteKos();
  result.firstKo = result.kos[0] ?? null;
  if (S.phase === 'victory') result.winner = S.winnerTeam;
  else result.stalled = true;
  result.rounds = Math.min(S.roundNumber, maxRounds);
  if (!crashed) result.violations.push(...checker.finish({ winner: result.winner, rounds: result.rounds, maxRounds }));
  return result;
}
