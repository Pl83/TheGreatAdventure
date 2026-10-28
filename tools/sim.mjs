// Development-only: node tools/sim.mjs "A1; A2" "B1; B2" --fights 50 [--budget 200] [--map slug]
//   [--brain-a ai|greedy] [--brain-b ai|greedy] [--swap] [--seed 1]
// Plays the two teams against each other and prints win rates, first KOs and move use.
// Exit code: 0 clean, 2 when any rule violation was recorded, 1 on bad arguments.
import { playFight } from './fight.mjs';
import { greedyBrain } from '../js/ai/greedy.js';

const USAGE = 'usage: node tools/sim.mjs "A1; A2" "B1; B2" [--fights N] [--budget MS] [--map SLUG] [--brain-a ai|greedy] [--brain-b ai|greedy] [--swap] [--seed N]';
const fail = msg => { console.error(msg); process.exit(1); };

function parseArgs(argv) {
  const o = { fights: 50, budget: 200, map: undefined, brainA: 'greedy', brainB: 'greedy', swap: false, seed: 1, teams: [] };
  const intArg = (name, v, min) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) fail(`${name} needs an integer >= ${min}, got "${v}"\n${USAGE}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o.teams.push(a.split(';').map(n => n.trim()).filter(Boolean)); continue; }
    if (a === '--swap') { o.swap = true; continue; }
    const v = argv[++i];
    if (v === undefined) fail(`${a} needs a value\n${USAGE}`);
    switch (a) {
      case '--fights': o.fights = intArg(a, v, 1); break;
      case '--budget': o.budget = intArg(a, v, 1); break;
      case '--seed':   o.seed = intArg(a, v, 0); break;
      case '--map':    o.map = v; break;
      case '--brain-a': case '--brain-b':
        if (v !== 'ai' && v !== 'greedy') fail(`${a} must be ai or greedy, got "${v}"`);
        o[a === '--brain-a' ? 'brainA' : 'brainB'] = v; break;
      default: fail(`unknown option ${a}\n${USAGE}`);
    }
  }
  if (o.teams.length !== 2 || o.teams.some(t => !t.length)) fail(`need exactly two non-empty teams\n${USAGE}`);
  return o;
}

const o = parseArgs(process.argv.slice(2));
const [teamI, teamII] = o.teams;

// Until a real search brain exists, ai plays as greedy
function brainFor(kind) {
  if (kind === 'ai') console.error('note: the ai brain is not available yet; falling back to greedy');
  return greedyBrain;
}
const brainI = brainFor(o.brainA), brainII = brainFor(o.brainB);

// Each entry is one fight, with results attributed to the named teams rather than the seats
const fights = [];
try {
  for (let i = 0; i < o.fights; i++) {
    const seed = o.seed + i;
    const base = { seed, map: o.map };
    const r = await playFight({ ...base, teamA: teamI, teamB: teamII, brains: [brainI, brainII] });
    fights.push({ ...r, winnerTeam: r.winner === null ? null : r.winner });
    if (o.swap) {
      const s = await playFight({ ...base, teamA: teamII, teamB: teamI, brains: [brainII, brainI] });
      fights.push({ ...s, winnerTeam: s.winner === null ? null : 1 - s.winner });
    }
  }
} catch (err) {
  if (/^Unknown character/.test(err.message)) fail(err.message);
  throw err;
}

const pct = n => `${(100 * n / fights.length).toFixed(1)}%`;
const tally = pick => fights.reduce((m, f) => { for (const [k, n] of Object.entries(pick(f))) m[k] = (m[k] ?? 0) + n; return m; }, {});
const sum = key => fights.reduce((n, f) => n + f[key], 0);
const wins = [0, 1].map(t => fights.filter(f => f.winnerTeam === t).length);
const stalled = fights.filter(f => f.stalled).length;
const violations = fights.flatMap(f => f.violations);

console.log(`Team I:  ${teamI.join('; ')}  [${o.brainA}]`);
console.log(`Team II: ${teamII.join('; ')}  [${o.brainB}]`);
console.log(`${fights.length} fights, seeds ${o.seed}..${o.seed + o.fights - 1}${o.swap ? ', seats swapped' : ''}, map ${o.map ?? 'manor_of_nadargath'}`);
console.log('');
console.log(`Team I wins:  ${wins[0]} (${pct(wins[0])})`);
console.log(`Team II wins: ${wins[1]} (${pct(wins[1])})`);
console.log(`Stalled:      ${stalled} (${pct(stalled)})`);
console.log(`Mean rounds:  ${(sum('rounds') / fights.length).toFixed(1)}`);
console.log('');
console.log('first KO frequency:');
const firstKos = tally(f => (f.firstKo ? { [f.firstKo]: 1 } : {}));
for (const [name, n] of Object.entries(firstKos).sort((a, b) => b[1] - a[1])) console.log(`  ${name}: ${n} (${pct(n)})`);
console.log('');
console.log('move uses:');
for (const [move, n] of Object.entries(tally(f => f.moveUses)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`  ${move}: ${n}`);
console.log('');
console.log(`once-per-fight uses: ${sum('oncePerFightUses')}   reacts played: ${sum('reactsPlayed')}   control-then-ally: ${sum('controlThenAlly')}`);
console.log(`slowest decision: ${Math.max(...fights.map(f => f.maxDecisionMs)).toFixed(1)} ms (budget ${o.budget} ms)`);
console.log('');
console.log(`violations: ${violations.length}`);
for (const v of violations) console.log(`  [${v.kind}] seed ${v.seed} round ${v.round}: ${v.detail}`);
process.exit(violations.length ? 2 : 0);
