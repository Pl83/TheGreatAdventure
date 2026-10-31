// Development-only: the pure parts of the weight tuner (tools/tune.mjs), kept apart so tests can reach them.
// The method is SPSA run as head-to-head matches. Every iteration nudges all the evaluation weights at once, in
// log space, in a random direction (+) and its opposite (-), plays the two weight sets against each other, and
// moves the weights a little toward whichever set won.
import { mulberry32 } from '../js/rng.js';

export const LOG_BOUND = Math.log(10);   // a weight never strays further than a factor 10 from where it started

// ── Perturbation and update ────────────────────────────────────────────────

// Learning rate and perturbation size at iteration k: both shrink slowly, so late iterations settle
export const learningRate = k => 0.1 / (1 + k / 200) ** 0.6;
export const perturbation = k => 0.2 / (1 + k / 300) ** 0.2;

// A random direction: +1 or -1 for every tuned weight
export function direction(keys, rng) {
  return Object.fromEntries(keys.map(k => [k, rng() < 0.5 ? -1 : 1]));
}

// theta (log weights) moved by `step` along dir, kept within LOG_BOUND of the starting log weights
export function shifted(theta, dir, step, start) {
  const out = {};
  for (const k of Object.keys(theta)) {
    out[k] = Math.min(start[k] + LOG_BOUND, Math.max(start[k] - LOG_BOUND, theta[k] + step * dir[k]));
  }
  return out;
}

export const toWeights = theta => Object.fromEntries(Object.entries(theta).map(([k, v]) => [k, Math.exp(v)]));
export const toTheta = weights => Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Math.log(v)]));

// One SPSA step from a match result r in [-1, 1] (the + set's score minus the - set's): move toward the winner
export function update(theta, dir, r, k, start) {
  return shifted(theta, dir, learningRate(k) * r, start);
}

// ── Matchups ───────────────────────────────────────────────────────────────

// `count` random matchups, team sizes cycling through `sizes`; both sides are drawn without repeats. Seat swaps
// make every matchup fair whatever its balance, so lopsided ones only add no signal, never a bias.
export function randomMatchups(names, count, seed, sizes = [1, 2, 3]) {
  const rng = mulberry32(seed >>> 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    const n = sizes[i % sizes.length];
    const pool = [...names];
    const take = () => Array.from({ length: n }, () => pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    out.push({ a: take(), b: take() });
  }
  return out;
}

// The fights of one weight-set match: each matchup played twice, the two sets exchanging seats.
// Job order: for matchup i, jobs 2i (set `first` in seat 0) and 2i + 1 (set `first` in seat 1).
export function matchJobs(matchups, first, second, { seedBase, maps, sims }) {
  const jobs = [];
  matchups.forEach((m, i) => {
    const seed = seedBase + i, map = maps[(seedBase + i) % maps.length];
    const common = { seed, map, kinds: ['ai', 'ai'], budget: { sims } };
    jobs.push({ ...common, teamA: m.a, teamB: m.b, weights: [first, second] });
    jobs.push({ ...common, teamA: m.b, teamB: m.a, weights: [second, first] });
  });
  return jobs;
}

// The score of the `first` set over the results of matchJobs: a win counts 1, a stall 0.5
export function scoreFirst(results) {
  let points = 0;
  results.forEach((r, i) => {
    const firstSeat = i % 2;   // even jobs seat `first` in seat 0, odd jobs in seat 1
    points += r.winner === null || r.stalled ? 0.5 : r.winner === firstSeat ? 1 : 0;
  });
  return { points, games: results.length };
}

// A match result in [-1, 1] for the + set, from its score against the - set (both over the same fights)
export const matchResult = ({ points, games }) => (2 * points - games) / games;

// 95% Wilson interval of a win rate: the honest range a few dozen fights allow
export function wilson(points, games, z = 1.96) {
  if (!games) return { low: 0, high: 1 };
  const p = points / games, d = 1 + z * z / games;
  const centre = (p + z * z / (2 * games)) / d;
  const half = z * Math.sqrt(p * (1 - p) / games + z * z / (4 * games * games)) / d;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

// ── Writing the result back ────────────────────────────────────────────────

const BLOCK = /(export const WEIGHTS = Object\.freeze\(\{)([\s\S]*?)(\n\}\);)/;

// The source of evaluate.js with the WEIGHTS values replaced (three significant digits); comments stay.
export function applyWeights(source, weights) {
  const m = source.match(BLOCK);
  if (!m) throw new Error('WEIGHTS block not found in evaluate.js');
  let body = m[2];
  for (const [key, value] of Object.entries(weights)) {
    const line = new RegExp(`^(\\s+${key}:\\s*)(-?[\\d.]+)(,)`, 'm');
    if (!line.test(body)) throw new Error(`weight "${key}" not found in the WEIGHTS block`);
    body = body.replace(line, (_, head, __, comma) => `${head}${Number(value.toPrecision(3))}${comma}`);
  }
  return source.replace(BLOCK, `$1${body}$3`);
}
