## Context

See proposal.md for motivation and specs/famobi-sdk/ for the required behavior.

The game already separates concerns in a way that suits the SDK:

- `SnakeGame` is a pure simulation with phases (`menu`, `playing`, `paused`, `level-complete`, `game-over`, `finished`). It changes phase synchronously inside `step()`.
- `GameController` turns snapshots into domain events (`ready`, `runStarted`, `runEnded`, `scoreChanged`, `progressChanged`, `pauseChanged`, `gameFinished`) and already has hooks for outside control: `setSystemPaused`, `setSystemMuted`, `goToLevel`, `forceGameOver`.
- The player profile (`bestScore`, `highestUnlockedLevel`, `totalRuns`, `playerMuted`) is saved in `localStorage`. Clearing level N unlocks level N+1, and the menu's level select offers every unlocked level (`startAtLevel` checks the unlock, then calls `goToLevel`).
- All controller commands are synchronous today, while the SDK requires gameplay to wait for promises.
- Saving goes through a `GameStorage` interface, currently implemented only with `localStorage`. After this change the same interface writes to `GameInterface.storage` whenever the SDK is present (Decision 7).

Constraints found by reading the SDK:

- `init.js` only activates on localhost, private-network hosts, `*.local`, or when forced by an attribute or global. It then installs a placeholder `GameInterface` that queues calls, and injects the **local tester** SDK (`/localTester/game-interface.js`), which logs every call to the console and can add a delay to each awaited event. The `?isTool` URL parameter only chooses the Famobi Tool SDK instead of the local tester; it does not activate the loader by itself. On other hosts (GitHub Pages) `window.GameInterface` stays undefined.
- `GameInterface.init(files)` downloads each `.js`/`.css` file with `fetch`, then runs it from a blob URL as a **classic script**, in order. Functions in the list are called afterwards without being awaited. ES module output therefore cannot be loaded by `init()`. The docs start the game in `init([...]).then(...)`.
- `GameInterface.storage.getItem` may return a string or a structured value, depending on the SDK's storage mode (legacy mode returns the raw `localStorage` string; otherwise the value as it was stored).
- The SDK checks the order of lifecycle events and reports `INVALID_GAME_EVENT` otherwise: after `gameStart` only `stageStart` or `gameEnd` may follow; after `gameEnd` only `gameStart` or `gameFinished`; `gameFinished` may be called once per session and nothing may follow it. Pause, resume and score calls are not checked.
- The docs name focus loss as one cause of the platform's external pause (Pause intro), and Misc-03 shows games handling `visibilitychange` themselves, gated by `hasFeature("visibilitychange")`. The local tester does not turn tab visibility into `onPauseStateChange`: its `visibilitychange` listener only records an "interrupted" state. The pause callback fires only from the test menu, ads or an external pause.
- Phaser already freezes its game loop while the tab is hidden and resumes it when the tab is visible again; the scene's tick timer runs on that loop, so the snake stops while hidden. This is existing behavior.
- Start-03 accepts a game that "starts automatically when the framework or engine loads" instead of from `init([...]).then(...)`.
- The game's script reads the page's elements as soon as it runs (`main.ts`), so the page body must exist before `game.js` executes.

## Goals / Non-Goals

**Goals:**
- Keep all SDK knowledge in one adapter; the simulation and the controller stay free of Famobi names so they remain testable without a browser.
- One code path for development and production: `pnpm dev` also loads the game through `init()`.
- Make the waiting behavior testable without a browser.
- Wire the SDK only to features the game already has; add no new game features.

**Non-Goals:**
- Loading any assets lazily (the game has no external assets; audio and graphics are procedural).
- Stage events: Neon Snake levels have no stages.
- Changing gameplay, visuals or level design.
- A lifetime total score: it appears only in the Game-08 code example and would add a new profile field.
- Own tab-visibility handling: Phaser's existing hide-freeze stays as it is.
- `hasFeature` flags (UI-01/02/04, Misc-02 tutorial, Misc-03 visibilitychange, Misc-05 home) and the Famobi copyright logo (UI-03): required by the SDK docs before a portal release; left for a later change, and the README lists them as not done.

