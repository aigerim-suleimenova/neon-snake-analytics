## 1. Setup

- [x] 1.1 Add `vitest` as a dev dependency and a `test` script (`vitest run`); verify `pnpm test` runs (with no tests yet it exits cleanly using `--passWithNoTests`)
- [x] 1.2 Add `public/famobi.json` with `{ "maxLevels": 3 }`; verify it appears in `dist/` after `pnpm build`

## 2. Storage

- [x] 2.1 Replace `LocalGameStorage` with `KeyValueGameStorage` that takes a store getter and reads string or object values, keeping the existing profile fields (remove the `totalScore` field added earlier); verify with unit tests for valid, missing, corrupted and object-valued saves
- [x] 2.2 Add `levelScore` (`score - scoreAtLevelStart`) to `GameSnapshot`; verify a test that it is 0 at level start, grows while eating, and resets on retry

## 3. Controller and platform port

- [x] 3.1 Add the `GamePlatform` interface, `RunSummary` type and a no-op `offlinePlatform` (remove `totalScore` from the existing `RunSummary`); verify `pnpm check` passes
- [x] 3.2 Add the task queue, busy flag, `busyChanged` event (type already added) and tick freezing with deferred-tick replay to `GameController`; verify tests that a second command is ignored while one is pending and that the snake does not move while busy
- [x] 3.3 Make start commands (`startNewGame`, `startAtLevel`, `goToLevel`, `restartLevel`, `goToNextLevel`) await `startRun(level)` before changing the simulation, ending an active level with `endRun("quit")` first and keeping the frozen level on screen (no pass through the menu) until the new level starts; on that direct path emit `runEnded` (quit) and `runStarted` and count the run in `totalRuns`; verify tests for the order of platform calls and phases, that no menu snapshot appears during a restart, and that a restart emits both run events and increments `totalRuns`
- [x] 3.4 Queue `endRun("complete" | "fail")` from the snapshot handler, followed by `finishGame` after the last level, and make `quitToMenu` await `endRun("quit")` before leaving; verify tests for level cleared, failure, last level (also when started from the level select) and quit, including that leaving a result screen sends nothing
- [x] 3.5 Build `RunSummary` (level, score, levelScore, progress 0-1, durationMs) without changing when the profile is saved; verify a test with real game values (level 2 starts at 50 points and fails at 90: level score 40, total 90) and that the best score is still saved during play
- [x] 3.6 Make player pause/resume await `pauseRun`/`resumeRun` and ignore them during a platform pause; make `resetPauseState()` clear only the player's pause, drop player commands in every phase while a platform pause is active, apply platform pause and mute changes immediately even while a task is pending and re-apply the platform pause when a level starts, and expose `isSystemPaused()` plus a `systemPauseChanged` event; verify tests for both, for pause restored after a platform pause, for a platform pause arriving during a pending `startRun` (level starts frozen), that Start and a level button at the menu do nothing during a platform pause, and that the event fires at the menu

## 4. Famobi adapter

- [x] 4.1 Add typed `FamobiGameInterface` (the methods used) and `getGameInterface()`; verify `pnpm check` passes
- [x] 4.2 Implement `FamobiPlatform` (gameStart, level and run-total `sendScore` then `gameEnd` with metrics and progress converted to 0-100, `gameFinished` only on the first clear of the last level per session, gamePause, gameResume); verify tests with a fake GameInterface for call order and arguments, including no second `gameFinished`
- [x] 4.3 Implement `connectFamobi`: preload 0/100 then `gameReady` on `ready`, live `sendScore`, integer `sendProgress` without repeats, `onPauseStateChange` + `isPaused`, `isMuted` + `onMuteStateChange` + `gameMuted`, and the six request callbacks (`onGoToLevel` starts `min(level, highestUnlockedLevel)` through `startAtLevel`); no `visibilitychange` listener; verify tests that trigger each registered callback, including go-to-level for a locked level starting the highest unlocked one

## 5. Loading and wiring

- [x] 5.1 Wire `main.ts`: choose storage and platform from `getGameInterface()`, call `connectFamobi`, disable overlay buttons and the level select / hide result screens while busy, and show "Please wait" over any screen (with buttons and level select disabled) during a platform pause using `systemPauseChanged`; verify manually that the game still plays with the SDK absent
- [x] 5.2 Update `index.html` to load `init.js` inside `<head>` and call `GameInterface.init(["game.css", "game.js"])` from an inline script at the end of `<body>` with the no-SDK fallback, and remove the module script tag; verify the page source and the `?holdInit=1` test (no game file loads before START)
- [x] 5.3 Configure Vite: library-mode IIFE build (`game.js`, `game.css`), `index.html` copied to `dist`, `process.env.NODE_ENV` defined, and the dev-server shim for `/game.js` and `/game.css`; verify `pnpm build` output files and that `pnpm dev` loads the game

## 6. Verification and docs

