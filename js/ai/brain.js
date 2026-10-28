// The brain: the two calls a player answers in a fight, a whole turn plan for the active unit and a choice on a
// pending react prompt, both decided by look-ahead on the real engine. A brain object never loses a turn to an
// error: when the search throws, the greedy policy answers instead and the error is kept for the caller.
//   Brain = { chooseTurn(teamIndex): TurnPlan, chooseReact(): ReactChoice, takeErrors?(): Error[] }
import { S, activeCombatant, getCombatant } from '../combat-logic.js';
import { search, simulateReact, resolveBudget, sampleSeed, deadlineOf } from './search.js';
import { greedyTurn, greedyReact } from './greedy.js';
import { enumerateReacts } from './candidates.js';

export const DEFAULT_SIMS = 500;

// The plan the search finds best for the active unit, which must be on teamIndex; throws as search does
export function chooseTurn(teamIndex, budget = { sims: DEFAULT_SIMS }, seed) {
  return search(teamIndex, budget, seed).plan;
}

// The react choice with the best mean score for teamIndex: every choice gets the same sample seeds, a sims
// budget is shared out (at least one sample each), a clock budget samples round by round until time is up.
// Ties go to the earliest choice. Throws when no react is pending.
export function chooseReact(teamIndex, budget = { sims: DEFAULT_SIMS }, seed) {
  const t0 = performance.now();
  const b = resolveBudget(budget);
  if (!S.awaitingReact) throw new Error('chooseReact needs a pending react');
  const choices = enumerateReacts();
  if (choices.length === 1) return choices[0];

  const base = (seed ?? Date.now()) >>> 0;
  const deadline = deadlineOf(b, t0);
  const rounds = b.sims !== undefined ? Math.max(1, Math.floor(b.sims / choices.length)) : Infinity;
  const sums = new Float64Array(choices.length);
  // The first round always completes, so every choice has a mean; a later one starts only when, at the mean
  // pace so far, it ends before the deadline
  const r0 = performance.now();
  for (let j = 0; j < rounds && (!j || performance.now() + (performance.now() - r0) / j < deadline); j++) {
    for (let i = 0; i < choices.length; i++) sums[i] += simulateReact(choices[i], teamIndex, sampleSeed(base, j));
  }
  let best = 0;
  for (let i = 1; i < choices.length; i++) if (sums[i] > sums[best]) best = i;
  return choices[best];
}

// A Brain for one fight. With a seed, each decision's search seed comes from the seed and the decision's
// number, so a brain replays the same decisions on the same fight.
export function createBrain({ budget = { sims: DEFAULT_SIMS }, seed, onError } = {}) {
  let errors = [], decisions = 0;
  const nextSeed = () => {
    decisions++;
    return seed === undefined ? undefined : (Math.imul(seed >>> 0, 0x85EBCA6B) ^ Math.imul(decisions, 0xC2B2AE35)) >>> 0;
  };
  const guarded = (where, decide, fallback) => {
    try {
      return decide();
    } catch (err) {
      errors.push(err);
      onError?.(err, where);
      return fallback();
    }
  };
  return {
    chooseTurn: teamIndex => guarded('chooseTurn', () => chooseTurn(teamIndex, budget, nextSeed()),
      () => greedyTurn(activeCombatant())),
    // The first option's owner decides for the whole prompt
    chooseReact: () => guarded('chooseReact',
      () => chooseReact(getCombatant(S.reactOptions[0].combatantId).teamIndex, budget, nextSeed()), greedyReact),
    takeErrors: () => { const taken = errors; errors = []; return taken; },
  };
}
