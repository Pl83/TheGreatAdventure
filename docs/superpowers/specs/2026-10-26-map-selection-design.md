# Map selection (Manor or random Watabou dungeon)

## Intent

Today every fight is played on the same map: `startInitiative()` in `js/combat-logic.js` picks a random entry of `maps/manifest.json`, which holds only `manor_of_nadargath`. The owner wants to choose the battlefield, and wants a truly random dungeon option so fights stop happening in the same rooms. More hand-made maps (exported from Watabou by hand, as Manor was) will be added later.

## Behaviour

1. Team selection ends as it does now.
2. A new **map-choice step** appears before initiative is rolled.
3. It shows a list of rows, one per choice, plus a **Confirm map** button (decided: layout "B", pick then confirm, not click-to-go):
   - one row per entry in `maps/manifest.json` (today: Manor of Nadargath, with a thumbnail of its PNG and its title);
   - one **Random dungeon** row (die icon, "Freshly generated each time").
4. The first manifest entry is pre-selected (builder's call: Manor today).
5. Confirm with a permanent map: initiative is rolled and combat proceeds exactly as today.
6. Confirm with Random:
   - a loading state replaces the list: spinning die and "Drawing the dungeon…";
   - a fresh random seed is generated and the Watabou generator is run in the page;
   - on success, the generated map is fed to the existing map loader and initiative is rolled;
   - on any failure, or after **15 seconds** without a result, the game silently falls back to the Manor map and continues. No error message (decided).
7. The generated dungeon's title (e.g. "Sanctum of Nala") and story are shown wherever Manor's name and story are shown today (builder's call: same code path, since the loader already returns `name` and `story`).

Back navigation from the map-choice step to team selection is left to the builder (match what the rest of the flow does).

## How random generation works (verified by a spike)

The generator is the open web app at `https://watabou.github.io/one-page-dungeon/`: a single compiled Haxe/OpenFL script (`Dungeon.js`, ~1.2 MB) that reads parameters (`seed`, `export`). Its host sends `Access-Control-Allow-Origin: *`, so the script and its `assets/*` files can be loaded cross-origin. A spike (throwaway, not in the repo) proved the following, using seed 219260175:

- Load the script with `crossorigin="anonymous"`, then `lime.embed("Dungeon", <div id>, w, h, { parameters: { seed, export: "json" } })`. The app builds the dungeon and "downloads" a JSON blob.
- The app saves through FileSaver (`URL.createObjectURL` + a synthetic `<a download>` click). The spike captured results by wrapping `URL.createObjectURL` (to collect blobs) and `HTMLAnchorElement.prototype.click` (to suppress the real download) **before** loading the script.
- The app calls `history.replaceState`; with a cross-origin `<base>` this throws a SecurityError. The spike stubbed `history.replaceState/pushState`. In our page there should be no cross-origin `<base>`, so the builder should check whether the stub is still needed; the app's relative asset URLs need resolving against Watabou's origin, which is why the spike used the `<base>` tag. How to do that without breaking our own page (for example an isolated hidden iframe, which also contains the stubs and hooks) is **left to the builder**.
- JSON via the `export=json` parameter works: keys `version,title,story,rects,doors,notes,columns,water`.
- The PNG via the `export=png` parameter does **not** work for us: it saves the current view with arbitrary margins. The right PNG comes from the app's own **Shift+E "Export as PNG" dialog**, whose default is `Cell size in pixels: 70` and which renders exactly one cell per 70 px with one cell of padding around the dungeon (the format `js/dungeon-loader.js` expects: `gx = jx - minX + BORDER` with `BORDER = 1`, `cellPx = naturalWidth / cols`). In the spike, sending Shift+E key events and clicking OK produced a 1960x2660 px PNG (28x38 cells) in about 3 seconds.
- **Not yet verified:** that the generated PNG's cell count matches `rects` from the JSON exactly (cols = maxX - minX + 1 + 2*BORDER, same for rows), i.e. that the generated map aligns with the loader the way Manor does. The builder must verify this early, on several seeds, before building the rest. If it does not hold, the builder reports back rather than adjusting the loader to guess.

Driving the Shift+E dialog by synthetic keyboard events, and clicking its OK button, is fragile. The builder may use any other way to obtain the same PNG (for example calling the app's PNG export routine directly) as long as the output matches the 70 px / one-cell-padding format.

## Failure, retries and acceptance (builder-check answers, marked as the designer's calls)

- **Alignment gate (designer's call).** The first piece built is a spike-quality check that generated PNG and JSON align on many seeds. If they do not align reliably, the builder stops and reports to the owner before building the rest. If they align, a seed that still fails the check at run time counts as a failed attempt (see retries), never as something to patch up.
- **Acceptable generated map (designer's call).** Each team needs 5 start cells that are walkable and mutually connected, and the two teams' cells must be in separate areas as far apart as the map allows, as `deriveSpawnPoints` already tries for Manor. A map that cannot give that is a failed attempt.
- **Retries (designer's call).** A failed attempt (generation error, PNG or JSON problem, alignment failure, unacceptable spawn points) is retried with a new seed, up to 3 attempts in total. The **15 seconds cover all attempts together**. When attempts or time run out, the game falls back to Manor silently.
- **Hosting the generator (designer's call).** A same-origin hidden iframe (`srcdoc` or blob) that loads Watabou's `Dungeon.js` and assets from his origin is acceptable and preferred, because it keeps the stubs, hooks and key events away from our page. Loading his `index.html` in a cross-origin iframe is not (it cannot be scripted).
- **Screen and state (designer's call).** The map-choice step reuses the site's existing screen and panel styling and the existing phase mechanism of the combat flow (`S.phase`). The choice is not remembered: every fight opens with the first manifest entry pre-selected.
- **Licence.** Unreviewed and accepted by the owner for now. Nothing in the build depends on it, but it should be reviewed before the site is promoted publicly.

## Constraints

- Vanilla JS, ES modules, no frameworks, no new dependencies, no build step (project rule).
- Code is clean and efficient, matching the style of `js/combat-logic.js`, `js/dungeon-loader.js`, `js/combat-render.js`; CRLF line endings in the files that already use them.
- The Watabou script is loaded **at play time from his site**, not copied into the repo. The game is only expected to work offline for permanent maps; Random silently falls back to Manor when offline (decided).
- Never build a map that the combat engine cannot play: the result must pass through the same `loadMap`-style path so `grid`, `starts` (spawn points) and walls behave as for Manor.
- The game must always reach initiative: any error in generation, parsing, image load or alignment ends in the Manor fallback.

## Goals

- Pick Manor or a random dungeon before every fight.
- A random dungeon that is as playable as Manor (walls, line of sight, 5v5 spawn points on both sides).
- Adding a future permanent map means adding it to `maps/manifest.json` (and its files) with no UI code change.

## Non-goals

- No seed entry, seed display or "replay this dungeon" feature (not asked; could come later).
- No generator settings (size, style, theme); defaults only.
- No map change in the middle of a fight.
- No error messages, retry button or offline detection UI.
- No bundling or forking of Watabou's code.

## Anti-goals (what would make this a failure even if it technically works)

- A random dungeon whose picture and walkable grid do not line up.
- Fights that hang on the loading state, or start with no map or with a broken map.
- Visible console/alert noise or a stray download popup from the generator.
- Watabou's generator leaving global side effects on our page (hooks left on `URL.createObjectURL` or `HTMLAnchorElement.click`, history changes, keyboard shortcuts firing on our own page).

## Open to the builder

- Whether to run the generator in an iframe or in the page.
- How the thumbnails and titles of permanent maps are obtained (for example reading each map JSON's `title`).
- Spawn-point quality on generated maps: `deriveSpawnPoints` was written for Manor. The builder must check it yields enough valid, reachable start cells for a 5v5 team on several generated dungeons, and choose the minimum change needed (for example rejecting a seed and trying another within the 15 seconds). Reporting the outcome is required.
- How to test: the project has no test suite; the established practice is to drive `js/combat-logic.js` in the browser against `python -m http.server`.

## Known risks (accepted by the owner for now)

- Needs internet for Random.
- If Watabou changes his app, Random silently stops working and falls back to Manor.
- Licence and terms of loading his script at runtime have not been reviewed by the owner.
