## Why

The next step is gameplay analytics recorded by the game and a Node.js backend that receives them, stores them in Firebase and prepares them for a dashboard. The Famobi SDK cannot provide this: its events and metrics go to Famobi and cannot be read back. The game therefore needs its own small event stream and a backend of our own, running locally on the Firebase Local Emulator Suite without a real Firebase project. Both sides share one event contract, so they are planned together; the dashboard follows as a separate change that only reads the backend's stats API.

## What Changes

- **Game analytics:** the game records two events, `run_started` and `run_ended`, with session ID, run ID, level, outcome (complete, fail, quit), failure reason (for a fail), score, level score, progress, duration and time. The `run_ended` fields mirror the metrics the game already sends with Famobi's `gameEnd`. They are built from the controller's existing run events by a new adapter, so game logic and the Famobi integration stay unchanged; the existing `runEnded` event gains the level score and failure reason the game already knows.
- **Sending:** each event is sent to the backend immediately and stays pending until the backend accepts it. Network errors, timeouts and server errors are retried; events the backend rejects are dropped. Pending events are sent in batches of at most 50, also when the page is hidden or closed. The game never waits for analytics. Without a configured backend URL (for example on GitHub Pages) analytics is off.
- **New `backend/` project** (independent, own `package.json`): a Node.js HTTP API that validates incoming events, stores them in Firestore, and serves ready-to-chart statistics.
  - `POST /api/events`: accepts a batch, stores valid events, reports rejected ones, ignores duplicates.
  - `GET /api/stats/overview`: sessions, runs, finished and unfinished runs, completion rate, runs per session.
  - `GET /api/stats/levels`: per level, outcomes, completion rate, average duration, how far failed runs got, and what failed them.
  - `GET /api/health`.
- **Firebase:** Firestore emulator only, with a `demo-` project ID, so no credentials exist and no real project can be reached. Emulator configuration, ports and startup scripts live in `backend/`.
- **Rules for the data:** each level attempt is a run with a unique run ID. A run records its session, level, start and end times, outcome, failure reason, score and progress. The first event of a run fixes its session and level. Duplicate events are handled idempotently; events that conflict with an established run are rejected. A run without an end event is "unfinished" (still being played, or the tab was closed). Completion rate is completed runs divided by finished runs (complete, fail, quit).
- **Docs:** the API contract in `backend/API.md`; the README explains installing and running the emulator, backend and game, testing the flow end to end, and the decisions and limitations of these parts.

## Capabilities

### New Capabilities
- `analytics/gameplay-tracking`: which gameplay events the game records, what they contain, and how they reach the backend without affecting gameplay.
- `analytics/event-ingestion`: the backend API that receives events, how they are checked, deduplicated, kept consistent per run and stored in the Firestore emulator.
- `analytics/gameplay-stats`: the statistics the backend prepares for the frontend, including the unfinished-run and completion-rate rules.

### Modified Capabilities
<!-- None: the Famobi SDK behavior in famobi-sdk/* does not change. -->

## Impact

- **New project:** `backend/` (Node.js, TypeScript, Express, Zod, firebase-admin, Vitest; firebase-tools as a dev dependency). Requires Java 21+ for the Firestore emulator.
- **Game:** new analytics adapter and sender in `game/src/platform/analytics/`, wiring in `game/src/main.ts`, `levelScore` and `failureReason` added to the `runEnded` event payload, and an optional `VITE_ANALYTICS_URL` setting. No change to gameplay, the SDK integration or the build output when the URL is unset.
- **Repository:** `.gitignore` for emulator data and local env files; README sections for the backend and the complete flow.
- **Out of scope:** the React dashboard (next change), authentication, deployment, a persistent player identity, detecting closed tabs as a separate outcome, sending the failure reason to Famobi as a `gameEnd` metric.