## Decisions

### 1. A `GamePlatform` port in the application layer, Famobi as one adapter
The controller depends on a small interface with the awaited moments only: `startRun(level)`, `endRun(reason, summary)`, `finishGame(summary)`, `pauseRun()`, `resumeRun()`. A no-op implementation is the default. The Famobi adapter implements it and, separately, a `connectFamobi(controller, sdk)` function wires everything that is fire-and-forget or platform-to-game: live score and progress, `sendPreloadProgress`/`gameReady` on the `ready` event, mute reporting, and the `on*` callbacks.

*Alternative:* call `window.GameInterface` directly inside the controller. Rejected: it couples the domain to a global, and the tests would need to stub `window`.

### 2. Controller commands become queued async tasks with a busy flag
Each player or platform command is wrapped as a task. A task awaits the platform call, then changes the simulation (for example `await platform.startRun(level)` → `simulation.start()`). Tasks run one at a time through a promise chain:

- **Player and platform commands** are dropped while any task is pending (prevents double clicks and conflicting requests). Player commands are also dropped while a platform pause is active, in every phase.
- **Platform pause and mute changes are not commands**: `onPauseStateChange` and `onMuteStateChange` are applied immediately, even while a task is pending (Pause-01: "handle state changes at any moment"). When a task then starts a level, the controller re-applies an active platform pause, so the new level begins frozen behind "Please wait".
- **End-of-level tasks** are always queued, because they are triggered by the simulation itself (last fruit eaten, crash) and must not be lost.
- While a task is pending, `tick()` does not advance the snake; the controller remembers a skipped tick and replays it once the queue drains, so the scene's one-shot timer is re-armed.
- The controller emits `busyChanged`; the UI disables overlay buttons and the menu's level select, and hides result screens while busy, so a result screen appears only after `gameEnd` resolves.
- Restart, go-to-level and next-level during a level do not pass through the menu: the level stays on screen, frozen, while `endRun("quit")` and then `startRun(level)` are pending, and the simulation starts the new level directly. This avoids a menu flicker and a stray `runEnded` for the menu. Because the simulation then goes from `playing` straight to `playing`, the snapshot handler does not see a run boundary; the controller emits `runEnded` (reason `quit`) and `runStarted` itself and counts the new run in `totalRuns`, exactly as the menu path does.

*Alternative:* hold the simulation in a new "ending" phase. Rejected: it spreads platform concerns into the pure simulation.

### 3. Where each `gameEnd` is triggered
- `complete` / `fail`: the simulation has already reached `level-complete`, `finished` or `game-over`; the controller detects this in its snapshot handler and queues `endRun`. For `finished` the same task then awaits `finishGame`, but only the first time the last level is cleared in a session; the adapter keeps a flag, because the SDK allows `gameFinished` once (see Open Questions for playing again). Level 3 unlocks only after levels 1 and 2 are cleared, and platform requests never start a locked level (Decision 9), so clearing level 3 always means every level has been finished (Game-11), even when it was chosen from the level select.
- `quit`: the controller calls `endRun("quit")` **before** changing the simulation to the menu, as the docs require ("do not leave gameplay until resolved"). The snapshot handler does not call the platform for `quit`, so it is never sent twice. Leaving a result screen sends nothing, because `gameEnd` was already sent; this matches the SDK's order check, which rejects `gameEnd` after `gameEnd`.
- Platform `onGameOver` reuses `forceGameOver()`, which produces a normal `fail` end.

