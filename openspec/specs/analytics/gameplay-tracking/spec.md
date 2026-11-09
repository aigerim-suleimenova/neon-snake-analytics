# analytics/gameplay-tracking Specification

## Purpose
Records the gameplay activity of Neon Snake as analytics events and delivers them to the project's own backend, without ever affecting gameplay.

## Requirements

### Requirement: Level attempts are recorded as start and end events
The game SHALL record a `run_started` event when a level attempt begins and a `run_ended` event when it ends. Every event SHALL carry a schema version, a unique event ID, the session ID, the run ID, the level number and the time it happened (ISO 8601, UTC). A `run_ended` event SHALL also carry the outcome (`complete`, `fail` or `quit`), the run's on-screen score, the points earned in that level, the progress as an integer percentage from 0 to 100 of the level's fruit target, and the duration in milliseconds. A `run_ended` event with outcome `fail` SHALL carry the failure reason (`wall`, `snake`, `obstacle` or `external` for a game over requested by the platform); other outcomes SHALL carry none. A restart or level change during play SHALL produce a `run_ended` with outcome `quit` followed by a new `run_started`.

#### Scenario: Level cleared
- **WHEN** the player starts level 1 and clears it with 50 points after 9 seconds
- **THEN** the game records `run_started` for level 1, then `run_ended` for the same run ID with outcome `complete`, no failure reason, score 50, level score 50, progress 100 and a duration of about 9000 ms

#### Scenario: Level failed
- **WHEN** the player hits an obstacle on level 2 after eating 2 of 7 fruit
- **THEN** the game records `run_ended` with outcome `fail`, failure reason `obstacle` and progress 29

#### Scenario: Platform ends the level
- **WHEN** the platform requests a game over during a level
- **THEN** the game records `run_ended` with outcome `fail` and failure reason `external`

#### Scenario: Player leaves a level
- **WHEN** the player chooses "Exit to menu" or restarts during a level
- **THEN** the game records `run_ended` with outcome `quit` and no failure reason for that run

### Requirement: Events are grouped by session and run
A session SHALL represent one game-page session: the game SHALL create a random session ID once per page load, and every run on that page SHALL belong to it. A new page session (a reload or a new tab) SHALL get a new session ID. The game SHALL create a random run ID for every level attempt. IDs SHALL consist only of letters, digits, `-` and `_`. The `run_ended` event of an attempt SHALL carry the same run ID, session ID and level as its `run_started` event. No personal data and no persistent player identity SHALL be recorded.

#### Scenario: Two attempts in one visit
- **WHEN** the player fails level 1 and retries it without reloading the page
- **THEN** both attempts carry the same session ID and different run IDs

#### Scenario: New visit
- **WHEN** the page is reloaded
- **THEN** later events carry a new session ID

### Requirement: Events are delivered without affecting gameplay
The game SHALL send each event to the configured backend URL as soon as it is recorded, and SHALL keep it pending until the backend answers with a success status. Any `2xx` answer SHALL resolve the submitted events permanently: they leave the pending list and are never sent again. Gameplay SHALL NOT wait for, or change because of, the result of sending. A request that gets no answer within a time limit SHALL count as failed. A resent event SHALL keep its event ID, and no event SHALL be in two requests at once. Events whose request failed through a network error, a timeout, a server error, `408` or `429` SHALL be retried with increasing delays that never exceed 30 seconds; events the backend rejects (any other `4xx` answer, or listed as rejected in a success answer) SHALL be dropped and not retried. At most a fixed number of events SHALL be kept pending, after which the oldest are dropped. A request SHALL carry at most 50 events.

#### Scenario: Backend reachable
- **WHEN** the player starts a level while the backend is running
- **THEN** the backend receives the `run_started` event within a few seconds

#### Scenario: Backend temporarily down
- **WHEN** the backend is stopped while the player clears a level, and started again a little later
- **THEN** the game keeps running normally and the backend receives the level's events after it is back

#### Scenario: Backend hangs
- **WHEN** the backend accepts the connection but never answers
- **THEN** the request is treated as failed after the time limit and the events are retried later

#### Scenario: Event rejected
- **WHEN** the backend lists an event as rejected
- **THEN** the game drops that event and does not send it again

### Requirement: Pending events are handed over when the page is hidden or closed
When the page becomes hidden or is being unloaded, the game SHALL hand all pending events to the browser with a request that survives the page unloading, in batches of at most 50, including events whose earlier request has not answered yet. Events the browser accepts for delivery SHALL no longer be pending, and a later answer to their earlier request SHALL NOT make them pending again.

#### Scenario: Tab closed right after a level ended
- **WHEN** the player quits a level and closes the tab before the `run_ended` request has answered
- **THEN** the game hands the `run_ended` event to the browser for delivery as the page unloads

#### Scenario: Many pending events
- **WHEN** 80 events are pending and the page is closed
- **THEN** the game hands them over as two requests of 50 and 30 events

#### Scenario: Mobile browser switches apps
- **WHEN** events are pending and the page becomes hidden
- **THEN** the game hands the pending events to the browser for delivery

### Requirement: Analytics is optional
When no backend URL is configured, the game SHALL record and send nothing and SHALL work exactly as without analytics.

#### Scenario: Deployed without a backend
- **WHEN** the game is built without a backend URL, as for GitHub Pages
- **THEN** no analytics request is made and gameplay is unchanged
