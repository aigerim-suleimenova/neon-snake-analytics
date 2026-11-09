## Purpose

Defines the analytics dashboard: what it shows from the backend's statistics API, how values are labelled and formatted, and how it behaves while loading, refreshing, without data and when the backend cannot be reached. It gives a producer a quick picture of how much the game is played, how hard each level is, and where and why players fail.

## ADDED Requirements

### Requirement: Loading data
The dashboard SHALL request the overview and the per-level statistics from the backend when the page opens and again when the viewer clicks Refresh or Retry. It SHALL NOT request data on its own otherwise. While a request is running, Refresh SHALL be disabled, so at most one load runs at a time. The backend address SHALL be configurable and SHALL default to `http://localhost:3000`.

#### Scenario: First load
- **WHEN** the page opens
- **THEN** the dashboard requests both statistics once, shows the loading state until both have answered, and then shows the data

#### Scenario: Refresh
- **WHEN** data is shown and the viewer clicks Refresh
- **THEN** the shown data stays visible, the button reads "Refreshing…" and is disabled, and the new data replaces the old when both answers arrive

#### Scenario: No polling
- **WHEN** the page stays open without the viewer clicking anything
- **THEN** the dashboard makes no further requests

### Requirement: Status line
The header SHALL show the state of the data: "Loading…" during the first load, "Updated HH:MM" (24-hour local time of the last successful load) while data is shown, including during a refresh, and "Offline" while the backend is unreachable, including while a Retry runs.

#### Scenario: After a successful load at 12:04
- **WHEN** both statistics arrive at 12:04 local time
- **THEN** the status reads "Updated 12:04"

### Requirement: Backend unreachable
When either request fails (no answer, a timeout, a non-success status, or a body that does not match the documented statistics), the dashboard SHALL show the error state: a notice "Analytics backend is unreachable" with the hint to check that the backend and Firestore emulator are running, a Retry button, "—" for every overview value with "Unavailable" as its explanation, and "Data unavailable" in place of the graphs and the table. There SHALL be no partial view with only one of the two statistics. A failed Refresh SHALL also show the error state. Retry SHALL read "Retrying…" and be disabled while its request runs.

#### Scenario: Backend stopped
- **WHEN** the backend does not answer
- **THEN** the error state is shown with the status "Offline"

#### Scenario: One request fails
- **WHEN** the overview answers but the per-level request returns `503`
- **THEN** the error state is shown, not the overview alone

#### Scenario: Retry succeeds
- **WHEN** the error state is shown, the backend is running again and the viewer clicks Retry
- **THEN** the dashboard requests both statistics and shows the data

### Requirement: No gameplay yet
When the overview reports zero runs, the dashboard SHALL show a notice "No gameplay recorded yet. Play a level in the game, then click Refresh.", overview counts of 0, "—" for the completion rate and runs per session, "No level data yet" in place of the graphs and "No levels played yet" in the table.

#### Scenario: Fresh emulator
- **WHEN** the backend has stored no events
- **THEN** the empty state is shown

### Requirement: Overview
The dashboard SHALL show six overview values with a short explanation each: Sessions ("game page visits"), Total runs ("all level attempts"), Finished runs ("ended: complete, fail or quit"), Unfinished runs ("no end yet: playing or tab closed"), Completion rate ("complete ÷ finished runs"), and Runs per session ("attempts per visit"). The completion rate SHALL be visually marked as the key figure.

#### Scenario: Values from the overview
- **WHEN** the overview reports 1,284 sessions, 2,472 runs, 2,332 finished, 140 unfinished, a completion rate of 0.6068 and 1.9252 runs per session
- **THEN** the dashboard shows 1,284, 2,472, 2,332, 140, 60.7% and 1.93

### Requirement: Number formats
Counts SHALL use a thousands separator (1,284). Rates SHALL be percentages with one decimal (60.7%). Runs per session SHALL have two decimals. Durations SHALL be shown as mm:ss. A value the backend reports as `null` SHALL be shown as "—"; a rate of zero SHALL be shown as "0.0%", never as "—".

