# Combat AI and fight runner

Development notes for the computer player (`js/ai/`) and the command-line tools that play fights with it
(`tools/`). The tools are development-only: the site never loads them, and nothing here needs a package
install (Node 20 or later, no dependencies).

## Running fights: `tools/sim.mjs`

```
node tools/sim.mjs "A1; A2" "B1; B2" [--fights N] [--budget SIMS] [--map SLUG]
                   [--brain-a ai|greedy] [--brain-b ai|greedy] [--swap] [--seed N]
```

Example, the spec matchup with the brain on team I against the greedy baseline:

```
node tools/sim.mjs "Zhuqiao, Vermillion Bird; Jay, Azure Dragon; Jeagen, White Tiger; Black Turtle; Meï" "Admiral Jaina; Thormak, The Titan Slayer; Susano; Alicia; Sensei Lloyd" --fights 50 --brain-a ai
```

- Team members are separated by `;` and must match a `nom` in `js/characters.json` exactly (an unknown name
  is refused with the three closest names; an empty team is refused too).
- `--fights` (default 50): fights number `--seed`, `--seed + 1`, ... (default seed 1). One seed decides the
  whole fight: initiative, placement and every die.
- `--brain-a`, `--brain-b` (default `greedy`): who plays each team. `ai` is the look-ahead brain, `greedy`
  the baseline (walk to the nearest foe, cast the highest-damage ability, take the first non-teleport react).
- `--budget` (default `DEFAULT_SIMS` from `js/ai/brain.js`): the ai brain's simulations per decision. A fixed
  count, not a clock, so the same seed replays the same fight on any machine.
- `--swap`: each seed is also played with the two teams' seats exchanged (both seatings reuse the seed).
- `--map` (default `manor_of_nadargath`): a slug from `maps/manifest.json` (an unknown slug is refused with
  the list of known ones).
- Exit code: 0 clean, 2 when any violation was recorded, 1 on bad arguments.

A 50-fight batch of the spec matchup at the default budget (`DEFAULT_SIMS = 500`) took 15.6 minutes (see below).

### The report

| Line | Meaning |
|---|---|
| `Team I wins`, `Team II wins` | Fights won by each named team (seat swaps are folded back to the team). |
| `Stalled` | Fights with no winner when the round cap (40) was reached. |
| `Mean rounds` | Average fight length, a stalled fight counting as 40. |
| `first KO frequency` | How often each character was the first unit knocked out. |
| `move uses` | Accepted attacks and casts per `character / move`, over the batch. |
| `once-per-fight uses` | Casts of `cooldown: 99` moves. |
| `reacts played` | React prompts answered with a react (declines not counted). |
| `control-then-ally` | Times a unit hit a foe that an ally's move had put under stun, para, gel, freeze or fear. |
| `slowest decision` | The longest single `chooseTurn` / `chooseReact` call, in ms. |
| `violations` | Each rule breach with its kind, seed and round (below). |

### Violation kinds

The checker (`tools/checks.mjs`) reads the character sheets, not the engine's own counters, and checks the
fight before and after every action.

| Kind | Filed when |
|---|---|
| `exception` | Something threw: the engine during a fight (with the stack), or a brain that fell back to the greedy plan (`brain fallback: ...`). |
| `rejected-plan` | The engine refused a plan the brain believed legal. |
| `hp-out-of-range` | A unit's HP went above its max or below 0. |
| `resource-negative` | Spell slots, ki or souls went below 0. |
| `once-per-fight-reuse` | A `cooldown: 99` move was cast a second time. |
| `cooldown-ignored` | A move was cast again before its sheet cooldown allowed (waived while a domain lifts cooldowns). |
| `charges-exceeded` | A charged move was cast more times than the sheet's `charges`. |
| `ko-acted` | A unit that was KO had an action accepted. |
| `cell-unwalkable` | A living unit stands on a wall or off the map. |
| `cell-conflict` | Two living units share a cell. |
| `stalled` | The fight reached the round cap with no winner. It is a result of play, not a rule breach, but the acceptance run counts it: a brain that lets fights stall is not good enough. |

Each breach is filed once per fight even if it keeps standing. Reacts that are played go through the same
ledger as turn casts, so a once-per-fight or charged react used too often is caught too.

## Acceptance: `tools/acceptance.mjs`

```
node tools/acceptance.mjs            # the full run (about 26 minutes on a 6-core laptop)
node tools/acceptance.mjs --quick    # a smoke test of every stage in about 45 seconds
node tools/acceptance.mjs --workers 4
```

Runs five stages in order and prints `PASS` or `FAIL` with the numbers for each; exit 0 only when all pass.
Fights run on worker threads (`tools/pool.mjs`, `tools/fight-worker.mjs`; default half the logical cores),
and every fight is seeded, so the results do not depend on the worker count.

