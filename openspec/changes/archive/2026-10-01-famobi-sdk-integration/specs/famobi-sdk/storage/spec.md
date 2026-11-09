## Purpose

Stores the Neon Snake player profile through the Famobi GameInterface storage so the platform can keep it. The profile keeps its existing fields.

## ADDED Requirements

### Requirement: Profile is saved through the SDK storage
When the GameInterface is available, the game SHALL read and write the player profile only through `GameInterface.storage`, SHALL NOT use `window.localStorage` directly, SHALL read the profile once at startup, and SHALL write it only when a saved value changes, never every frame.

#### Scenario: Unlocking a level
- **WHEN** the player clears level 1 for the first time
- **THEN** the profile with `highestUnlockedLevel: 2` is written through `GameInterface.storage.setItem`

#### Scenario: Reload keeps progress
- **WHEN** the page is reloaded after the player unlocked level 2 and muted the sound
- **THEN** the menu shows level 2 unlocked and the game starts muted

### Requirement: Saving keeps the existing timing
The game SHALL save the profile at the same moments as before the integration: when the best score is beaten, when a level is unlocked, when a run starts, and when the player changes the mute choice.

#### Scenario: New best score
- **WHEN** a player with a saved `bestScore` of 50 reaches 60 points
- **THEN** the profile is written with `bestScore: 60` through `GameInterface.storage.setItem`

### Requirement: Profile tolerates missing or invalid data
Loading the profile SHALL fall back to defaults for any missing, malformed or out-of-range field, whether the stored value is a JSON string or an object, and storage errors SHALL NOT stop the game.

#### Scenario: Corrupted save
- **WHEN** the stored profile is not valid JSON
- **THEN** the game starts with the default profile
