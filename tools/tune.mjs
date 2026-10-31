// Development-only: tunes the evaluation weights of the ai brain by playing weight sets against each other.
//   node tools/tune.mjs [--hours H | --minutes M] [--iterations N] [--sims N] [--matchups N] [--workers N]
//                       [--check-every N] [--confirm N] [--seed N] [--dir PATH] [--fresh]
//   node tools/tune.mjs --apply [--force] [--dir PATH]
// It needs no model and no network: only the fights, played on worker threads. Start it, leave it, read the
// summary. State is saved after every iteration, so it can be stopped (Ctrl+C) and resumed by running it again.
//
// Each iteration: a random direction in log-weight space gives two neighbouring weight sets, + and -; they play
// `--matchups` random matchups (teams of 1 to 3 drawn from the whole roster, on the three maps in turn), each
// matchup in both seatings; the weights move toward the winner (SPSA, see tune-lib.mjs).
// Every `--check-every` iterations the current weights play the weights the run started from, on fresh fights;
// the best of those checks is kept. At the end, that best set plays the starting weights again on seeds nothing
// else used (`--confirm` matchups) and the win rate is reported with its 95% interval.
// --apply writes the best set into WEIGHTS in js/ai/evaluate.js, but only when the confirmation's lower bound is
// above 50% (or with --force). Then run tools/acceptance.mjs, whose strength seeds are held out from this too.
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFights, defaultWorkers } from './pool.mjs';
import { WEIGHTS, TUNABLE } from '../js/ai/evaluate.js';
import { mulberry32 } from '../js/rng.js';
import {
  direction, perturbation, toWeights, toTheta, shifted, update, randomMatchups, matchJobs, scoreFirst, matchResult,
  wilson, applyWeights,
} from './tune-lib.mjs';

const USAGE = 'usage: node tools/tune.mjs [--hours H | --minutes M] [--iterations N] [--sims N] [--matchups N] [--workers N] [--check-every N] [--confirm N] [--seed N] [--dir PATH] [--fresh]\n       node tools/tune.mjs --apply [--force] [--dir PATH]';
const ROOT = new URL('../', import.meta.url);
const EVALUATE = new URL('js/ai/evaluate.js', ROOT);

function parseArgs(argv) {
  const o = { minutes: null, iterations: Infinity, sims: 150, matchups: 6, workers: defaultWorkers(), checkEvery: 10,
    confirm: 40, seed: 1, dir: new URL('.tune/', import.meta.url), fresh: false, apply: false, force: false };
  const num = (flag, v, min = 1) => { const n = Number(v); if (!(n >= min)) fail(`${flag} needs a number >= ${min}`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    switch (a) {
      case '--hours':       o.minutes = 60 * num(a, v, 0.01); i++; break;
      case '--minutes':     o.minutes = num(a, v, 0.1); i++; break;
      case '--iterations':  o.iterations = num(a, v); i++; break;
      case '--sims':        o.sims = num(a, v); i++; break;
      case '--matchups':    o.matchups = num(a, v); i++; break;
      case '--workers':     o.workers = num(a, v); i++; break;
      case '--check-every': o.checkEvery = num(a, v); i++; break;
      case '--confirm':     o.confirm = num(a, v, 0); i++; break;
      case '--seed':        o.seed = num(a, v, 0); i++; break;
      case '--dir':         o.dir = pathToFileURL(resolve(String(v)) + sep); i++; break;
      case '--fresh':       o.fresh = true; break;
      case '--apply':       o.apply = true; break;
      case '--force':       o.force = true; break;
      default: fail(`unknown argument ${a}`);
    }
  }
  return o;
}
function fail(msg) { console.error(msg); console.error(USAGE); process.exit(1); }

const o = parseArgs(process.argv.slice(2));
const STATE = new URL('state.json', o.dir);
const LOG = new URL('log.txt', o.dir);

const round = w => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v.toPrecision(3))]));
const fmt = w => TUNABLE.map(k => `${k} ${Number(w[k].toPrecision(3))}`).join('  ');
const say = async line => { console.log(line); await appendFile(LOG, line + '\n'); };
const readState = async () => { try { return JSON.parse(await readFile(STATE, 'utf8')); } catch { return null; } };
const saveState = state => writeFile(STATE, JSON.stringify(state, null, 2));

// ── --apply ────────────────────────────────────────────────────────────────

if (o.apply) {
  const state = await readState();
  if (!state?.best) fail('no tuned weights yet: run the tuner first');
  const c = state.best.confirm;
  if (!c && !o.force) fail('the best weights were never confirmed on held-out fights: let the run finish, or use --force');
  if (c && c.low <= 0.5 && !o.force) {
    fail(`not applied: confirmed win rate ${(100 * c.rate).toFixed(1)}% over ${c.games} fights, interval ${(100 * c.low).toFixed(1)}-${(100 * c.high).toFixed(1)}% includes 50% (use --force to apply anyway)`);
  }
  await writeFile(EVALUATE, applyWeights(await readFile(EVALUATE, 'utf8'), state.best.weights));
  console.log('js/ai/evaluate.js updated:');
  console.log(`  ${fmt(state.best.weights)}`);
  console.log('Next: node tools/acceptance.mjs --quick, then the full acceptance run, then commit.');
  process.exit(0);
}

