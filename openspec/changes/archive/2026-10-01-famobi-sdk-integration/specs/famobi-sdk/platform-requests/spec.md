## Purpose

Lets the Famobi platform control Neon Snake from outside (go home, next level, a specific level, restart, quit, game over), with each command producing the same SDK events as the matching player action.

## ADDED Requirements

### Requirement: Platform navigation requests
The game SHALL register callbacks with `onGoToHome`, `onGoToNextLevel`, `onGoToLevel`, `onRestartGame` and `onQuitGame`. Each request SHALL end an active level with `gameEnd("quit")` first, then perform the navigation, calling `gameStart(level)` before any level begins. `onGoToLevel` SHALL start the requested level if the player has unlocked it, and otherwise SHALL start the highest unlocked level. Requests SHALL follow the one-command-at-a-time rule.

#### Scenario: Go home during a level
- **WHEN** the platform sends go-to-home while level 2 is being played
- **THEN** the SDK receives `gameEnd("quit")` and the game shows the menu after it resolves

#### Scenario: Go to an unlocked level
- **WHEN** the platform sends go-to-level 2 while the menu is shown and the player has unlocked level 2
- **THEN** the SDK receives `gameStart(2)` and level 2 starts after it resolves

#### Scenario: Go to a locked level
- **WHEN** the platform sends go-to-level 3 and the player has unlocked only level 1
- **THEN** the SDK receives `gameStart(1)` and level 1 starts after it resolves; level 3 stays locked

#### Scenario: Restart during a level
- **WHEN** the platform sends restart while level 1 is being played
- **THEN** the SDK receives `gameEnd("quit")`, then `gameStart(1)`, and level 1 starts again with the score it had at the start of the level

#### Scenario: Next level after clearing a level
- **WHEN** the platform sends next-level while the level-complete screen for level 1 is shown
- **THEN** the SDK receives `gameStart(2)` and level 2 starts with the carried-over score

#### Scenario: Request ignored at the menu
- **WHEN** the platform sends go-to-home or quit while the menu is shown
- **THEN** nothing changes and no SDK call is made

### Requirement: Platform game-over request
The game SHALL register a callback with `onGameOver`. During an active level it SHALL end the level as a failure, reporting `gameEnd("fail")` exactly as a player failure does; outside an active level it SHALL do nothing.

#### Scenario: Game over requested during play
- **WHEN** the platform sends game-over while the snake is moving
- **THEN** the SDK receives `gameEnd("fail")` and the "Game over" screen appears after it resolves