1. **strength**: the ai against greedy on four team pairs (5v5 spec matchup; Kadgar, Baal, Eragon vs Akir,
   Future Zane, Vayl-Soran; MaracachaCoocaracha, Mira vs Nate, Jhin; Jhin vs Kaelgrym), seeds 101-104. For
   each seed the ai plays each team from each seat: 64 fights. Pass at 80% ai wins or more. The pairs were picked
   for being roughly even under greedy against greedy, so the ai also has to win with the weaker side.
   **Seeds 101-104 were never used in tuning.** The weights were tuned on strength seeds 1-8 (ai vs greedy,
   same pairs and seatings) and ai-vs-ai seeds 2001-2008; the review also measured seeds 9-12. Stage 2's seeds
   1000-1199 were not used to choose weights, but two earlier full runs on them guided the stall fixes.
2. **violations**: 200 fights over those pairs plus Vayl-Soran, Future Zane vs Ronin Lloyd, Mira, cycling ai
   vs ai, ai vs greedy and greedy vs ai (seeds 1000-1199). Pass at zero violations, `stalled` included.
   All on the Manor of Nadargath: the spec asks for both maps, but `maps/manifest.json` lists only Manor and
   the random dungeon is not supported by the headless loader, so the second map is not covered.
3. **determinism**: one ai-vs-ai 5v5 fight (seed 77) played twice in two workers; the whole result except
   the timing must be identical.
4. **time**: 5 fights (4 duels and the spec 5v5) with the brain on a `{ ms: 8000 }` clock budget, one fight
   at a time with nothing else running; the slowest decision must stay within 8000 ms.
5. **demonstrations**: over stage 2's ai-vs-ai fights, once-per-fight uses, control-then-ally and reacts
   played must each be above zero.

`--quick` keeps the same bars and shrinks every stage: strength plays 8 fights (spec 5v5 and the 2v2, seed 1)
at the real `DEFAULT_SIMS` (a reduced budget would test a weaker brain than the one shipped), violations 6
fights at 60 simulations, determinism one duel at 60, time one duel on a 150 ms clock. It takes under a
minute; `tests/acceptance.test.mjs` runs it.

## How the brain works

**Look-ahead on the real engine.** On its turn the active unit's candidate plans are enumerated
(`candidates.js`): staying put and a handful of tactical cells (closest to the nearest foe, at each attack
range with sight, next to the weakest foe, a retreat when badly hurt), times every legal action from there
(attack, every ability with every sensible target set, area centre or cone direction, domain,
transformation, teleports with a few landing cells, pass). Each plan is played on the real engine
(`search.js`): the plan, then a fixed horizon of further unit turns for both sides, played by the greedy
policy (about half the living units plus one: 6 in a 5v5, never fewer than 3), with react prompts answered
greedily. The position reached is scored (`evaluate.js`) and the plan with the best mean score wins.
Because the real handlers run the simulation, the brain discovers what the rules reward (a stunned foe that
loses its turn, a wet target, a taunt, a heal) without a list of combos.

**Evaluation** (`WEIGHTS` in `evaluate.js`), from the scored side's point of view, own minus enemy:
3 per unit of HP fraction, 1.5 per living unit, 0.8 per unit under a control effect, 0.3 per silenced or
rooted unit, 0.15 per unspent once-per-fight or charged move, 0.005 per point of average damage in ready
damage moves. A won fight scores +30 and a lost one -30; every other position is bounded strictly inside
(-30, 30), so a rollout that wiped a side always ranks beyond one that did not, at any round and for any
roster, and 30 is still small enough that a rare won sample does not swamp a mean. One term is one-sided: the
**engagement** penalty, 0.05 per step an own unit must still walk before its longest reach covers the nearest
foe, multiplied by (1 + 0.25 x round)^2 so standoffs get broken, and capped at 10 (a third of a win). The search reads it when the candidate's own turn ends (against
the foes alive when the plan began, so a kill never reads as falling behind) and adds it to the material read
at the horizon: read at the horizon, it would only reflect the greedy rollout walking everyone in, and two
brains would wait for each other forever (the first acceptance run had every ai-vs-ai duel stall that way).

**Sampling.** Dice are random, so each plan is sampled several times and averaged. All plans are compared
under the same sample seeds (common random numbers). The first pass samples every plan once (twice when the
budget allows); the best 40, plus up to 10 more whose sample KO'd a foe, go on to successive halving: the
survivors share what is left of the budget, the better half goes on, until one remains. Ties go to the plan
ending nearest a foe. Reacts (`chooseReact`) score every react choice the same way over shared sample seeds.
The engine rolls a pending attack before the react prompt and hides the result from a human defender, so each
react simulation rolls that attack again with the engine's own `resolveAttack` on the lookahead stream: the
brain decides a react without knowing whether the real attack hit.