// ── the run ────────────────────────────────────────────────────────────────

await mkdir(o.dir, { recursive: true });
const names = JSON.parse(await readFile(new URL('js/characters.json', ROOT), 'utf8')).map(c => c.nom);
const maps = JSON.parse(await readFile(new URL('maps/manifest.json', ROOT), 'utf8'));
const startWeights = Object.fromEntries(TUNABLE.map(k => [k, WEIGHTS[k]]));

let state = o.fresh ? null : await readState();
if (state) {
  const same = TUNABLE.every(k => Math.abs(state.start[k] - startWeights[k]) < 1e-9);
  if (!same) fail('state.json was started from other weights than WEIGHTS in evaluate.js now holds (an --apply, or weights added since): use --fresh');
} else {
  state = { start: startWeights, theta: toTheta(startWeights), iter: 0, best: null, seed: o.seed, history: [] };
}
const start = toTheta(state.start);
const run = jobs => runFights(jobs, { workers: o.workers });

const t0 = Date.now();
const deadline = o.minutes ? t0 + o.minutes * 60_000 : Infinity;
let stopping = false;
process.on('SIGINT', () => { if (stopping) process.exit(1); stopping = true; console.log('\nstopping after this iteration (Ctrl+C again to quit now)...'); });

// The score of `first` against `second` over fresh random matchups: { points, games }
async function playMatch(first, second, count, seedBase, matchupSeed) {
  const matchups = randomMatchups(names, count, matchupSeed);
  const results = await run(matchJobs(matchups, first, second, { seedBase, maps, sims: o.sims }));
  return scoreFirst(results);
}

await say(`tuner: ${o.sims} sims/decision, ${o.matchups} matchups x 2 seats per iteration, ${o.workers} workers, maps ${maps.join(', ')}`);
await say(`start: ${fmt(state.start)}`);
let failures = 0;

while (!stopping && state.iter < o.iterations && Date.now() < deadline) {
  const k = state.iter, rng = mulberry32((state.seed * 1_000_003 + k) >>> 0);
  const dir = direction(TUNABLE, rng), c = perturbation(k);
  const plus = toWeights(shifted(state.theta, dir, +c, start)), minus = toWeights(shifted(state.theta, dir, -c, start));
  try {
    const score = await playMatch(plus, minus, o.matchups, 10_000 + 100 * k, state.seed * 7919 + k);
    const r = matchResult(score);
    state.theta = update(state.theta, dir, r, k, start);
    state.history.push({ iter: k, r: Number(r.toFixed(3)) });
    state.history = state.history.slice(-1000);
    failures = 0;
    await say(`iter ${String(k).padStart(4)}  + scored ${score.points}/${score.games}  r ${r >= 0 ? '+' : ''}${r.toFixed(2)}  weights ${fmt(toWeights(state.theta))}`);

    if ((k + 1) % o.checkEvery === 0) {
      const check = await playMatch(toWeights(state.theta), startWeights, 2 * o.matchups, 400_000 + 100 * k, state.seed * 104729 + k);
      const rate = check.points / check.games;
      await say(`  check  current vs start weights: ${check.points}/${check.games} (${(100 * rate).toFixed(1)}%)${!state.best || rate > state.best.checkRate ? '  <- best so far' : ''}`);
      if (!state.best || rate > state.best.checkRate) state.best = { weights: round(toWeights(state.theta)), checkRate: rate, iter: k };
    }
  } catch (err) {
    await say(`iter ${k} failed: ${String(err.message).split('\n')[0]}`);
    if (++failures >= 5) { await say('five failures in a row: stopping'); break; }
  }
  state.iter = k + 1;
  await saveState(state);
}

// ── confirmation on fights nothing else used ───────────────────────────────

if (o.confirm > 0 && state.best && !stopping) {
  const bestWeights = { ...startWeights, ...state.best.weights };
  const res = await playMatch(bestWeights, startWeights, o.confirm, 9_000_000, state.seed * 15485863);
  const ci = wilson(res.points, res.games);
  state.best.confirm = { rate: res.points / res.games, games: res.games, low: ci.low, high: ci.high };
  await say(`confirm  best (iter ${state.best.iter}) vs start weights on held-out fights: ${res.points}/${res.games} = ${(100 * state.best.confirm.rate).toFixed(1)}%, 95% interval ${(100 * ci.low).toFixed(1)}-${(100 * ci.high).toFixed(1)}%`);
  await saveState(state);
}

const mins = ((Date.now() - t0) / 60_000).toFixed(1);
await say(`done: ${state.iter} iterations total, ${mins} min this run`);
if (state.best) {
  await say(`best: ${fmt({ ...startWeights, ...state.best.weights })}`);
  const c = state.best.confirm;
  await say(c ? (c.low > 0.5 ? 'confirmed better than the start weights: node tools/tune.mjs --apply' : 'not confirmed better than the start weights: keep running, or --apply --force')
              : 'not confirmed yet: let a run finish, or run again');
} else {
  await say('no check has run yet: nothing to report');
}
