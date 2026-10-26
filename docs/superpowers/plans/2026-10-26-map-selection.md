# Map Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the initiative roll, let the player pick a permanent map or a random Watabou dungeon, with a loading animation and a silent Manor fallback.

**Architecture:** A new combat phase `'mapchoice'` sits between `'selection'` and `'initiative'`. Permanent maps come from `maps/manifest.json` through the existing loader. The random option runs Watabou's `Dungeon.js` in a hidden same-origin iframe, captures its JSON and its 70 px/cell PNG, and builds a map object through the same code path as permanent maps. Any failure falls back to Manor.

**Tech Stack:** Vanilla JS ES modules, no frameworks, no build step. Pure logic tested with `node --test` (Node 24 detects ESM in `.js`); browser behaviour verified against `python -m http.server` with the Chrome tools.

**Spec:** `docs/superpowers/specs/2026-10-26-map-selection-design.md`

## Global Constraints

- Vanilla JS, ES modules, no frameworks, no new dependencies, no build step.
- Match the style of `js/combat-logic.js`, `js/dungeon-loader.js`, `js/combat-render.js`; keep CRLF in files that already use CRLF (check with `file`; edit with a script that normalises and restores EOL).
- Watabou's script is loaded at play time from `https://watabou.github.io/one-page-dungeon/`; never copied into the repo.
- Failure budget: **15 seconds total**, **at most 3 attempts**, then a silent fall back to Manor. No error message, no alert.
- Acceptable generated map: 5 walkable, mutually connected start cells per team, the two teams in separate areas.
- Generated PNG: 70 px per cell, one cell of padding (`BORDER = 1`), the format `cellPxOf` expects.
- The first manifest entry is pre-selected at the start of every fight; the choice is not remembered.
- Watabou's hooks (`URL.createObjectURL`, `HTMLAnchorElement.prototype.click`, `history.*`, key events) must stay inside the iframe.
- Permanent-map behaviour must not change: Manor's `starts` and `grid` stay identical.

## Review Focus

1. Rematch (victory screen) must also pass through the map-choice step and not reuse a stale `S.currentMap` (tested in Task 4).
2. Clicking Confirm twice, or Back during loading, must not start two generations or two fights (Task 5).
3. A generation finishing after the 15 s fallback already started the fight must be discarded (Task 3).
4. Each failed attempt must remove its iframe and its hooks, so repeated fights do not leak (Task 2).
5. A manifest entry with a missing JSON or PNG must not break the screen (Task 4).

---

## File Structure

- `js/dungeon-loader.js` (modify): extract `buildMap`, add `alignmentOk`, `startsOk`, `loadMapMeta`; `loadMap` keeps its behaviour.
- `js/watabou-runner.js` (create): runs the generator for one seed and returns its JSON and PNG. One responsibility: talk to Watabou's script.
- `js/random-map.js` (create): attempts, 15 s budget, validation, fallback. One responsibility: turn "random" into a playable map.
- `js/combat-logic.js` (modify): phase `'mapchoice'`, `confirmMap`, `startInitiative` no longer picks a map.
- `js/combat-render.js` (modify): `renderMapChoiceScreen`, routing from Start and Rematch.
- `css/main.css` (modify): map-choice rows and spinner.
- `tests/dungeon-loader.test.mjs`, `tests/random-map.test.mjs` (create): `node --test`.

---

### Task 1: Loader pure helpers

**Files:**
- Modify: `js/dungeon-loader.js`
- Create: `tests/dungeon-loader.test.mjs`

