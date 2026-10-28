# Combat AI: a strong brain and a fight-simulation runner

## Intent

The combat simulator (`combat.html`, `js/combat-logic.js`) is played by humans clicking a map. The owner wants a **computer player**: a "brain" that, given the state of a fight, decides what one unit does on its turn. Two uses:

1. **Now: testing.** A repeatable command-line runner plays whole fights, brain against brain, so the owner can see how a matchup really plays out, find balance problems (the first test fight exposed one free 7d12 area attack that decided everything) and find rule bugs.
2. **Later: an opponent.** The same brain will control one side against a human in the browser. **The play-against-it screen is not part of this project**, but the brain must be shaped so that adding it later is a small step.

Why it must be good, not just present: the owner wants it to play **as hard as it can**. A weak bot makes balance tests lie (a team looks bad because the bot misplays it) and makes a poor opponent. An earlier throwaway bot (greedy: walk toward the nearest enemy, cast the highest-damage ability) is the baseline to beat; it never used teleports, transformations or domains, took the first react it was offered, and ignored allies.

## Goals

- A **strong, rule-abiding brain**: positioning, focus fire, protecting and healing allies, resource and cooldown management (it must not waste once-per-fight moves), reactions, and **team play**: using one character's control or debuff so an ally profits, found by the brain itself rather than by a hand-written list of pairs.
- A **runner** that plays many fights between two named teams and reports **win rates, who dies first, and rule violations or bugs** (see "The runner").
- Saved in the repo, reusable for later tests, reproducible (a fight can be replayed from its seed).
- Reaches its best decision inside a time budget (see Constraints).

## Non-goals

- The in-browser "play against the AI" screen and any change to how `combat.html` looks or plays. That comes later.
- Difficulty levels. The brain always plays as hard as it can.
- Learning from data, training, or anything that needs a model file or a server.
- Rebalancing characters or inventing rules. The brain plays the game as it is; balance changes stay with the owner.
- Fixing every rule bug the runner finds. The runner **reports** them.

## Anti-goals (a failure even if it technically works)

- The brain **cheats**: it must not know the dice that the real fight will roll next. Lookahead uses its own sampled dice, never the real upcoming rolls.
- The brain has its **own copy of the rules** that can drift from the game. Rules must come from the real engine, so "respects all rules" is true by construction.
- Turns that feel stuck: a decision that takes more than the time cap.
- Results nobody can reproduce.
- Anything that stops `combat.html` or the existing tests from working.

## Constraints

