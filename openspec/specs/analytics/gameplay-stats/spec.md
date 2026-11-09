# analytics/gameplay-stats Specification

## Purpose
Defines the gameplay statistics the backend prepares from stored runs, so a frontend can show them without knowing the stored data structure. The statistics answer where the player experience can be improved: which levels players fail or leave, how far they get, and what fails them.

## Requirements

### Requirement: Finished and unfinished runs
A run with an end event SHALL count as finished with its outcome (`complete`, `fail` or `quit`). A run without an end event SHALL count as `unfinished`; it may still be in play or its page may have been closed. A run with an end event but no start event SHALL count as finished. Completion rates SHALL be completed runs divided by finished runs, and `null` when no run has finished.

#### Scenario: Tab closed mid-level
- **WHEN** run `r1` has a start event and no end event
- **THEN** statistics count `r1` as unfinished and leave it out of the completion rate

#### Scenario: Start event lost
- **WHEN** run `r2` has only a `run_ended` event with outcome `fail`
- **THEN** statistics count `r2` as a finished, failed run

### Requirement: Overview
`GET /api/stats/overview` SHALL return the number of sessions, runs, finished runs and unfinished runs, the completion rate, and the average number of runs per session. When there are no runs, the counts SHALL be zero and the completion rate and runs per session SHALL be `null`.

#### Scenario: Mixed outcomes
- **WHEN** the stored runs are 2 complete, 1 fail, 1 quit and 1 unfinished across 2 sessions
- **THEN** the overview reports 2 sessions, 5 runs, 4 finished, 1 unfinished, a completion rate of 0.5 and 2.5 runs per session

#### Scenario: No data
- **WHEN** nothing has been stored
- **THEN** the overview reports zero counts and `null` for the completion rate and runs per session

### Requirement: Results per level
`GET /api/stats/levels` SHALL return, for every level with at least one run (finished or unfinished), in ascending order; levels without runs SHALL be left out:
- the number of runs per outcome (`complete`, `fail`, `quit`, `unfinished`);
- the completion rate;
- the average duration of finished runs: `complete`, `fail` and `quit` runs count, unfinished runs are excluded, and the value is `null` when the level has no finished runs;
- the number of failed runs per progress range: 0-19, 20-39, 40-59, 60-79 and 80-99 percent;
- the number of failed runs per failure reason (`wall`, `snake`, `obstacle`, `external`).

All five progress ranges and all four failure reasons SHALL be present, with 0 where there are no runs.

#### Scenario: Level 2 is hard
- **WHEN** level 2 has 1 complete and 3 fail runs
- **THEN** its entry reports complete 1, fail 3 and a completion rate of 0.25

#### Scenario: Players fail early
- **WHEN** level 3 has failed runs at progress 0, 11 and 89
- **THEN** its progress ranges report 2 for 0-19, 1 for 80-99 and 0 for the others

#### Scenario: What fails players
- **WHEN** level 2 has failed runs with reasons `obstacle`, `obstacle` and `wall`
- **THEN** its failure reasons report obstacle 2, wall 1, snake 0 and external 0

#### Scenario: Average duration
- **WHEN** level 1 has a complete run of 10 s, a failed run of 4 s, a quit run of 1 s and an unfinished run
- **THEN** its average duration is 5000 ms

#### Scenario: Only unfinished runs
- **WHEN** level 3 has only unfinished runs
- **THEN** its entry is present with an average duration of `null` and a completion rate of `null`
