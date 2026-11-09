## Purpose

Defines how the backend receives gameplay analytics events over HTTP, checks them, and stores them in Firestore running in the local emulator.

## ADDED Requirements

### Requirement: Events are received in batches
The backend SHALL accept `POST /api/events` with a JSON array of 1 to 50 events, sent either as `application/json` or as `text/plain` (the form a page-unload request uses). It SHALL store every valid event, reject each invalid one individually, and answer `202` with the number of accepted events, the number of duplicates, and for each rejected event its position in the array and the reasons. A body that is not a JSON array, is empty, holds more than 50 events or exceeds 100 kB SHALL be rejected as a whole with `400` or `413`.

#### Scenario: Valid batch
- **WHEN** the game posts one valid `run_started` event
- **THEN** the backend answers `202` with 1 accepted, 0 duplicates and no rejections, and the event is stored

#### Scenario: Partly invalid batch
- **WHEN** a batch holds two valid events and one with level `0`
- **THEN** the two valid events are stored and the response lists the third as rejected with a reason naming the level

#### Scenario: Not an array
- **WHEN** the body is a single JSON object or invalid JSON
- **THEN** the backend answers `400` and stores nothing

#### Scenario: Too many events
- **WHEN** a batch holds 51 events
- **THEN** the backend answers `400` and stores nothing

### Requirement: Incoming events are checked
The backend SHALL accept only events that match the documented contract: a supported schema version, a known type, IDs of 1 to 100 letters, digits, `-` or `_`, the level as a positive integer, a valid ISO 8601 time no more than 5 minutes in the future, and for `run_ended` an outcome of `complete`, `fail` or `quit`, non-negative integer score, level score and duration, and progress as an integer from 0 to 100 that matches the outcome: exactly 100 for `complete`, below 100 for `fail` and `quit`. A `run_ended` event with outcome `fail` SHALL carry a failure reason of `wall`, `snake`, `obstacle` or `external`; for other events the failure reason SHALL be absent or `null`. Fields that are not part of the contract SHALL be dropped, not stored.

#### Scenario: Unknown outcome
- **WHEN** a `run_ended` event has outcome `won`
- **THEN** it is rejected with a reason naming the outcome

#### Scenario: Unsafe ID
- **WHEN** an event's run ID is `runs/r1`
- **THEN** it is rejected with a reason naming the run ID

#### Scenario: Fail without a reason
- **WHEN** a `run_ended` event has outcome `fail` and no failure reason
- **THEN** it is rejected with a reason naming the failure reason

#### Scenario: Progress does not match the outcome
- **WHEN** a `run_ended` event has outcome `complete` and progress 80, or outcome `fail` and progress 100
- **THEN** it is rejected with a reason naming the progress

#### Scenario: Time in the future
- **WHEN** an event's time is one hour ahead of the server clock
- **THEN** it is rejected

#### Scenario: Extra field
- **WHEN** an otherwise valid event carries an extra field `playerName`
- **THEN** the event is stored without `playerName`

### Requirement: Retried events are stored once
The backend SHALL identify events by their event ID. An event whose ID is already stored SHALL be counted as a duplicate and SHALL NOT change any stored data.

#### Scenario: Same batch sent twice
- **WHEN** the game resends a batch after a network error
- **THEN** the second response counts its events as duplicates and the stored data is unchanged

### Requirement: A run's identity is fixed
The first stored event of a run SHALL fix the run's session ID and level. A later event for the same run ID with a different session ID or level SHALL be rejected with a reason naming the conflict. A run SHALL have at most one `run_started` and one `run_ended` event: a further event of the same type with a new event ID SHALL be rejected. A rejected event SHALL NOT change any stored data.

#### Scenario: Level mismatch
- **WHEN** run `r1` was started on level 1 and a `run_ended` for `r1` reports level 2
- **THEN** the `run_ended` is rejected with a reason naming the level, and run `r1` is unchanged

#### Scenario: Session mismatch
- **WHEN** run `r1` belongs to session `s1` and a `run_ended` for `r1` reports session `s2`
- **THEN** the `run_ended` is rejected with a reason naming the session

#### Scenario: Second end with a new event ID
- **WHEN** run `r1` has ended with outcome `fail` and another `run_ended` for `r1` with a new event ID reports outcome `complete`
- **THEN** the second event is rejected and run `r1` keeps outcome `fail`

#### Scenario: Resent end event
- **WHEN** the same `run_ended` event (same event ID) for `r1` arrives again
- **THEN** it is counted as a duplicate, not rejected

### Requirement: Events are stored raw and summarised per run
The backend SHALL store each accepted event as validated (with fields outside the contract dropped) together with the time it was received, and SHALL keep one run record per run ID with its session, level, status (`unfinished`, `complete`, `fail` or `quit`), start and end times, failure reason, score, level score, progress and duration. A run record SHALL end up the same whichever of its two events arrives first.

#### Scenario: Start then end
- **WHEN** `run_started` and then `run_ended` (outcome `fail`, reason `wall`) arrive for run `r1`
- **THEN** run `r1` has status `fail`, failure reason `wall`, both times, and the end event's score, progress and duration

#### Scenario: End arrives first
- **WHEN** `run_ended` for run `r2` arrives before its `run_started`
- **THEN** after both have arrived, run `r2` holds the same data as in the start-then-end order

### Requirement: Storage problems are reported, not waited out
The backend SHALL save the events of a batch one at a time, in array order. When the store does not answer within a time limit shorter than the game's request timeout, the backend SHALL stop processing the batch and answer `POST /api/events` with `503`, so the game retries later. Events of that batch may or may not have been stored; a retry is safe because stored events are counted as duplicates.

#### Scenario: Emulator stopped
- **WHEN** the emulator is stopped and the game posts events
- **THEN** the backend answers `503` within the time limit

#### Scenario: Start and end in one batch
- **WHEN** a batch holds the `run_started` and `run_ended` of run `r1`, in that order
- **THEN** both are stored and run `r1` has the end event's outcome

#### Scenario: Same event twice in one batch
- **WHEN** a batch holds the same event ID twice
- **THEN** the first is accepted and the second is counted as a duplicate

### Requirement: Storage runs only on the local emulator
The backend SHALL store data only in the Firestore emulator, using a `demo-` project ID, and SHALL refuse to start when no emulator address is configured. No credentials or secrets SHALL be required or stored in the repository.

#### Scenario: Emulator not configured
- **WHEN** the backend is started without an emulator address
- **THEN** it exits with a message explaining how to start the emulator

### Requirement: Only the local frontends may read API responses
The backend SHALL allow cross-origin reads only from the configured local origins of the game and the dashboard. This controls which pages can read responses; it does not stop other pages from posting events.

#### Scenario: Unknown origin
- **WHEN** a page from another origin calls the API from a browser
- **THEN** the browser blocks that page from reading the response because the origin is not allowed

### Requirement: Health check
The backend SHALL answer `GET /api/health` with `200` when it can reach the Firestore emulator and `503` when it cannot, within a time limit.

#### Scenario: Emulator stopped
- **WHEN** the emulator is stopped while the backend runs
- **THEN** `GET /api/health` answers `503` within the time limit