### 4. Score values
- Live: `sendScore(score, { level })` on every `scoreChanged`.
- Level end: the adapter's `endRun` sends `sendScore(levelScore, { type: "level", level })` and `sendScore(score, { type: "total" })`, then awaits `gameEnd(reason, { metrics })`.
- Level score is the points earned in that level: `levelScore = score - scoreAtLevelStart`, which the simulation already tracks. The Game-08 example sends the running score as the level score; the docs ask for a per-level score, so the level-only value is used.
- Total score is the run's score on screen, which carries over between levels and resets on a new game. The Game-08 example sends a lifetime total ("total cumulative score across all sessions/levels"), but that is an example, not a requirement (the requirement is "call sendScore after every change in player score"), and a lifetime total would be a new profile field.
- `gameEnd` metrics: `level`, `score`, `levelScore`, `durationMs`, `progress` (percentage; `RunSummary.progress` is 0-1 and the adapter converts it to an integer 0-100), using the documented `EventParams.metrics` shape. Famobi's Analytics-01 (optional) asks for metrics that show whether a level is too easy or too hard; these values are the ones the game already has.

### 5. Progress and preload values
- `sendProgress` receives an integer percentage of the level's fruit target (0-100), matching the scale of `sendPreloadProgress`; the adapter only sends when the rounded value changes.
- Preload: the game script is already loaded when it runs, and Phaser has nothing to download. The adapter sends `sendPreloadProgress(0)` when it connects and `sendPreloadProgress(100)` immediately before `gameReady()` on the controller's `ready` event (the scene's `create`).

### 6. Build: IIFE bundle through Vite library mode
`vite build` uses library mode with `formats: ['iife']`, producing `dist/game.js` and `dist/game.css`; a small plugin copies `index.html` into `dist`, and `public/famobi.json` is copied as-is. `process.env.NODE_ENV` is defined for the bundle because library mode does not replace it.

`index.html` contains the markup, `<script src="https://api.games.famobi.com/init.js">` inside `<head>` (Start-01), and one inline script at the end of `<body>` that calls `GameInterface.init(["game.css", "game.js"])`. Placing the call after the markup guarantees the elements `main.ts` looks up exist when `game.js` runs. If no GameInterface exists (GitHub Pages), the same inline script appends the two files itself, so the game also runs fully offline (Basics-04). The docs' "do not embed the files manually" is kept whenever the SDK is present.

The bundle boots itself when it runs, instead of from `init([...]).then(...)` as in the docs' example; Start-03 allows this. `init()` runs the files in order and the CSS comes first, so the result is the same, and the no-SDK fallback needs no second start path.

In development, the plugin serves `/game.js` as a one-line classic script that dynamically imports `/src/main.ts` by absolute URL (blob scripts cannot resolve relative URLs), and `/game.css` as empty CSS because Vite injects styles itself. So `pnpm dev` exercises `init()` and the local tester SDK while keeping Vite's fast refresh.

*Alternative:* `vite build --watch` plus `vite preview` for development. Rejected: slower loop and a second workflow to document.

### 7. Storage through an injected key-value store
`LocalGameStorage` becomes `KeyValueGameStorage`, constructed with a function returning a `{ getItem, setItem }` store: `GameInterface.storage` when the SDK is present (on Famobi, and on localhost where `init.js` loads the local tester), `window.localStorage` otherwise (GitHub Pages, or `init.js` unreachable). The SDK storage itself keeps the data in the browser's `localStorage` under a key like `GAME_ID:savegame` and may also sync it online; the game never touches that key directly. It keeps the key `neon-snake:profile` and the existing profile fields, writes JSON strings, and accepts either a string or an object when reading. Validation of each field stays as it is.

When the profile is saved does not change: the best score is saved whenever it is beaten, and unlocks, run count and the player's mute choice when they change. The game's logic stays as it is; these are meaningful changes in the sense of Storage-01, and nothing is written every frame.

