## Purpose

Keeps Neon Snake's pause and mute state consistent with the Famobi platform: the player's own pause and mute choices are reported to the platform, and the platform's master pause and mute always take priority without touching the player's choices.

## ADDED Requirements

### Requirement: Player pause and resume wait for the platform
When the player pauses an active level, the game SHALL call `gamePause()` and SHALL pause only after it resolves. When the player resumes, the game SHALL call `gameResume()` and SHALL resume only after it resolves.

#### Scenario: Player pauses
- **WHEN** the player presses the pause button or P during a level
- **THEN** the SDK receives `gamePause()` and the "Take a breather" pause menu appears after it resolves

#### Scenario: Player resumes
- **WHEN** the player presses "Resume" on the pause menu
- **THEN** the SDK receives `gameResume()` and the snake moves again after it resolves

### Requirement: Platform pause is a master pause
The game SHALL register a callback with `onPauseStateChange` before calling `gameReady`, SHALL check `isPaused()` at startup, and SHALL immediately freeze gameplay and block player input while the platform reports a pause. A platform pause SHALL show the "Please wait" overlay and SHALL NOT show the player's pause menu or call `gamePause`/`gameResume`. The platform pause SHALL apply in every phase, including the menu and result screens, and starting, restarting or quitting a level SHALL NOT clear it.

#### Scenario: Platform pauses during a level
- **WHEN** the platform reports `isPaused = true` while the snake is moving
- **THEN** the snake stops, the "Please wait" overlay appears without buttons, and no `gamePause` call is made

#### Scenario: Platform resumes
- **WHEN** the platform reports `isPaused = false` and the player had not paused
- **THEN** gameplay continues immediately

#### Scenario: Player pause survives a platform pause
- **WHEN** the player had paused, then the platform pauses and later resumes
- **THEN** the player's pause menu is shown again and gameplay stays paused

#### Scenario: Platform pause at the menu
- **WHEN** the platform reports `isPaused = true` while the menu is shown and the player presses "Start game" or a level button
- **THEN** the "Please wait" overlay covers the menu, no level starts and no `gameStart` call is made until the platform reports `isPaused = false`

#### Scenario: Player cannot pause during a platform pause
- **WHEN** the platform pause is active and the player presses P
- **THEN** nothing happens and no SDK call is made

#### Scenario: Platform pause arrives while a platform call is pending
- **WHEN** the player pressed "Start game", `gameStart(1)` is pending, and the platform reports `isPaused = true`
- **THEN** the pause applies immediately, and level 1 starts frozen behind "Please wait" once `gameStart` resolves

#### Scenario: Returning to the tab does not override a platform pause
- **WHEN** the platform pause is active and the player switches tabs and comes back
- **THEN** the game stays paused until the platform reports `isPaused = false`, and the game makes no SDK call of its own

### Requirement: Mute follows player choice and platform master mute
At startup the game SHALL restore the player's saved mute choice, SHALL apply `isMuted()` as a master mute, and SHALL report the player's choice with `gameMuted(isMuted)`. It SHALL report each later player mute change with `gameMuted`, SHALL apply `onMuteStateChange` as a master mute without changing or saving the player's choice.

#### Scenario: Player mutes
- **WHEN** the player presses the mute button
- **THEN** sound stops, the choice is saved, and the SDK receives `gameMuted(true)`

#### Scenario: Platform mutes and unmutes
- **WHEN** the platform reports muted and later unmuted while the player's choice is "sound on"
- **THEN** sound stops, then plays again, and the saved player choice stays "sound on"
