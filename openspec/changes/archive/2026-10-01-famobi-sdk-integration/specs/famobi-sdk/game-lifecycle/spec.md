## Purpose

Reports the important moments of a Neon Snake session to the Famobi GameInterface (loading, readiness, level start and end, full-game completion, score and progress) in the order and timing the Famobi documentation requires.

## ADDED Requirements

### Requirement: Game loads through the GameInterface
The game SHALL be delivered as files that `GameInterface.init([...])` can load as classic scripts and stylesheets, and the page SHALL NOT load the game files in any other way while the GameInterface is available.

#### Scenario: SDK script in the head, game after the markup
- **WHEN** the page source is inspected
- **THEN** `init.js` is loaded inside `<head>`, and `GameInterface.init` is called after the game's markup so the game finds its elements when it runs

#### Scenario: Production build is loadable by init
- **WHEN** the production build is served and `index.html` calls `GameInterface.init` with the game's stylesheet and script
- **THEN** the game boots and renders its title screen without a module script tag in the page

#### Scenario: Local development uses the same entry path
- **WHEN** the game is started with the development server on localhost
- **THEN** the page loads the local Famobi test SDK through `init.js` and the game is loaded through `GameInterface.init`

### Requirement: Game reports loading progress and readiness
The game SHALL report loading progress as integers from 0 to 100 through `sendPreloadProgress` without repeating a value, SHALL report 100 before calling `gameReady`, and SHALL call `gameReady` exactly once, when the title screen accepts input.

#### Scenario: Ready after full progress
- **WHEN** the title screen becomes interactive
- **THEN** the SDK has received `sendPreloadProgress(100)` followed by one `gameReady()` call

### Requirement: Level start waits for gameStart
The game SHALL call `gameStart(level)` with the level number before any level begins, and gameplay for that level SHALL NOT start until the returned promise resolves. This applies to starting a new game, choosing a level from the menu, going to the next level, retrying after a game over, and levels started by a platform request.

#### Scenario: New game waits for the platform
- **WHEN** the player presses "Start game" and `gameStart(1)` has not resolved yet
- **THEN** the snake does not move and the menu stays on screen until the promise resolves

#### Scenario: Next level reports its own number
- **WHEN** the player presses "Next level" after clearing level 1
- **THEN** the SDK receives `gameStart(2)` before level 2 begins

### Requirement: Level end waits for gameEnd
The game SHALL call `gameEnd("complete")` when a level is cleared, `gameEnd("fail")` when the player loses, and `gameEnd("quit")` when the player or the platform leaves an active level. The result screen or menu SHALL NOT be shown, and the next action SHALL NOT run, until the returned promise resolves.

#### Scenario: Level cleared
- **WHEN** the player eats the last fruit of a level
- **THEN** the game calls `gameEnd("complete")` and shows the "Nice moves!" screen only after it resolves

#### Scenario: Player fails
- **WHEN** the snake hits a wall, an obstacle or itself
- **THEN** the game calls `gameEnd("fail")` and shows the "Game over" screen only after it resolves

#### Scenario: Player exits to menu
- **WHEN** the player chooses "Exit to menu" from the pause screen during a level
- **THEN** the game calls `gameEnd("quit")` and returns to the menu only after it resolves

#### Scenario: Leaving a finished level is not a quit
- **WHEN** the player chooses "Exit to menu" from a level-complete or game-over screen
- **THEN** the game does not call `gameEnd` again

### Requirement: Full completion reports gameFinished
After the last level is cleared, the game SHALL call `gameFinished()` after `gameEnd("complete")` has resolved, and SHALL show the final screen only after `gameFinished()` resolves. Because the SDK allows `gameFinished` only once per session, the game SHALL call it only the first time the last level is cleared in a session. The last level SHALL be reachable only after every earlier level has been cleared, by the player or by a platform request.

#### Scenario: Last level cleared
- **WHEN** the player clears level 3
- **THEN** the SDK receives `gameEnd("complete")`, then `gameFinished()`, and the "Snake master!" screen appears after both resolve

#### Scenario: Last level chosen from the level select
- **WHEN** a player who unlocked level 3 in an earlier session chooses it from the menu and clears it
- **THEN** the SDK receives `gameEnd("complete")`, then `gameFinished()`

#### Scenario: Second clear of the last level in the same session
- **WHEN** the player chooses "Play again" and clears level 3 again without reloading
- **THEN** the SDK receives `gameEnd("complete")` and no second `gameFinished()`

### Requirement: One platform command at a time
While an SDK call that gameplay must wait for is pending, the game SHALL ignore further player commands, SHALL NOT advance the snake, and SHALL keep result-screen buttons and the menu's level select disabled or hidden. When a level is restarted or replaced during play, the current level SHALL stay on screen, frozen, until the new level starts; the menu SHALL NOT appear in between.

#### Scenario: Double click on start
- **WHEN** the player presses "Start game" twice before `gameStart` resolves
- **THEN** the SDK receives only one `gameStart` call

#### Scenario: Snake frozen while waiting
- **WHEN** a pause, quit or start call is pending during a level
- **THEN** the snake does not move until the call resolves

### Requirement: Score reporting
The game SHALL report every change of the on-screen score with `sendScore(score, { level })`. When a level ends for any reason, it SHALL report the points earned in that level with `sendScore(levelScore, { type: "level", level })` and the run's on-screen score with `sendScore(score, { type: "total" })` before calling `gameEnd`. All scores SHALL be integers.

#### Scenario: Live score after eating fruit
- **WHEN** the player on level 2 eats a fruit and the on-screen score becomes 80
- **THEN** the SDK receives `sendScore(80, { level: 2 })`

#### Scenario: Level and total score at level end
- **WHEN** the player starts level 2 with 50 points on screen and clears it with 120 points on screen
- **THEN** the SDK receives `sendScore(70, { type: "level", level: 2 })` and `sendScore(120, { type: "total" })` before `gameEnd("complete")`

#### Scenario: Retry resets the level score
- **WHEN** the player starts level 1 with 0 points, fails with 30, and fails the retry with 20 points on screen
- **THEN** the second level end reports `sendScore(20, { type: "level", level: 1 })` and `sendScore(20, { type: "total" })`

### Requirement: Progress reporting
The game SHALL report level progress with `sendProgress` as an integer percentage from 0 to 100 of the fruit target, whenever that percentage changes, including the reset to 0 when a level starts.

#### Scenario: Progress after fruit
- **WHEN** the player eats 2 of 5 fruit on level 1
- **THEN** the SDK receives `sendProgress(40)`

### Requirement: Game still runs without the SDK
When no GameInterface is present, the game SHALL load its files directly, SHALL be fully playable, and SHALL save the profile to browser storage.

#### Scenario: Hosted outside Famobi
- **WHEN** the built game is opened on a host where `init.js` does not provide a GameInterface
- **THEN** the game loads, starts and saves progress as before the integration