#### Scenario: Zero versus unknown
- **WHEN** one level has finished runs but none completed and another level has only unfinished runs
- **THEN** the first shows a completion rate of "0.0%" and the second shows "—"

### Requirement: Completion rate graph
The dashboard SHALL show the completion rate of every level returned by the backend as one bar per level on a 0–100% scale, labelled with the level and the rate. A level with a rate of zero SHALL show a minimal visible bar labelled "0.0%"; a level without finished runs SHALL show no bar and "—".

#### Scenario: Difficulty curve
- **WHEN** levels 1 to 3 have completion rates of 0.855, 0.635 and 0
- **THEN** the graph shows bars for 85.5%, 63.5% and a minimal bar labelled 0.0%

### Requirement: Failed runs by progress graph
The dashboard SHALL show, for every level, its failed runs as one stacked bar split into the five progress ranges (0–19%, 20–39%, 40–59%, 60–79%, 80–99%) in that order, with the level's total failed runs next to the bar and a legend for the ranges. All levels SHALL share one scale, so the level with the most failed runs fills the full width. A level without failed runs SHALL show an empty bar and the total 0. When no level has failed runs, every bar SHALL be empty with the total 0.

#### Scenario: Shared scale
- **WHEN** level 4 has 126 failed runs and level 1 has 52
- **THEN** level 4's bar spans the full width and level 1's bar about 41% of it, each split by progress range

#### Scenario: No failed runs at all
- **WHEN** every level has only complete, quit or unfinished runs
- **THEN** both failure graphs show an empty bar and the total 0 for every level

### Requirement: Failed runs by reason graph
The dashboard SHALL show, for every level, its failed runs as one stacked bar split by failure reason, on the same shared scale and with the same totals as the progress graph. The reasons SHALL be labelled Wall (`wall`), Self collision (`snake`), Obstacle (`obstacle`) and Ended by platform (`external`), in that order, with a legend.

#### Scenario: Reason labels
- **WHEN** a level's failed runs are 10 `wall`, 18 `snake`, 8 `obstacle` and 4 `external`
- **THEN** its bar shows segments for Wall 10, Self collision 18, Obstacle 8 and Ended by platform 4, and the total 40

### Requirement: Per-level table
The dashboard SHALL show a table with one row per level and the columns Level, Runs (all outcomes including unfinished), Complete, Fail, Quit, Unfinished, Completion, Avg duration, Most fails at and Top failure reason. Most fails at SHALL be the progress range with the most failed runs, the lower range on a tie. Top failure reason SHALL be the reason with the most failed runs and its count ("Wall · 31"), on a tie the first in the order Wall, Self collision, Obstacle, Ended by platform. Both SHALL be "—" for a level without failed runs. Completion and Avg duration SHALL be "—" when the backend reports `null`.

#### Scenario: Ties
- **WHEN** a level's failed runs are 5 in 20–39% and 5 in 40–59%, and 3 `wall` and 3 `obstacle`
- **THEN** Most fails at shows "20–39%" and Top failure reason shows "Wall · 3"

#### Scenario: Level with only unfinished runs
- **WHEN** a level has 9 unfinished runs and nothing else
- **THEN** its row shows Runs 9, Unfinished 9, zeros for the outcomes and "—" for Completion, Avg duration, Most fails at and Top failure reason

### Requirement: Readable without color
Every graph SHALL be understandable without telling colors apart: bars carry their values or totals as text, legends are always visible, and each bar SHALL expose its values to assistive technology and on hover. Interactive controls SHALL be real buttons reachable with the keyboard, with a visible focus outline; non-interactive elements such as table rows SHALL NOT be keyboard stops. On narrow screens the page SHALL NOT scroll sideways; only the table may scroll inside its card.

#### Scenario: Screen reader on a stacked bar
- **WHEN** a screen reader reaches level 4's bar in the reason graph
- **THEN** it reads the level, the total failed runs and the count per reason
