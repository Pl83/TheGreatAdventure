// Development-only: node tools/acceptance.mjs [--quick] [--workers N]
// The project's acceptance checks, run in order, each printed as PASS or FAIL with its numbers:
//   1 strength        the ai against greedy on 4 team pairs, the ai playing each team from each seat: >= 80% wins
//   2 violations      200 mixed fights (ai against ai, ai against greedy in both seatings): zero violations,
//                     a stall (no winner by the round cap) counted as one
//   3 determinism     one ai-against-ai fight played twice from its seed: identical results, timing aside
//   4 time            the slowest decision under { ms: 8000 } over 5 fights stays within 8000 ms
//   5 demonstrations  over stage 2's ai-against-ai fights, once-per-fight uses, control-then-ally and reacts
//                     all above zero
// --quick shrinks every stage to a smoke test (a few fights; a small budget except for strength); the bars stay
// the same.
// Fights run on worker threads (--workers, default half the cores), except stage 4, which runs alone so the
// clock it reads is not shared. Exit code: 0 when every stage passes, 1 otherwise.
import { isDeepStrictEqual } from 'node:util';
import { runFights, defaultWorkers } from './pool.mjs';
import { DEFAULT_SIMS } from '../js/ai/brain.js';
import { MAX_MS } from '../js/ai/search.js';

const USAGE = 'usage: node tools/acceptance.mjs [--quick] [--workers N]';
const WIN_BAR = 0.8;

// Team pairs: sizes 5v5 (the spec matchup), 3v3, 2v2 and 1v1, each roughly even under greedy against greedy
const SPEC = [
  ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'],
  ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'],
];
const TRIO = [['Kadgar', 'Baal', 'Eragon'], ['Akir', 'Future Zane', 'Vayl-Soran']];
const DUO  = [['MaracachaCoocaracha', 'Mira'], ['Nate', 'Jhin']];
const DUEL = [['Jhin'], ['Kaelgrym']];
const PAIRS = [SPEC, TRIO, DUO, DUEL];
// Stage 2 mixes in one more pair, a 2v2 the strength pairs do not cover
const MIXED = [...PAIRS, [['Vayl-Soran', 'Future Zane'], ['Ronin Lloyd', 'Mira']]];

const FULL = {
  strength:    { pairs: PAIRS, seeds: 4, budget: { sims: DEFAULT_SIMS } },            // 4 x 4 x 4 = 64 fights
  violations:  { pairs: MIXED, fights: 200, budget: { sims: DEFAULT_SIMS } },
  determinism: { pair: SPEC, budget: { sims: DEFAULT_SIMS } },
  time:        { pair: DUEL, fights: 5, budget: { ms: MAX_MS } },
};
const QUICK = {
  // Strength at a reduced budget would test a weaker brain than the one shipped: a few fights at the real one
  strength:    { pairs: [SPEC, DUO], seeds: 1, budget: { sims: DEFAULT_SIMS } },     // 8 fights
  violations:  { pairs: [SPEC, DUO], fights: 6, budget: { sims: 60 } },
  determinism: { pair: DUEL, budget: { sims: 60 } },
  time:        { pair: DUEL, fights: 1, budget: { ms: 150 } },
};

function parseArgs(argv) {
  const o = { quick: false, workers: defaultWorkers() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--quick') o.quick = true;
    else if (argv[i] === '--workers' && Number.isInteger(+argv[i + 1]) && +argv[i + 1] >= 1) o.workers = +argv[++i];
    else { console.error(USAGE); process.exit(1); }
  }
  return o;
}

// One fight: `kinds` and `teams` give, per seat, the brain kind and the named team (0 or 1) it plays
const job = (pair, teams, kinds, seed, budget) => ({ teamA: pair[teams[0]], teamB: pair[teams[1]], seed, kinds, teams, budget });
const pct = (n, of) => `${(100 * n / of).toFixed(1)}%`;
const sum = (rs, key) => rs.reduce((n, r) => n + r[key], 0);
const listViolations = rs => rs.flatMap(r => r.violations).map(v => `      [${v.kind}] seed ${v.seed} round ${v.round}: ${v.detail}`);

const o = parseArgs(process.argv.slice(2));
const P = o.quick ? QUICK : FULL;
const run = jobs => runFights(jobs, { workers: o.workers });
const verdicts = [];