**Interfaces:**
- Produces:
  - `buildMap({ slug: string, data: {title, story, rects}, image: {naturalWidth, naturalHeight}, perTeam?: number }) -> { slug, name, story, image, grid, starts }`
  - `alignmentOk(grid, image) -> boolean`: true when `naturalWidth / cols` equals `naturalHeight / rows` and is a whole number.
  - `startsOk(starts, grid, perTeam = 5) -> boolean`: each team has at least `perTeam` cells, all walkable, all in one connected component, and the minimum Chebyshev distance between the two teams is at least 6 (planner's call).
  - `loadMapMeta(slug) -> Promise<{ slug, name, thumb: string }>`: reads `maps/{slug}/{slug}.json` `title`; `thumb` is the PNG URL; never rejects (falls back to `name = slug`).
- `loadMap(slug)` keeps its signature and result.

- [ ] **Step 1: Pin Manor.** In `tests/dungeon-loader.test.mjs` (`node:test`), `manor starts and grid are unchanged`: read `maps/manor_of_nadargath/manor_of_nadargath.json`, call `buildMap` with an image stub `{ naturalWidth: cols*70, naturalHeight: rows*70 }` (cols/rows from the result's grid), and `deepEqual` `starts` and `grid.cols/rows/minX/minY` against literals. Record the literals by running the **current** code once before refactoring.
- [ ] **Step 2: Failing tests** for the new helpers: `alignmentOk true for exact 70px/cell`, `alignmentOk false when height ratio differs`, `startsOk true for Manor with perTeam 4`, `startsOk false when a team has fewer cells than perTeam`, `startsOk false when teams are closer than 6 cells`, `startsOk false when a team's cells are split across disconnected rooms`.
- [ ] **Step 3: Run** `node --test tests/` and confirm the new tests fail (functions undefined) and the Manor pin passes.
- [ ] **Step 4: Implement** the signatures above in `js/dungeon-loader.js`. `loadMap` becomes fetch + `buildMap`. `buildMap` passes `perTeam` to `deriveSpawnPoints(rects, grid, perTeam = 4)`; with the default, the existing room-picking and `cellsFromRoom` logic is untouched. For `perTeam > 4`, rooms qualify when `(w-1)*(h-1) >= perTeam`, and `cellsFromRoom` stops at `perTeam`.
- [ ] **Step 5: Run** `node --test tests/`; all pass, Manor pin still green.
- [ ] **Step 6: Commit** `git add js/dungeon-loader.js tests/dungeon-loader.test.mjs && git commit -m "Loader: buildMap, alignment and spawn checks"` (with the Co-Authored-By line).

---

### Task 2: Watabou runner and the alignment gate

**Files:**
- Create: `js/watabou-runner.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `runWatabou(seed: string, signal: AbortSignal) -> Promise<{ json: object, png: Blob }>`; rejects on abort or any failure. Always removes its iframe.

- [ ] **Step 1: Implement `runWatabou`.** Create a hidden `iframe` (`srcdoc`, same-origin, 900x600 off-screen, not `display:none` since the OpenFL canvas needs layout) containing the page the spike used: `<base href="https://watabou.github.io/one-page-dungeon/">`, the capture hooks (`URL.createObjectURL`, `HTMLAnchorElement.prototype.click`, `history.replaceState/pushState` stubs) installed **before** `<script src="Dungeon.js" crossorigin="anonymous">`, then `lime.embed("Dungeon", "openfl-content", 900, 600, { parameters: { seed, export: "json" } })`. Capture the JSON blob first. For the PNG, once the dungeon is built, send Shift+E to the frame's window, wait for the "Export as PNG" dialog, make sure its cell-size field reads 70, and press OK; capture the `image/png` blob. If a cleaner route to the same 70 px export exists in the compiled script, it may replace the keyboard driving as long as the output matches. Resolve when both blobs exist; reject on `signal` abort; remove the iframe in a `finally`.
- [ ] **Step 2: Gate check in the browser.** Serve the repo (`python -m http.server 8123`), open any page of the site, and in the console import the module and the loader. For 10 different seeds run `runWatabou(seed, AbortSignal.timeout(15000))`, then `buildMap` with the PNG decoded to an `Image`, and print `alignmentOk(map.grid, image)`, the PNG size and the JSON title. Expected: `true` for every seed, with each run under about 6 s.
- [ ] **Step 3: Gate decision.** If any seed prints `false`, **stop and report to the owner** (spec: do not adjust the loader to guess). Otherwise continue.
- [ ] **Step 4: Leak check.** After the 10 runs, verify in the console that `document.querySelectorAll('iframe').length === 0` and that `URL.createObjectURL` and `HTMLAnchorElement.prototype.click` on the **main** window are still the native functions (`.toString()` contains `[native code]`).
- [ ] **Step 5: Commit** `js/watabou-runner.js` ("Add Watabou generator runner").

---

### Task 3: Random map orchestration

**Files:**
- Create: `js/random-map.js`, `tests/random-map.test.mjs`

**Interfaces:**
- Consumes: `runWatabou` (Task 2); `buildMap`, `alignmentOk`, `startsOk`, `loadMap` (Task 1).
- Produces: `loadRandomMapOrManor(deps?: { run, decode, fallbackSlug }) -> Promise<map>`. Defaults: `run = runWatabou`, `decode = blob => Promise<Image>`, `fallbackSlug = 'manor_of_nadargath'`. Never rejects. Constants `RANDOM_BUDGET_MS = 15000`, `RANDOM_MAX_ATTEMPTS = 3`.

- [ ] **Step 1: Failing tests** (inject fakes for `run` and `decode`; the fallback loader is injected too so nothing touches the network):
  - `returns the generated map when the first attempt is valid`
  - `retries with a new seed when the first attempt fails alignment, and uses the second`
  - `retries when startsOk is false`
  - `gives up after 3 attempts and returns the fallback`
  - `returns the fallback when the total budget expires, and a late result is discarded` (fake `run` that resolves after the budget; assert the returned map is the fallback and that a later resolve does not change it)
  - `never rejects when run throws`
- [ ] **Step 2: Run** `node --test tests/random-map.test.mjs`; expect failures.
- [ ] **Step 3: Implement.** One `AbortController` for the whole call, aborted by a `setTimeout` at 15 s; each attempt uses a fresh random seed (`String(Math.floor(Math.random() * 1e9))`), builds the map with `perTeam: 5`, and accepts it only if `alignmentOk` and `startsOk`. The first valid map wins; the timer is cleared on exit.
- [ ] **Step 4: Run** the tests; all pass.
- [ ] **Step 5: Browser smoke.** In the console, `await loadRandomMapOrManor()` twice; confirm two different `name`s, `map.grid`/`map.image` present, and fewer than 15 s each. Then block `watabou.github.io` (DevTools offline) and confirm it returns Manor after the failures with no thrown error.
- [ ] **Step 6: Commit** ("Random map: attempts, budget, silent fallback").

---

### Task 4: Combat flow with the map-choice phase

**Files:**
- Modify: `js/combat-logic.js` (state near line 50, `startInitiative` ~2432), `js/combat-render.js` (Start handler path in `js/combat-events.js:52`, rematch at `combat-render.js:560`)

**Interfaces:**
- Consumes: `loadMap`, `loadManifest` (existing), `loadRandomMapOrManor` (Task 3).
- Produces:
  - `S.phase` gains `'mapchoice'`; `S.mapChoice: string | null` (a manifest slug, or `'random'`); `S.mapLoading: boolean`.
  - `goToMapChoice() -> Promise<void>`: sets `S.currentMap = null`, `S.phase = 'mapchoice'`, `S.mapChoice` to the first manifest slug, `S.mapLoading = false`, renders.
  - `confirmMap(choice: string) -> Promise<void>`: ignored if `S.mapLoading`; sets `S.mapLoading = true` and renders; resolves the map (`loadRandomMapOrManor()` for `'random'`, else `loadMap(choice)` with a catch that falls back to Manor); sets `S.currentMap`; sets `S.mapLoading = false`; calls `startInitiative()`.
  - `startInitiative()` no longer reads the manifest or loads a map; it uses `S.currentMap` as set by `confirmMap` and otherwise behaves as before.

- [ ] **Step 1: Implement** the above in `js/combat-logic.js`; export `goToMapChoice` and `confirmMap`, import them in `js/combat-render.js` and `js/combat-events.js`.
- [ ] **Step 2: Rewire entry points.** The Start button (`combat-events.js:52`) and the Rematch button (`combat-render.js:560`) call `goToMapChoice()` instead of `startInitiative()`. Rematch keeps its existing state reset.
- [ ] **Step 3: Verify the flow in the browser** with the console harness (`window.L = await import('/js/combat-logic.js')`): after `await L.goToMapChoice()`, `S.phase === 'mapchoice'` and `S.currentMap === null`; after `await L.confirmMap('manor_of_nadargath')`, `S.phase === 'initiative'`, `S.currentMap.slug === 'manor_of_nadargath'`, and the initiative order exists; calling `L.startCombat()` places all combatants on walkable cells. Rematch path: from a victory state, the Rematch click lands on `'mapchoice'`, not on a stale map (Review Focus 1).
- [ ] **Step 4: Missing map files** (Review Focus 5): `await L.confirmMap('does_not_exist')` ends on the Manor map in phase `'initiative'`, with no thrown error.
- [ ] **Step 5: Commit** ("Combat flow: map-choice phase").

---

### Task 5: Map-choice screen and loading animation

**Files:**
- Modify: `js/combat-render.js` (`render()` dispatch at line 367; new `renderMapChoiceScreen`), `css/main.css` (near `.selection-layout`, line 1982)

**Interfaces:**
- Consumes: `S.mapChoice`, `S.mapLoading`, `goToMapChoice`, `confirmMap`, `loadManifest`, `loadMapMeta` (Tasks 1 and 4).
- Produces: `renderMapChoiceScreen() -> Promise<void>` registered on `_R` like the other screens and dispatched from `render()` for `S.phase === 'mapchoice'`.

- [ ] **Step 1: Implement `renderMapChoiceScreen`**, following the approved mockup B (`.superpowers` is in the scratchpad; the layout is a list of rows plus one button):
  - heading "Choose your battlefield" using the existing `.selection-header` / `cx-eyebrow` pattern;
  - one row per manifest entry (thumbnail `<img>` from `loadMapMeta(...).thumb`, title) and one **Random dungeon** row (🎲, "Freshly generated each time"); the selected row is highlighted and follows `S.mapChoice`;
  - a **Confirm map** button (`combat-start-btn` class) calling `confirmMap(S.mapChoice)`; a secondary **Back** button returning to `S.phase = 'selection'`;
  - when `S.mapLoading`, replace the list with a spinning 🎲 (CSS `@keyframes`) and "Drawing the dungeon…"; hide Back and Confirm (Review Focus 2).
- [ ] **Step 2: Styles** in `css/main.css` using the existing tokens (`--tga-gold`, etc.): row, selected row, thumbnail, loading block, `@keyframes map-spin`. Check the layout at phone width (no horizontal scroll).
- [ ] **Step 3: Verify in the browser:** the screen appears after Start with Manor pre-selected; clicking the Random row moves the highlight; Confirm on Manor goes to the initiative screen; Confirm on Random shows the spinner, then the initiative screen with the generated title in the map badge (`.map-name-badge`); double-clicking Confirm starts exactly one generation (count `iframe` creations or `fetch` calls to `Dungeon.js`); offline Random returns to initiative on Manor with no message.
- [ ] **Step 4: Full fight smoke:** play one 5v5 fight on a random dungeon through `L.startCombat()` and a few turns (move, attack, an area ability); verify no unwalkable placements and no console errors. Run it twice, once with a different seed.
- [ ] **Step 5: Commit** ("Map-choice screen with loading state").

---

### Task 6: Wrap-up

**Files:**
- Modify: `maps/manifest.json` only if the tests exposed a need (expected: no change).

- [ ] **Step 1:** Run `node --test tests/` and confirm everything passes.
- [ ] **Step 2:** Re-run the Review Focus checks 1 to 5 once more end to end on a clean page load; confirm the Rematch flow in particular.
- [ ] **Step 3:** Stop the local servers you started; do not push. Report to the owner what ran, what passed, and the licence note from the spec.

---

## Self-review

- **Spec coverage:** list + Confirm (Task 5); pre-selected first entry, no memory (Tasks 4, 5); Random loading state (Task 5); 15 s / 3 attempts / silent fallback (Task 3); alignment gate (Task 2); start-cell rule (Task 1, used in Task 3); iframe isolation (Tasks 2, 5); manifest-driven rows for future maps (Task 5); generated title shown (Task 5, existing badge); permanent-map behaviour unchanged (Task 1 pin).
- **Planner's calls, to check:** minimum team distance of 6 cells; the `(w-1)*(h-1) >= perTeam` room rule for generated maps; Rematch also goes through the map choice; Back from the map screen returns to team selection.
- **Types:** `buildMap`, `alignmentOk`, `startsOk`, `runWatabou`, `loadRandomMapOrManor`, `goToMapChoice`, `confirmMap`, `loadMapMeta` are named identically wherever they are used.
