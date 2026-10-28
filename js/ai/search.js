// Look-ahead search: tries each candidate plan of the active unit on the real engine, plays the fight on with
// the greedy policy for a fixed number of unit turns (both sides), scores the position and keeps the best plan.
// Dice inside a simulation come from a seeded lookahead stream; the live state, the engine's real random
// stream and the headless flag are left exactly as they were found.
//   Budget = { sims: number } | { ms: number }
// A { sims: n } search spends exactly n simulations once n covers the first pass (one sample per plan, two
// when n is at least twice the plan count); below that the first pass still samples every plan once.
import { S, activeCombatant, getCombatant, handlePass, setHeadless, isHeadless, resolveAttack } from '../combat-logic.js';
import { withRandom, mulberry32 } from '../rng.js';
import { snapshot, restore } from './snapshot.js';
import { applyPlan, settleReacts } from './apply.js';
import { greedyTurn, greedyReact } from './greedy.js';
import { enumeratePlans } from './candidates.js';
import { material, engagement, bounded, livingCounts } from './evaluate.js';
import { walkDistance } from './paths.js';

export const MAX_MS = 8000;
const MAX_ACTIONS_PER_TURN = 5;   // as in a real fight: instant casts leave the turn open, this bounds the chain
const MIN_HORIZON = 3;            // further unit turns played before scoring: a 1v1 still sees its own next turn
const MAX_HORIZON = 8;
const MAX_STEPS = 200;            // hard stop against a simulation that never advances
const MAX_KEPT = 40;              // plans carried past the first pass
const MAX_LETHAL = 10;            // plans below the cut kept anyway because a sample KO'd a foe (the best of them)

// Further unit turns a simulation plays after the candidate's own, whichever side they fall to: about half
// the living units plus one (6 in a 5v5), so an approach is still on the board when the foes have answered
export const horizonFor = living => Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, Math.ceil(living / 2) + 1));

const livingCount = () => S.combatants.reduce((n, c) => n + !c.isKO, 0);
const livingFoes = teamIndex => S.combatants.reduce((n, c) => n + (!c.isKO && c.teamIndex !== teamIndex), 0);

// A clock budget's deadline keeps a small margin, and no simulation starts that would, at the mean pace so far,
// end past it: the decision as a whole (enumeration and bookkeeping included) stays inside the budget
const MARGIN = 0.02;      // fraction of an ms budget held back
const MARGIN_MAX = 100;   // ms
export function deadlineOf(b, t0) {
  return b.ms === undefined ? Infinity : t0 + b.ms - Math.min(MARGIN_MAX, b.ms * MARGIN);
}

export function resolveBudget(b) {
  if (b && 'sims' in b) return { sims: Math.max(1, Math.floor(b.sims)) };
  if (b && 'ms' in b) return { ms: Math.max(1, Math.min(MAX_MS, b.ms)) };
  throw new Error(`invalid search budget ${JSON.stringify(b)}`);
}

// The team that decides c's turn: a puppeteered unit is steered by its (living) controller's side
export function decidingTeam(c) {
  const puppet = c.statusEffects.find(e => e.name === 'puppeteered');
  const controller = puppet && getCombatant(puppet.controllerId);
  return controller && !controller.isKO ? controller.teamIndex : c.teamIndex;
}

// Seed of a plan's j-th sample: the same for every plan, so plans are compared under the same dice
export const sampleSeed = (base, j) => (base + Math.imul(j + 1, 0x9E3779B9)) >>> 0;