function report(name, pass, line, details = []) {
  verdicts.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${line}`);
  for (const d of details) console.log(d);
}

const describe = b => ('sims' in b ? `${b.sims} sims/decision` : `${b.ms} ms/decision`);
console.log(`acceptance${o.quick ? ' --quick' : ''}: ${o.workers} worker(s)`);
const t0 = performance.now();

// 1. Strength
{
  const { pairs, seeds, budget } = P.strength;
  const fights = [];
  for (const pair of pairs) {
    for (let seed = 1; seed <= seeds; seed++) {
      for (const ai of [0, 1]) {
        for (const seat of [0, 1]) {
          const teams = seat === 0 ? [ai, 1 - ai] : [1 - ai, ai];
          fights.push({ pair, seat, job: job(pair, teams, teams.map(t => (t === ai ? 'ai' : 'greedy')), seed, budget) });
        }
      }
    }
  }
  const rs = await run(fights.map(f => f.job));
  const outcomes = rs.map((r, i) => ({ pair: fights[i].pair, won: r.winner === fights[i].seat, stalled: r.stalled }));
  const won = outcomes.filter(f => f.won).length;
  const perPair = pairs.map(pair => {
    const mine = outcomes.filter(f => f.pair === pair);
    const names = team => team.length > 1 ? `${team[0]} +${team.length - 1}` : team[0];
    return `      ${pair[0].length}v${pair[1].length} ${names(pair[0])} vs ${names(pair[1])}: ai won ${mine.filter(f => f.won).length}/${mine.length}, `
      + `stalled ${mine.filter(f => f.stalled).length}`;
  });
  report('strength', won / rs.length >= WIN_BAR,
    `ai won ${won} of ${rs.length} fights against greedy (${pct(won, rs.length)}, bar ${WIN_BAR * 100}%) at ${describe(budget)}`, perPair);
}

// 2. Violations (and the fights stage 5 counts)
let aiOnly;
{
  const { pairs, fights: n, budget } = P.violations;
  const KINDS = [['ai', 'ai'], ['ai', 'greedy'], ['greedy', 'ai']];
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(job(pairs[i % pairs.length], [0, 1], KINDS[Math.floor(i / pairs.length) % KINDS.length], 1000 + i, budget));
  }
  const rs = await run(jobs);
  aiOnly = rs.filter((_, i) => jobs[i].kinds.every(k => k === 'ai'));
  const vs = rs.flatMap(r => r.violations);
  const stalled = rs.filter(r => r.stalled).length;
  report('violations', vs.length === 0,
    `${vs.length} violation(s) over ${rs.length} fights (${stalled} stalled; ${aiOnly.length} ai vs ai, ${rs.length - aiOnly.length} ai vs greedy), seeds 1000..${999 + n}`,
    listViolations(rs));
}

// 3. Determinism: the same fight in two workers
{
  const { pair, budget } = P.determinism;
  const fight = job(pair, [0, 1], ['ai', 'ai'], 77, budget);
  const [a, b] = await run([fight, fight]);
  const strip = ({ maxDecisionMs, ...rest }) => rest;
  report('determinism', isDeepStrictEqual(strip(a), strip(b)),
    `seed 77, ${pair[0].length}v${pair[1].length} ai vs ai played twice: ${isDeepStrictEqual(strip(a), strip(b)) ? 'identical' : 'DIFFERENT'} `
    + `(winner ${a.winner}, ${a.rounds} rounds, ${a.kos.length} KOs, ${Object.keys(a.moveUses).length} distinct moves)`);
}

// 4. Time: on its own, one fight at a time
{
  const { pair, fights: n, budget } = P.time;
  const jobs = [];
  for (let i = 0; i < n; i++) jobs.push(job(pair, i % 2 ? [1, 0] : [0, 1], i % 2 ? ['greedy', 'ai'] : ['ai', 'greedy'], 500 + i, budget));
  const rs = await runFights(jobs, { workers: 1 });
  const slowest = Math.max(...rs.map(r => r.maxDecisionMs));
  report('time', slowest <= MAX_MS,
    `slowest decision ${slowest.toFixed(0)} ms over ${n} fight(s) at ${describe(budget)} (cap ${MAX_MS} ms)`);
}

// 5. Demonstrations, from stage 2's ai-against-ai fights
{
  const totals = { oncePerFightUses: sum(aiOnly, 'oncePerFightUses'), controlThenAlly: sum(aiOnly, 'controlThenAlly'), reactsPlayed: sum(aiOnly, 'reactsPlayed') };
  report('demonstrations', Object.values(totals).every(n => n > 0),
    `over ${aiOnly.length} ai vs ai fights: once-per-fight uses ${totals.oncePerFightUses}, control-then-ally ${totals.controlThenAlly}, reacts played ${totals.reactsPlayed}`);
}

const passed = verdicts.filter(Boolean).length;
console.log(`\n${passed} of ${verdicts.length} stages passed in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
process.exit(passed === verdicts.length ? 0 : 1);