- [x] 6.1 Run `pnpm check`, `pnpm test` and `pnpm build`; verify all pass
- [x] 6.2 Play through in Chrome with the local tester SDK (`pnpm dev` and the built `dist/` via `pnpm preview`): check the console for `init` → `sendPreloadProgress` → `gameReady`, `gameStart`/`gameEnd`/`gameFinished`, `sendScore` (live/level/total), `sendProgress`, `gamePause`/`gameResume`, platform pause from the test menu during a level and at the menu screen, no `INVALID_GAME_EVENT` except the known "Play again" case, and `storage` writes; record what was seen (tab switches are not checked: the local tester sends no pause for them)
- [x] 6.3 Update the README: remove "does not contain the Famobi SDK", add SDK integration overview, how to install, run and verify locally (including that pnpm 11 needs Node 22.13 or newer), known limitations, what I would improve with more time (for this part), disclosure of AI tool use, and a "Design choices and assumptions" section that gives each personal judgement call together with its reason:
  - Scope: the SDK is wired only to features the game already has; no new game features were added and the game's logic (levels, scoring, unlocks, saving) stays the same.
  - Level score = points earned in that level: the docs ask for a per-level score, and the game already tracks the score at level start. Famobi's Game-08 example sends the running score as the level score instead.
  - Total score = the run's score on screen (it carries over between levels): the Game-08 example sends a lifetime total ("total cumulative score across all sessions/levels"), but that is only an example, and a lifetime total would be a new profile field. Assumption to confirm with Famobi.
  - Progress = integer % of the fruit target: fruit eaten is the only progress within a level, and 0-100 matches `sendPreloadProgress`.
  - Preload sent as 0 then 100 just before `gameReady`: the game has no assets to download (graphics and audio are procedural).
  - One command at a time; player and platform commands arriving while an SDK promise is pending are dropped: prevents double clicks and conflicting transitions while gameplay must wait; end-of-level events are always queued so none are lost.
  - The snake freezes while a promise is pending: the docs forbid gameplay continuing before the promise resolves, and it stops the player dying during a pending pause. For `gamePause` this is a conscious deviation from the wording of Game-06 ("do not pause gameplay until resolved").
  - Restart and go-to-level during play keep the frozen level on screen until the new level starts: avoids a menu flicker between `gameEnd("quit")` and `gameStart`; the run is still counted and reported as ended and started.
  - Platform pause applies on every screen and blocks Start, the level select, retry and next level: Pause-01 says the pause can arrive at any moment and player input must stop.
  - No own tab-visibility handling: Phaser already freezes the game while the tab is hidden, and a platform pause stays in the game's state until `onPauseStateChange(false)`, so returning to the tab never overrides it (Pause-02). The local tester does not send a pause on tab switch, so this cannot be checked locally.
  - Platform pause and mute changes apply immediately, even while an SDK promise is pending; a level started during a platform pause begins frozen: Pause-01 says the state can change at any moment.
  - `gameFinished` is sent the first time the last level is cleared in a session, including when level 3 is chosen from the level select: level 3 unlocks only after levels 1 and 2 are cleared, so every level has been finished (Game-11). The SDK allows it once and flags any event after it; "Play again" is still offered and its `gameStart` is flagged by the tester (open question for Famobi).
  - `onGoToLevel` for a level the player has not reached yet starts the highest unlocked level instead: the request is still answered with a level start, but a jump to a locked level would let `gameFinished` fire, or level 3 unlock, without the earlier levels being played. Requests-03 does not mention unlocks; this is our reading.
  - `onRestartGame` restarts the current level, not the whole game: matches the game's existing Retry button.
  - Go-home and quit both return to the menu and are ignored at the menu: the game has a single menu screen and nothing to leave when already there (the Requests docs ask for them "at least during the actual gameplay").
  - `gameEnd` metrics (level, score, levelScore, durationMs, progress): uses the documented `EventParams.metrics` shape; Famobi's optional Analytics-01 asks for metrics that show level difficulty, and these are the values the game already has.
  - Leaving a result screen sends no second `gameEnd`: the SDK's order check rejects `gameEnd` after `gameEnd`.
  - Saving keeps its existing timing (the best score is written whenever it is beaten): the game's logic stays the same; these are meaningful changes under Storage-01 and nothing is written per frame.
  - Not done: the `hasFeature` flags (UI-01/02/04, Misc-02 tutorial, Misc-03 visibilitychange, Misc-05 home) and the Famobi copyright logo (UI-03), left for a later change. So on a portal that requires the game to keep running while hidden, Phaser still freezes it.
  - `GameInterface.log` (Misc-01) is not needed: the game has no `console` calls.
  - `init.js` sits in `<head>` (Start-01) and `init()` is called after the markup: the game reads its page elements as soon as its script runs.
  - No stage events: Neon Snake levels have no stages.
  - Existing `localStorage` saves are not migrated: on Famobi the SDK storage is the only store, so a player there starts with level 1 unlocked and no best score; the no-SDK fallback keeps the same key so those saves still work there.
  - No-SDK fallback: `init.js` only activates on localhost, private-network hosts, `*.local` or when forced, so GitHub Pages must load the game itself; the fallback also keeps the game playable offline (Basics-04). With the SDK present the files are never embedded manually.
  - The bundle starts itself instead of from `init([...]).then(...)`: Start-03 allows a game that starts when its engine loads; `init()` runs the files in order after the CSS, and the fallback needs no second start path.
  - IIFE build and the dev-server shim: `init()` runs files as classic scripts, so ES modules cannot load; the shim keeps one code path for `pnpm dev` and production.

  Verify the README renders and every command in it works
