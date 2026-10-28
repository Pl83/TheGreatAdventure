// Look-ahead search: tries each candidate plan of the active unit on the real engine, plays the fight on with
// the greedy policy until the planning team's next turn, scores the position and keeps the best plan.
// Dice inside a simulation come from a seeded lookahead stream; the live state, the engine's real random
// stream and the headless flag are left exactly as they were found.
//   Budget = { sims: number } | { ms: number }
import { S, activeCombatant, handlePass, setHeadless, isHeadless } from '../combat-logic.js';
import { withRandom, mulberry32 } from '../rng.js';
import { snapshot, restore } from './snapshot.js';
import { applyPlan, settleReacts } from './apply.js';
import { greedyTurn, greedyReact } from './greedy.js';
import { enumeratePlans } from './candidates.js';
import { evaluate } from './evaluate.js';

export const MAX_MS = 8000;
const MAX_ACTIONS_PER_TURN = 5;   // as in a real fight: instant casts leave the turn open, this bounds the chain
const MAX_TURNS = 12;             // further unit turns played before the position is scored
const MAX_STEPS = 200;            // hard stop against a simulation that never advances
const MAX_KEPT = 40;              // plans carried past the one-sample pass

export function resolveBudget(b) {
  if (b && 'sims' in b) return { sims: Math.max(1, Math.floor(b.sims)) };
  if (b && 'ms' in b) return { ms: Math.max(1, Math.min(MAX_MS, b.ms)) };
  throw new Error(`invalid search budget ${JSON.stringify(b)}`);
}

// Seed of a plan's j-th sample: the same for every plan, so plans are compared under the same dice
export const sampleSeed = (base, j) => (base + Math.imul(j + 1, 0x9E3779B9)) >>> 0;

// Plays on from the current state until teamIndex has the turn again, the fight ends or MAX_TURNS more unit
// turns have been played, driving each turn as a real fight does; `first` is the active unit's opening plan
// (null: the greedy policy's). Returns the score of the position reached for teamIndex.
function playOut(first, teamIndex) {
  let plan = first, turns = 0, actions = 0, lastTurn = S.turnSerial;
  for (let steps = 0; S.phase === 'combat' && steps < MAX_STEPS; steps++) {
    if (S.awaitingReact) { settleReacts(greedyReact); continue; }
    if (S.turnSerial !== lastTurn) {
      if (activeCombatant().teamIndex === teamIndex || ++turns > MAX_TURNS) break;
      lastTurn = S.turnSerial; actions = 0;
    }
    if (actions++ >= MAX_ACTIONS_PER_TURN) { handlePass(); continue; }
    const p = plan ?? greedyTurn(activeCombatant());
    plan = null;
    if (!applyPlan(p).accepted) handlePass();
  }
  return evaluate(teamIndex);
}

// One simulation from snap, headless and on the lookahead stream; S is rewound to snap whatever happens
function run(snap, seed, body) {
  const wasHeadless = isHeadless();
  setHeadless(true);
  try {
    return withRandom(mulberry32(seed), body);
  } finally {
    restore(snap);
    setHeadless(wasHeadless);
  }
}

export function simulate(plan, teamIndex, seed) {
  return run(snapshot(), seed, () => playOut(plan, teamIndex));
}

// Scores a react choice on the pending react prompt: the choice answers the first react, the greedy policy
// any that follow, then the fight is played on as in simulate
export function simulateReact(choice, teamIndex, seed) {
  if (!S.awaitingReact || !S.pendingAction) throw new Error('simulateReact needs a pending react');
  return run(snapshot(), seed, () => {
    let firstAsk = true;
    settleReacts(() => {
      if (!firstAsk) return greedyReact();
      firstAsk = false;
      return choice;
    });
    return playOut(null, teamIndex);
  });
}

export function search(teamIndex, budget, seed) {
  const t0 = performance.now();
  const b = resolveBudget(budget);
  const c = activeCombatant();
  if (S.phase !== 'combat' || !c) throw new Error('search needs a fight in progress');
  if (c.teamIndex !== teamIndex) throw new Error(`search for team ${teamIndex}, but the active unit ${c.name} is on team ${c.teamIndex}`);
  if (S.awaitingReact) throw new Error('search cannot plan a turn while a react is pending');

  const plans = enumeratePlans(c);
  if (plans.length === 1) return { plan: plans[0], sims: 0, ms: performance.now() - t0 };

  const base = (seed ?? Date.now()) >>> 0;
  const deadline = b.ms !== undefined ? t0 + b.ms : Infinity;
  const snap = snapshot();
  const sums = new Float64Array(plans.length), counts = new Uint32Array(plans.length);
  let sims = 0;
  const sample = i => {
    sums[i] += run(snap, sampleSeed(base, counts[i]), () => playOut(plans[i], teamIndex));
    counts[i]++; sims++;
  };
  const mean = i => sums[i] / counts[i];
  const byMean = ids => ids.sort((x, y) => mean(y) - mean(x));   // stable: ties keep enumeration order

  // Pass 1: one sample each (on a clock, stops once time is up but never before the first sample)
  let alive = [];
  for (let i = 0; i < plans.length; i++) {
    if (i && performance.now() >= deadline) break;
    sample(i);
    alive.push(i);
  }
  alive = byMean(alive).slice(0, MAX_KEPT);

  // Successive halving: the survivors share what is left, then the better half goes on
  const left = () => (b.sims !== undefined ? b.sims - sims
    : Math.floor((deadline - performance.now()) / ((performance.now() - t0) / sims)));
  let spent = false;
  while (alive.length > 1 && !spent) {
    const rounds = Math.ceil(Math.log2(alive.length));
    const budgetLeft = left();
    if (budgetLeft <= 0) break;
    const per = Math.max(1, Math.floor(budgetLeft / (rounds * alive.length)));
    for (let k = 0; k < per && !spent; k++) {
      for (const i of alive) {
        if (performance.now() >= deadline || (b.sims !== undefined && sims >= b.sims)) { spent = true; break; }
        sample(i);
      }
    }
    alive = byMean(alive);
    if (!spent) alive = alive.slice(0, Math.ceil(alive.length / 2));
  }
  return { plan: plans[alive[0]], sims, ms: performance.now() - t0 };
}
