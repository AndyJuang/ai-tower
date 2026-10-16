# Handoff: StarBase Raptor engine (branch `feat/starbase-raptor-engine`, PR #2)

## Goal
Each StarBase pad (hero + two lower pads) shows a Raptor engine instead of the old
01-stack / 02-fuel / 03-launch launchpad animation. The engine **assembles while the
agent works** (progress of its active `in_progress` job) and **launches once when a job
finishes** (`done`). Idle agents (待命) show a dim static engine.

## Architecture / files
- `public/starbase-raptor.js` — UMD module `StarbaseRaptor`.
  - `activeJob(tasks)` newest `in_progress` task; `jobProgress(t, now)`: explicit `progress`
    → elapsed/estimate (`estimate_ms|eta_ms|estimate_min`) → asymptotic ramp (capped `RAMP_CAP`).
  - `newLandings(...)` once-per-job ignition (seen ids in sessionStorage; reloads don't replay old ones).
  - `createController()`: per-pad state, `allocate()` caps live iframes at `MAX_LIVE = 3`
    (one WebGL context each; priority launching > active > featured), IntersectionObserver unmounts
    offscreen pads, static SVG fallback (`staticSvg`), `prefers-reduced-motion`, header toggle
    (`localStorage` key `TOGGLE_KEY`, button `#sb-raptor-toggle`).
  - postMessage to the iframe: `{cmd:'progress', value}` / `{cmd:'complete'}`.
- `public/starbase/raptor/engine.html` — the engine figure (anatomy, MIT © 2026 Ryan; see
  `LICENSE-anatomy.txt`, `README.md`).
- `public/app.js`
  - `makePad()` renders `.sb-visual > .sb-scene > .sb-raptor` (engine fills the scene area) plus
    `.sb-info` (name, chip, main task, task lists — unchanged).
  - Old player removed from pads: `SB_PLAYERS` entries have `a/b = null, missing: true`, so
    `applyPadPlayer` only toggles the HOLD class; `StarbaseState` still drives chips/hold.
    The old iframe helpers (`makeIframe`, `loadClip`, `driveIframe`, `onPlayerMsg`) are still in
    the file but inert — candidates for deletion.
  - `renderStarbase()` calls `RAPTOR.sync(agent, padEl, tasks, {featured})` per pad, then `RAPTOR.prune`.
- `public/style.css` — `.sb-pad .sb-scene` fills the visual; `.sb-raptor` absolute inset:0;
  idle = dimmed/grayscale.
- Tests: `tests/starbase-raptor.test.js`, `tests/ui-static.test.js` (updated: asserts the old
  missing-bundle placeholder is gone and `.sb-raptor` is in the scene). Run: `for t in tests/*.test.js; do node $t; done`.

## Dev server on 4791 (worktree)
The page itself no longer loads `starbase/player.html` / `starbase.js`, but the old assets are
still served and some tests reference them. They are gitignored (Remotion licence), so a fresh
worktree needs them copied **read-only** from the live checkout:
```sh
mkdir -p public/starbase/src
cp -p ../tower-dashboard/public/starbase/src/*.html public/starbase/src/   # read-only copy from live
node tools/extract-starbase.js                                              # writes public/starbase/starbase.js
TOWER_PORT=4791 nohup node server.js > /tmp/raptor-dev.log 2>&1 &
```
Restart only the 4791 process (`lsof -tiTCP:4791 -sTCP:LISTEN`).

## Guards — do not break
- **Live checkout** `../tower-dashboard` serves port **4777** as launchd service `com.aj.ai-tower`.
  Never modify that checkout, never restart 4777.
- `remote.origin.pushurl` is intentionally `DISABLED-local-folder-never-pushes`. Don't change remote
  config; push explicitly: `git push https://github.com/AndyJuang/ai-tower.git HEAD:feat/starbase-raptor-engine`.
  No force push.
- Never commit `public/starbase/src/` or `public/starbase/starbase.js`. Leak-scan diffs before
  pushing (no absolute home paths, emails, tokens).

## Current state
- Engine fills every pad's scene area; old launchpad animation no longer plays on the page.
- Max 3 live WebGL engines + toggle + reduced-motion + offscreen unmount retained.
- Unit/static tests pass; curl checks: page, CSS/JS, `engine.html`, `/api/starbase` return 200.

## Untested
- **No browser verification yet** (curl only): engine sizing/centering in hero vs lower pads,
  live vs static allocation with 3 working agents, launch-on-done animation, toggle, Safari.
- Whether `engine.html` honours `progress`/`complete` messages visually as intended.

## Open TODOs
1. Browser-verify on 4791 (Chrome + Safari), incl. a job transitioning in_progress → done.
2. Delete the inert old player code in `app.js` (and decide whether `player.html`/`bridge.js`/
   `extract-starbase.js` stay for other pages); update tests accordingly.
3. Show the engine for queued/blocked jobs? (currently only `in_progress` assembles; HOLD = grayscale).
4. Version bump / CHANGELOG before merge.
