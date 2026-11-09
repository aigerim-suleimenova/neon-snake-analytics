## Why

The last part is a React frontend that consumes the backend and presents useful gameplay insights: a short overview and a few meaningful graphs, where clarity, usability and the reasoning behind each choice matter more than visual polish. The backend from `add-gameplay-analytics-backend` already serves ready-to-chart statistics, so the dashboard only has to read and present them.

## What Changes

- **New `dashboard/` project** (independent, own `package.json`): a React single-page app that reads `GET /api/stats/overview` and `GET /api/stats/levels` and shares no code with the game or the backend. It runs locally on port 5174, which the backend already allows (CORS). The backend address is configurable.
- **One page**, following the design reference `Neon Snake Analytics.dc.html` (made in Claude Design):
  - Header with the time of the last update and a **Refresh** button.
  - **Overview:** sessions, runs, finished runs, unfinished runs, completion rate (the key figure) and runs per session, each with a one-line meaning.
  - **Three graphs**, each answering one question:
    - completion rate by level: how hard is each level?
    - failed runs by progress: where in a level do players fail?
    - failed runs by reason: why do they fail?
  - **Per-level table:** runs, outcomes (incl. unfinished), completion rate, average duration, the progress range with the most fails and the top failure reason.
- **States:** first load, refreshing (data stays visible), no gameplay yet, and backend unreachable with **Retry**.
- **Data loading:** on page open and on Refresh or Retry only, with no polling.
- **Design fixes** compared to the reference: Obstacle gets its own hue (blue instead of an orange close to Wall's amber), the progress shades no longer reuse the "complete" green, and table rows are not keyboard stops.
- **Docs:** the README explains how to run the dashboard, the chart choices and their reasoning, the decisions (plain CSS bars instead of a chart library, refresh instead of polling), and limitations.

## Capabilities

### New Capabilities
- `analytics/dashboard`: what the dashboard shows from the stats API, how values are labelled and formatted, and how it behaves while loading, refreshing, without data and when the backend is unreachable.

### Modified Capabilities
<!-- None: the backend's API and statistics stay as they are. -->

## Impact

- **New project:** `dashboard/` (React, Vite, TypeScript, Zod for response checks, Vitest with Testing Library). No chart library.
- **Backend:** no change; the dashboard uses the documented stats API, and the CORS allowlist already includes `http://localhost:5174`.
- **Game:** no change.
- **Repository:** README sections for the dashboard and the complete flow (emulator, backend, game, dashboard).
- **Out of scope:** automatic refresh, filters or date ranges, activity over time, player-level data, authentication, deployment, a light theme.