// Plays on from the current state for `horizon` further unit turns or until the fight ends, driving each turn
// as a real fight does; `first` is the active unit's opening plan (null: the greedy policy's). Returns the score
// for teamIndex: the material of the position reached, plus the engagement term read when the opening turn
// ended (against the foes alive when it began). Read at the horizon instead, the engagement would be the greedy rollout's (it walks everyone in),
// the same for a hold and an approach, and two brains would wait for each other forever.
// `out.ko` tells whether a foe fell before the opening turn ended.
function playOut(first, teamIndex, horizon = horizonFor(livingCount()), out = null) {
  let plan = first, turns = 0, actions = 0, lastTurn = S.turnSerial, engaged = null;
  const targets = S.combatants.filter(f => !f.isKO && f.teamIndex !== teamIndex);
  const foes = out ? livingFoes(teamIndex) : 0;
  if (out) out.ko = false;
  for (let steps = 0; S.phase === 'combat' && steps < MAX_STEPS; steps++) {
    if (S.awaitingReact) { settleReacts(greedyReact); continue; }
    if (S.turnSerial !== lastTurn) {
      if (!turns) {
        engaged = engagement(teamIndex, targets);
        if (out) out.ko = livingFoes(teamIndex) < foes;
      }
      // A controlled unit's turn is skipped inside the same step: the serial still counts it as played
      turns += S.turnSerial - lastTurn;
      if (turns > horizon) break;
      lastTurn = S.turnSerial; actions = 0;
    }
    if (actions++ >= MAX_ACTIONS_PER_TURN) { handlePass(); continue; }
    const p = plan ?? greedyTurn(activeCombatant());
    plan = null;
    if (!applyPlan(p).accepted) handlePass();
  }
  if (out && !turns) out.ko = livingFoes(teamIndex) < foes;
  const [own, rest] = livingCounts(teamIndex);
  if (!own || !rest) return material(teamIndex);
  return bounded(material(teamIndex) + (engaged ?? engagement(teamIndex, targets)));
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

// The engine rolls a pending attack before the react prompt and keeps the result (hit, crit, damage) hidden
// from a human defender. A simulation must not read it either: it rolls the attack again with the engine's own
// resolveAttack, on the lookahead stream. The statuses and bonus the real roll already spent are put back as
// the real roll left them, so the re-roll does not spend them twice.
function rerollPending() {
  const p = S.pendingAction;
  if (!p?.result || p.result.atkRoll === '—') return;   // nothing was rolled (an effect-only move)
  const attacker = getCombatant(p.attackerId ?? p.casterId);
  const defender = getCombatant(p.defenderId ?? p.targetIds?.[0]);
  if (!attacker || !defender) return;
  const kept = [attacker, defender].map(c => [c, c.statusEffects.map(e => ({ ...e })), c.shadowCounterBonus]);
  p.result = p.type === 'attack'
    ? resolveAttack(attacker, defender, null)
    : resolveAttack(attacker, defender, p.ability?.dice ?? '0', p.ability);
  for (const [c, effects, bonus] of kept) { c.statusEffects = effects; c.shadowCounterBonus = bonus; }
}

// Scores a react choice on the pending react prompt: the pending attack is rolled again on the lookahead stream,
// the choice answers the first react, the greedy policy any that follow, then the fight is played on as in
// simulate
export function simulateReact(choice, teamIndex, seed) {
  if (!S.awaitingReact || !S.pendingAction) throw new Error('simulateReact needs a pending react');
  return run(snapshot(), seed, () => {
    rerollPending();
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
  if (decidingTeam(c) !== teamIndex) throw new Error(`search for team ${teamIndex}, but the active unit ${c.name} is decided by team ${decidingTeam(c)}`);
  if (S.awaitingReact) throw new Error('search cannot plan a turn while a react is pending');

  const plans = enumeratePlans(c);
  if (plans.length === 1) return { plan: plans[0], sims: 0, ms: performance.now() - t0 };

  const base = (seed ?? Date.now()) >>> 0;
  const deadline = deadlineOf(b, t0);
  const horizon = horizonFor(livingCount());
  const snap = snapshot();
  const sums = new Float64Array(plans.length), counts = new Uint32Array(plans.length);
  const lethal = new Uint8Array(plans.length), out = { ko: false };
  // Ties go to the plan that ends nearest a foe (by walking), then to enumeration order: holding never wins a tie
  const approach = plans.map(p => {
    const x = p.move?.x ?? c.x, y = p.move?.y ?? c.y;
    let d = Infinity;
    for (const f of S.combatants) if (!f.isKO && f.teamIndex !== teamIndex) d = Math.min(d, walkDistance(f.x, f.y, x, y));
    return d;
  });
  let sims = 0, simMs = 0;
  // Time is up when the next simulation, at the mean pace so far, would end past the deadline
  const late = () => performance.now() + simMs / Math.max(1, sims) >= deadline;
  const sample = i => {
    const s0 = performance.now();
    sums[i] += run(snap, sampleSeed(base, counts[i]), () => playOut(plans[i], teamIndex, horizon, out));
    if (out.ko) lethal[i] = 1;
    counts[i]++; sims++;
    simMs += performance.now() - s0;
  };
  const mean = i => sums[i] / counts[i];
  const byMean = ids => ids.sort((x, y) => mean(y) - mean(x) || approach[x] - approach[y]);   // stable

  // Pass 1: one sample each, two when the budget allows (on a clock, stops once time is up but never before
  // the first sample). Up to MAX_LETHAL plans whose sample KO'd a foe survive the cut whatever their mean: a
  // lucky kill is worth a closer look rather than a single unlucky roll deciding against it.
  const firstPass = b.sims !== undefined && b.sims >= 2 * plans.length ? 2 : 1;
  let alive = [];
  for (let i = 0; i < plans.length; i++) {
    if (i && late()) break;
    for (let k = 0; k < firstPass; k++) sample(i);
    alive.push(i);
  }
  alive = byMean(alive);
  alive = [...alive.slice(0, MAX_KEPT), ...alive.slice(MAX_KEPT).filter(i => lethal[i]).slice(0, MAX_LETHAL)];

  // Successive halving: the survivors share what is left, then the better half goes on. Each round's share is
  // rounded up, so a sims budget is spent to the last simulation by the final pair.
  const left = () => (b.sims !== undefined ? b.sims - sims
    : Math.floor((deadline - performance.now()) / (simMs / sims)));
  let spent = false;
  while (alive.length > 1 && !spent) {
    const rounds = Math.ceil(Math.log2(alive.length));
    const budgetLeft = left();
    if (budgetLeft <= 0) break;
    const per = Math.max(1, Math.ceil(budgetLeft / (rounds * alive.length)));
    for (let k = 0; k < per && !spent; k++) {
      for (const i of alive) {
        if (late() || (b.sims !== undefined && sims >= b.sims)) { spent = true; break; }
        sample(i);
      }
    }
    alive = byMean(alive);
    if (!spent) alive = alive.slice(0, Math.ceil(alive.length / 2));
  }
  // A budget that ran out mid-round leaves some survivors one sample short: pick among the most sampled
  const most = Math.max(...alive.map(i => counts[i]));
  return { plan: plans[alive.find(i => counts[i] === most)], sims, ms: performance.now() - t0 };
}
