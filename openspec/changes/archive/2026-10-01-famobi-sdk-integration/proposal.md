## Why

The first step is to integrate the Famobi GameInterface SDK into Neon Snake, so a game portal sees the important moments of the game: loading, starting and ending gameplay, score, progress and pause. Today the game has no SDK code at all, and its README says it intentionally leaves the SDK out.

## What Changes

- Load the game through `GameInterface.init([...])` as the SDK requires. `init()` downloads each file and runs it as a classic script, so the production build becomes a single IIFE bundle (`game.js`) plus `game.css`. `index.html` loads `init.js` and calls `init()`, and loads the two files itself only when no GameInterface exists.
- Report loading with `sendPreloadProgress` and signal `gameReady` once the title screen accepts input.
- Wrap every gameplay transition in the matching awaited SDK event: `gameStart(level)` before a level begins, `gameEnd("complete" | "fail" | "quit")` before a result screen or menu is shown, and `gameFinished()` the first time the last level is cleared in a session (the SDK allows it only once, and level 3 is reachable only after levels 1 and 2 are cleared). Only one platform command runs at a time.
- Report the live score, the level score (points earned in that level) and the total score (the run's score on screen, which carries over between levels) with `sendScore`, and level progress with `sendProgress`.
- Player pause and resume call `gamePause` / `gameResume` and wait for them. A platform pause arrives through `onPauseStateChange`, applies in every phase (menu and result screens included), blocks player input, shows the existing "Please wait" overlay with no pause menu, and is checked with `isPaused()` at startup. The game adds no tab-visibility handling of its own: Phaser already freezes the game while the tab is hidden, and returning to the tab never lifts a platform pause.
- Respect the platform's master mute (`isMuted`, `onMuteStateChange`) and report the player's own mute choice with `gameMuted`.
- Handle the platform requests `onGoToHome`, `onGoToNextLevel`, `onGoToLevel`, `onRestartGame`, `onQuitGame` and `onGameOver`, using controller methods the game already has. `onGoToLevel` for a level the player has not unlocked yet starts the highest unlocked level instead.
- Save the player profile through `GameInterface.storage` instead of `localStorage`, with the same fields as today.
- Add `famobi.json` with `maxLevels: 3`.
- Keep the game playable when the SDK is absent (for example on GitHub Pages, where `init.js` stays inactive).
- Add Vitest tests that drive the controller and the SDK adapter with a fake GameInterface.
- Update the README: how to run and verify the integration locally, and every design choice and assumption made where the SDK docs leave room for interpretation.

## Capabilities

### New Capabilities
- `famobi-sdk/game-lifecycle`: loading, start and end of gameplay, full-game completion, score and progress reporting, and the rule that one platform command runs at a time.
- `famobi-sdk/pause-and-audio`: player pause, platform (master) pause, and platform/player mute.
- `famobi-sdk/platform-requests`: navigation and game-over commands sent by the platform to the game.
- `famobi-sdk/storage`: saving the player profile through the SDK storage.

### Modified Capabilities
<!-- None: there are no existing specs under openspec/specs/. -->

## Impact

- **Code:** `src/application/GameController.ts` (awaited platform commands, busy state, run summaries, platform-pause state), a new platform interface in `src/application/`, a new Famobi adapter in `src/platform/famobi/`, `src/core/storage/GameStorage.ts` (key-value store injection), `src/game/snakeGame.ts` and `src/game/types.ts` (`levelScore` in the snapshot), `src/main.ts` (wiring and busy UI state).
- **Build:** `vite.config.ts` switches production output to an IIFE bundle and adds a small dev-server shim so `pnpm dev` still works through `init()`. `index.html` loses its module script tag.
- **Dependencies:** `vitest` (dev only). Runtime adds the remote `https://api.games.famobi.com/init.js`, which Basics-04 allows as the only external API. The no-SDK fallback keeps the game fully playable offline, which Basics-04 also requires.
- **Deploy:** the GitHub Pages workflow keeps working through the no-SDK fallback.
- **Out of scope:** ads, IAP, localisation, credits screen, `hasFeature` UI flags (UI-01/02), the Famobi copyright logo (UI-03), stage events, a lifetime total score, and the Famobi Tool checklist beyond these features; gameplay analytics, backend and dashboard are separate changes.