- **No frameworks, no dependencies, vanilla JS in ES modules**, matching the rest of the repo (owner's standing rule; `package.json` is not used by the site and none is to be required for the site to run).
- **The deployed site stays on Vercel's free plan**: a static site. The brain must run entirely **client-side in the browser** (later) and in plain **Node** (the runner). No server, no network calls, no paid service, nothing to deploy beyond static files. The runner and its tooling are development-only and must not be needed by the site at runtime.
- **Time cap (decided by the owner):** a decision may take "a few seconds", and **never more than 8 seconds**; less is better. The brain therefore searches **until a time budget runs out** and plays the best option found so far (an "anytime" search), instead of searching to a fixed depth. The budget is a parameter: the 8-second cap is the hard maximum for the future in-browser use; the runner may use a much smaller budget so a batch of fights finishes in reasonable time (builder's call).
- The brain must work in the browser's single thread without freezing the page for the whole budget (builder's call how: for example yielding periodically, or a Web Worker; both are allowed if no dependency is added). Plain Node must work too.
- **It obeys every rule the game obeys**: once-per-fight (`cooldown: 99`), cooldowns, spell slots, ki, souls, charges, range and line of sight, control effects (stun, para, freeze, fear skip the turn), silence, roots, domains, reacts and blocks, taunt, puppet. It only ever acts through the same handlers a human's click reaches (`handleAttack`, `handleCastAbility`, `handleMoveClick`, `handleActivateDomain`, `handleTransform`, the react handlers, `handlePass`, ...).
- The existing 28 tests must keep passing, and `combat.html` must behave exactly as before.

## How the brain decides (the owner decided "as hard as it can" and "finds synergy by itself"; the rest is the designer's proposal)

**Core idea (designer's proposal): look ahead using the real engine.** For each candidate turn (where to move, what to do with which target), simulate it on a copy of the fight using the real engine code, play it out a short way (including the enemy's likely replies), score the resulting position, and keep the best. Because the real engine runs the simulation, the brain automatically discovers what the rules reward: a stunned enemy that skips a turn, a wet target that takes +2d10, a taunt that pulls attacks, a heal that undoes a hit. This is how synergy gets found without a table of pairs.

Because dice are random, each candidate is tried several times with sampled dice and averaged. The number of samples and the lookahead depth grow with the time budget (anytime behaviour).

**Scoring (designer's proposal, tune by results):** team HP, units alive, enemy units removed or **made to lose a turn** (control), threat remaining (damage the enemy side can still deal), and resources spent versus saved (a once-per-fight move spent early on a weak target scores worse than kept).

**Candidate actions** include everything a human can do: move then act, basic attack, every available ability with every sensible target or area center or cone direction, domains, transformations, **and reaction choices** (including teleport reacts, which the throwaway bot skipped).

**Synergies the sheets support today** (so the builder can verify the brain finds them; the list is expected to stay small): control that makes a target lose its turn (Jaina's *Runik Sea Bound*, Jeagen's *Sovereign Roar*, Black Turtle's *Glacial Prison* roots, Vayl-Soran, Hela, Maracacha); wet target then Eragon's *Ice Coffin* (+2d10) or Jaina's *Runik Sea Bound* (advantage on a wet field); disadvantage setups (Akir's *Gravity Up*, smoke screens); Baal's taunt; Future Zane's +2 to allies' attack rolls; healing, regeneration auras and cleanses (Meï, Zhuqiao, Maracacha, Vayl-Soran). The brain must not hard-code these; the sheets will grow.

## What the engine needs (the real work underneath)

The brain can only look ahead if the engine can be run "what if". Today:

- Fight state is one global object `S` in `js/combat-logic.js`, plus combatant objects inside it.
- The engine uses `Math.random` for all dice (`rollDie`, passive chances, shadow-void picks).
- A few places call the page (`document`, render hooks) and `setTimeout` (a stunned unit's turn is skipped after 1000 ms; victory screen after 1200 ms).

So the engine must gain, **without changing how the game plays**: a way to **snapshot and restore** the fight state; a way to inject a **random source** (so the runner can seed fights for replay, and lookahead can use dice the real fight does not see); and a way to run **headless and synchronously** (no waiting on timers, no page). Exactly how is the builder's call, provided the existing tests pass and the browser game is unchanged. The existing tests already stub `document` for Node, which shows headless loading works today.

## The runner

A command-line tool, run with Node, that plays full fights between two teams given by character name, on the Manor map or any listed map, and prints a report. Shape is the builder's call; the proposal is `node tools/sim.mjs "Zhuqiao, Vermillion Bird; Jay, Azure Dragon" "Admiral Jaina; Thormak, The Titan Slayer" --fights 50`.

**Must report (decided by the owner):**
1. **Win rates**, per team, over the batch.
2. **Who dies first**: how often each character is the first KO, so a fragile or overexposed unit shows up.
3. **Rule violations and bugs**: anything that should never happen. At minimum: a thrown exception; an action the engine rejected that the brain believed legal; HP above max or an unexpected negative; a once-per-fight ability used twice; a cooldown ignored; a resource below zero; a KO'd unit acting; a fight that never ends (round cap); a unit standing on an occupied or unwalkable cell. Each is printed with the **seed** that reproduces it.

Also useful (designer's proposal, optional): average length in rounds, move usage counts, and **seat swapping** (each matchup also played with the sides exchanged, since the first side's start position and initiative could otherwise bias the result).

**Reproducibility:** every fight has a seed; the same seed and the same teams replay the same fight.

## How success is checked

- The brain **beats the throwaway baseline bot clearly** (proposal: at least 80% wins over 50+ fights, across several different team pairs, with seats swapped). The baseline's logic is described above; the builder re-creates a simple equivalent to measure against.
- Decisions never exceed the time cap, measured in the runner.
- **Zero rule violations** over a large batch (proposal: 200 fights, mixed matchups, both maps).
- A fixed-seed fight replays identically.
- The brain demonstrably uses a once-per-fight move, a control move followed by an ally's attack, and a react, in at least some fights (spot-checked by the owner from the runner's move counts or a printed fight log).
- All existing tests pass; new tests cover the runner's violation checks and the engine's snapshot/restore and seeding.

## Decisions added after the builder check (designer's calls unless marked)

- **Turn shape.** The brain exposes one call that returns a **whole turn plan** (optional move, then one action with its targets), plus a **separate call for react choices**, since reacts come mid-action and are decided by the defending side. The later UI calls the same two functions.
- **Whose policy plays the enemy inside the lookahead:** a cheaper, faster version of the brain itself (never the throwaway baseline), so that the simulated replies are strong.
- **Engine changes allowed:** in-place snapshot and restore of the existing global `S` (no handler refactor to pass state around), an injectable random source, and headless synchronous running. Handlers may **gain return values** that report accepted or rejected, provided behaviour is unchanged. Snapshots need not be JSON-serialisable; shared ability and effect data from `main.js` may be held by reference rather than cloned.
- **Batch time (decided by the owner):** a 50-fight batch may take **about 20 minutes** at the runner's default budget. That is the budget the builder tunes the per-decision simulation count against (roughly 24 seconds per fight on average).
- **Determinism wins in the runner.** The runner's budget is a **fixed number of simulations per decision** (not wall-clock), so the same seed replays identically on any machine. The browser build later uses the wall-clock cap of 8 s. The 80% win-rate check and the 200-fight violation check run at the runner's fixed budget; one smaller confirmation batch runs with the full 8 s wall-clock budget.
- **Violation checks use ground truth from the data, not the engine's own counters:** invariants are checked before and after every handler call against the character sheets (`cooldown: 99`, slot counts, ki, charges).
- **Headless loading:** a Node-side loader reads `js/characters.json` and the map files with `fs` and shims `fetch`/`localStorage`; character and team names must match `characters.json` exactly. "Any listed map" means an entry of `maps/manifest.json` (today only Manor of Nadargath), plus the random dungeon if it works headless.
- **Seeds.** One seed determines the whole fight: initiative rolls, placement and every die. With seat swapping, both seatings reuse the same seed. The real-dice stream and the brain's lookahead stream are separate, so lookahead never consumes or predicts real rolls.
- **Demonstration checks** (once-per-fight use, control followed by an ally's attack, a react) are **automated counters** in the runner's report, with the owner's spot-check on top.

## Left to the builder

File layout (proposal: brain under `js/ai/`, runner under `tools/`, tests under `tests/`), the exact search method and scoring weights, how snapshot/restore and the injected random source are done, how the brain yields in a browser, the baseline bot, and the format of the report.

## Designer's calls (the owner can overrule)

- Look-ahead with the real engine, not a separate rules model.
- Anytime search bounded by a time budget, with a smaller default budget in the runner than the 8 s cap.
- Seat swapping and extra stats in the report are optional extras.
- The success thresholds above (80% over 50+ fights, zero violations over 200 fights) are proposals.