**Puppets.** A unit puppeteered by a living controller is played by the controller's side: the runner asks
that side's brain, and `search` accepts the controller's team (`decidingTeam` in `search.js`).

**Budgets.** `{ sims: n }`: exactly n simulations per decision once n covers the first pass (the runner's
default, `DEFAULT_SIMS` = 500: a 50-fight spec batch measured 15.6 minutes, under the owner's 20). `{ ms: t }`: a clock, capped at
8000 ms (`MAX_MS`). The deadline keeps a 2% margin (at most 100 ms) and no simulation starts that would, at the
mean pace so far, end past it, so a whole decision stays within the cap.

**Determinism and dice.** A brain made with a seed derives each decision's sample seeds from that seed and
the decision count, and a `{ sims }` budget makes the search independent of the clock: the same fight seed
replays identically. The lookahead rolls on its own seeded stream (`withRandom`); the fight's real dice
stream is never read or advanced by a search, so the brain cannot know the real upcoming rolls. In the
runner, each ai seat's brain is seeded from the fight's seed mixed with its team.

## API for the play-against-the-AI screen

```js
import { createBrain } from './js/ai/brain.js';
import { applyPlan, settleReacts } from './js/ai/apply.js';

const brain = createBrain({ budget: { ms: 3000 }, onError: (err, where) => console.warn(where, err) });
// The AI's unit is active:
applyPlan(brain.chooseTurn(aiTeamIndex));
// A react prompt for the AI's units is pending:
settleReacts(() => brain.chooseReact());
```

- `createBrain({ budget = { sims: DEFAULT_SIMS }, seed?, onError? })` returns `{ chooseTurn(teamIndex),
  chooseReact(), takeErrors() }`. It never throws: when the search fails it answers with the greedy plan or
  react, keeps the error and calls `onError(err, 'chooseTurn' | 'chooseReact')`.
- `chooseTurn(teamIndex)`: a whole turn plan `{ move: {x, y} | null, action }` for the active unit, which must
  be decided by `teamIndex` (its own team, or its puppeteer's: use `decidingTeam(unit)`). Play it with `applyPlan` (the same handlers a click reaches).
- `chooseReact()`: the choice for the pending react prompt, `{ combatantId, abilityName, dest? } | null`
  (decline), decided for the team that owns the first react option.
- `takeErrors()`: the errors recovered from since the last call, then clears them.
- The plain functions `chooseTurn(teamIndex, budget, seed)` and `chooseReact(teamIndex, budget, seed)` in
  `brain.js` do the same without the fallback and throw on error.
- **Headless while searching.** Every simulation switches the engine to headless mode (`setHeadless(true)`:
  no timers, no DOM, no render hooks) and restores the previous flag, the live state `S` and the real random
  stream afterwards, even when a simulation throws. The page must therefore not render or run engine timers
  in the middle of a search: call the brain between turns, from the page's own code, and apply the plan
  after it returns with the page's normal (non-headless) flag. The search is synchronous and holds the
  thread for its budget; the screen should use a short clock budget or run the brain in a Web Worker
  (not built yet).

## Engine bug found by the runner

- **A revive lands on an occupied cell.** `handleCastAbility` (`js/combat-logic.js`, the `isRevive` branch)
  sets the fallen unit back to life on the cell it fell on without checking that the cell is free. When an
  ally (or a foe) stands there, two living units share a cell. Reproduce: before the candidate filter below,
  `node tools/sim.mjs "Zhuqiao, Vermillion Bird; Jay, Azure Dragon; Jeagen, White Tiger; Black Turtle; Meï"
  "Admiral Jaina; Thormak, The Titan Slayer; Susano; Alicia; Sensei Lloyd" --fights 2 --brain-a ai --swap
  --budget 200 --seed 1` gave `cell-conflict` at seed 2, round 13 (Zhuqiao revives Jay while standing on
  Jay's cell). Left for the owner; the brain no longer offers a revive whose landing cell is taken.

## Results of the last full acceptance run

Run on 2026-10-28, Intel i7-10750H (6 cores, 12 threads), 6 workers, `DEFAULT_SIMS = 500`, after review fix
round 1 (score bound, engagement cap; no weight changed). **3 of 5 stages pass. Strength fails on held-out
seeds and violations fail on stalls; the brain does not yet meet the 80% and zero-stall criteria.**

```
acceptance: 6 worker(s)
FAIL  strength: ai won 47 of 64 fights against greedy (73.4%, bar 80%) at 500 sims/decision, seeds 101..104
      5v5 Zhuqiao, Vermillion Bird +4 vs Admiral Jaina +4: ai won 16/16, stalled 0
      3v3 Kadgar +2 vs Akir +2: ai won 12/16, stalled 1
      2v2 MaracachaCoocaracha +1 vs Nate +1: ai won 10/16, stalled 0
      1v1 Jhin vs Kaelgrym: ai won 9/16, stalled 0
FAIL  violations: 8 violation(s) over 200 fights (8 stalled; 70 ai vs ai, 130 ai vs greedy), seeds 1000..1199
      [stalled] seeds 1001, 1006, 1021, 1066, 1136, 1166, 1180, 1195, each at round 40
PASS  determinism: seed 77, 5v5 ai vs ai played twice: identical (winner 0, 36 rounds, 8 KOs, 39 distinct moves)
PASS  time: slowest decision 7901 ms over 5 fight(s) (1v1, 1v1, 1v1, 1v1, 5v5) at 8000 ms/decision (cap 8000 ms)
PASS  demonstrations: over 70 ai vs ai fights: once-per-fight uses 78, control-then-ally 93, reacts played 527

3 of 5 stages passed in 1535 s
```

**Held-out versus in-sample strength** (same 4 pairs, ai on each team from each seat, 64 fights per row):

| Seeds | Role | ai wins |
|---|---|---|
| 1-4 | tuning (and the earlier acceptance run, before the score bound) | 55/64, 85.9% |
| 5-8 | tuning | 49/64, 76.6% (review) |
| 9-12 | not tuned on (review) | 45/64, 70.3% |
| 101-104 | not tuned on (this run) | 47/64, 73.4% |
| 101-104 | after the react re-roll fix (stage 1 replayed alone, not a full run) | 46/64, 71.9% |

The weights were picked as the best of five variants on seeds 1-8, so the 85.9% was in-sample. On seeds the
tuning never saw, the brain wins about 70-74% against greedy: clearly stronger than greedy (which wins 20-70%
of these pairings against itself, depending on the side), but below the 80% bar. Per pair it wins nearly every
5v5, and loses ground with the weaker side of the uneven small pairs (Jhin in the duel, Nate and Jhin in the 2v2).

Since this run, react simulations no longer read the real (hidden) attack roll. That fix changes react
decisions and therefore fights: stage 1 on seeds 101-104 replayed alone gave 46/64 (71.9%, 16/12/9/9 per pair,
1 stall). Stage 2 was not re-run after it, so its 8 stalls below predate the fix.

The 8 stalls are the same fights as before the score bound: 6 in the Kadgar, Baal, Eragon vs Akir, Future
Zane, Vayl-Soran 3v3 (seeds 1001, 1136, 1166 ai vs ai; 1006, 1021, 1066 ai vs greedy) and 2 in the spec 5v5
ai vs ai (1180, 1195). The 3v3 stalls are long attrition fights in which regeneration and healing keep pace
with the damage dealt (that pair also stalls under greedy against greedy, 1 in 20, mean 27 rounds); they are
not passive standoffs. No violation other than `stalled` appeared.

The timing batch, run alone: `node tools/sim.mjs "<spec team I>" "<spec team II>" --fights 50 --brain-a ai`
took **937 s (15.6 min, 18.7 s per fight)**: team I (ai) won 49, team II 1, 0 stalled, mean 13.2 rounds,
slowest decision 1028 ms, 0 violations; once-per-fight uses 111, reacts played 1186, control-then-ally 57.

### Tuning log (stage 1 measured as ai vs greedy, ai playing each team from each seat)

| Iteration | Change | ai wins | Stalls |
|---|---|---|---|
| before | Task 11 brain at 200 sims, spec 5v5 4 fights | 3/4 | 1/4 (and a `cell-conflict`, the revive bug) |
| 1 | fixed horizon, engagement 0.03 linear, win 30; 120 sims, 64 fights | 75.0% | 2 |
| 1 | same, 128 fights (seeds 1-8) | 70.3% | 4 |
| 2 | longer horizon for small fights (min(living + 3, 6)) | 69.5% | 7 (rejected) |
| - | greedy policy caches (4.4x faster search), default raised to 500 sims; full acceptance | 70.3% | 28 of 200 in stage 2, all 14 ai-vs-ai duels |
| e1 | engagement read at the end of the own turn, quadratic rise (0.05, 0.25) | 70.3% | ai-vs-ai: 3 of 40 |
| e2 | e1 + damage 0.02 | 72.7% | 5 |
| e3 | e1 + hp 2, alive 2 | 78.9% | 5 |
| e4 | e1 + hp 3, alive 1.5 (kept) | 81.3% | 4 |
| e5 | e3 + damage 0.02 | 77.3% | 5 |

Iterations from e1 on ran at 500 sims over 128 fights on seeds 1-8. These are in-sample numbers; see the
held-out table above.