### 8. Pause
- Player pause: the queued task awaits `gamePause()`/`gameResume()`, then flips the existing `playerPauseActive` flag. It is ignored while a platform pause is active.
- Platform pause: `onPauseStateChange` maps to the existing `setSystemPaused`, which already shows "Please wait" without buttons and restores the player's pause afterwards. `isPaused()` is read once at connect time.
- The platform pause applies in every phase, not only during a level. `resetPauseState()` clears only the player's pause, so starting, restarting or quitting never clears a platform pause. While it is active the controller drops player commands (Start, level select, next level, retry).
- The snapshot's `pauseSource` only changes during a level, so the controller exposes the platform pause separately (`isSystemPaused()` and a `systemPauseChanged` event). The UI uses it to show "Please wait" over the menu and result screens and to disable their buttons and the level select.
- Tab visibility: the game adds no `visibilitychange` listener and keeps Phaser's existing behavior, which freezes the loop while the tab is hidden, with or without the SDK. When the tab is visible again Phaser only restarts its loop; a platform pause lives in the controller's state and stays until `onPauseStateChange(false)`, so returning to the tab never overrides it (the intent of Pause-02). Turning Phaser's hide-freeze off when `hasFeature("visibilitychange")` is false (Misc-03) belongs to the `hasFeature` flags, which are out of scope.

### 9. Platform requests
- `onGoToHome` and `onQuitGame` call `quitToMenu()`; they are ignored at the menu, where there is nothing to leave.
- `onGoToNextLevel` calls `goToNextLevel()`; `onRestartGame` calls `restartLevel()`, matching the game's Retry button.
- `onGoToLevel(level)` calls `startAtLevel(min(level, highestUnlockedLevel))`: an unlocked level starts as requested, and a level the player has not reached yet starts the highest unlocked level instead. The request is always answered with a level start, and `gameFinished` keeps meaning that every level was finished (Game-11), because a jump to a locked level could otherwise clear level 3 or unlock it without playing the earlier levels. Invalid numbers (not an integer, below 1) are ignored.
- `onGameOver` calls `forceGameOver()`.

### 10. Tests
Vitest in the Node environment, no DOM. Tests construct `GameController` with a real `SnakeGame`, an in-memory store and a recording fake platform whose promises the test resolves by hand, so waiting behavior is asserted directly. `Math.random` is stubbed so fruit always spawns in front of the snake, which makes clearing a level deterministic. The Famobi adapter is tested with a fake GameInterface object that records calls and exposes the registered callbacks.

## Risks / Trade-offs

- [The local tester SDK is downloaded from Famobi at runtime; offline development breaks] → The no-SDK fallback still loads the game; README explains that SDK checks need a connection.
- [Dropping commands while busy could swallow a platform request] → Requests only arrive during awaits; the local tester can lengthen them with its delay setting. The one-command rule is documented and tested.
- [Freezing ticks during a pending pause stops the snake before `gamePause` resolves, which goes against the wording of Game-06 ("Do not pause gameplay until the event is resolved")] → A conscious deviation: it prevents dying while a pause is pending, and the pause menu still appears only after the promise resolves. The README states it.
- [A new best score is written on every fruit while the player keeps beating it] → Kept from the existing game so its logic does not change; each write is one small JSON value, never per frame (Storage-01).
- [Tab switches cannot be verified with the local tester, which does not send a pause for them] → The platform pause is verified from the tester's menu, and the Phaser freeze while hidden is existing behavior; the README states the limitation.
- [Phaser freezes the game while hidden even on portals that require it to keep running (Misc-03)] → Needs `hasFeature("visibilitychange")`, which is out of scope; listed as not done.
- [`gameFinished` is allowed once per session, and the SDK flags any event after it] → Playing again after the final screen sends `gameStart` after `gameFinished`, which the local tester reports as an invalid event (see Open Questions).
- [IIFE bundle includes all of Phaser in one file (about 1.2 MB minified)] → Well below the 10 MiB initial download limit (Basics-02).

## Migration Plan

Existing players' saves (`neon-snake:profile` in `localStorage`) are not migrated into `GameInterface.storage`; on Famobi the SDK storage is the only store, so a player there starts with level 1 unlocked and no best score. In the no-SDK fallback the same key is still used, so saves survive. The profile fields do not change. Rollback is reverting the change.

## Open Questions

- Whether playing again after `gameFinished` is acceptable to Famobi, given that the SDK allows no events after it. The change still allows "Play again" and sends `gameFinished` only on the first clear of the last level per session; the README records this.
