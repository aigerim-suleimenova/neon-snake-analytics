## Context

See proposal.md for the motivation and specs/analytics/ for the required behavior.

- The repository holds independent projects (`game/` today); they share no code and talk only over HTTP.
- The game's `GameController` already emits `runStarted` (level, run number, time) and `runEnded` (level, score, progress 0-1, reason, duration, time) on an `EventBus`. The end summary it builds also has the level score, and the snapshot has the failure reason (`wall`, `snake`, `obstacle`, `external`), but the `runEnded` payload carries neither yet.
- The game already sends `level`, `score`, `levelScore`, `durationMs` and `progress` as `gameEnd` metrics to Famobi (Analytics-01); the analytics contract mirrors these fields.
- The Firebase CLI (15.x) runs the Firestore emulator only on Java 21+. Java 21 is installed side by side with Homebrew (`/opt/homebrew/opt/openjdk@21`); the system default stays Java 20.
- New code follows SOLID with small injected interfaces and adapters at the edges.

## Goals / Non-Goals

**Goals:**
- One documented event contract, implemented independently in the game and the backend.
- A backend whose HTTP, logic and storage layers can each be tested without the others; Firestore is only one implementation of the storage interface.
- Statistics that the dashboard uses one to one: an overview and per-level results.
- Runnable with documented commands; no credentials anywhere.

**Non-Goals:**
- The dashboard, authentication, rate limiting, deployment.
- Precomputed aggregates; statistics are computed when requested.
- Detecting closed tabs as their own outcome; runs without an end are "unfinished".
- Any change to gameplay or to the Famobi integration (the failure reason is not added to Famobi's `gameEnd` metrics).

## Decisions

### 1. Event contract (schema version 1)
```
common:     schemaVersion: 1, eventId, type, sessionId, runId, level, occurredAt (ISO 8601 UTC)
            IDs: ^[A-Za-z0-9_-]{1,100}$ (safe as Firestore document IDs)
            level: positive integer
run_ended:  + outcome: complete|fail|quit, failureReason (required for fail: wall|snake|obstacle|external;
              absent or null otherwise),
              score, levelScore, durationMs: non-negative integers
              progress: integer 0-100; 100 for complete, below 100 for fail and quit
session:    one game-page session; many runs per session; a reload or new tab starts a new session
rules:      occurredAt at most MAX_FUTURE_SKEW_MS (5 min) ahead of the server clock; no limit on past times
```
Written down once in `backend/API.md`, with request and response examples. The game has its own TypeScript type for it; the backend's Zod schema is the enforced version. `schemaVersion` lets the backend accept future game versions side by side.

*Alternative:* a shared package with the types. Rejected: the projects stay decoupled by choice.

### 2. Backend layering
```
server.ts (composition root: config, Firestore, services, app, listen)
  └─ http/      createApp(deps): routes, CORS, body parsing, error mapping    ← only HTTP
       └─ services/  IngestionService, StatsService                          ← rules, no HTTP, no Firestore
            └─ ports/     EventStore interface, Clock                         ← what services need
                 └─ adapters/  FirestoreEventStore, InMemoryEventStore       ← storage details
```
- `EventStore`: `saveEvent(event, receivedAt) → 'stored' | 'duplicate' | { conflict: reason }`, `listRuns() → Run[]`, `ping() → boolean`.
- `Clock`: `now() → Date`, injected so the future-time check and `receivedAt` are testable.
- Validation (Zod) sits in `services/contract.ts`; statistics are pure functions over `Run[]` in `services/stats.ts`, so most logic is tested with plain arrays.
- `createApp(deps)` receives services, so route tests use the in-memory store and no emulator.
- Store calls are wrapped in a deadline of 3 s, below the game's 5 s request timeout, so the game sees the `503`; a missed deadline becomes a `StoreUnavailable` error, which HTTP maps to `503`.
- `IngestionService` saves a batch's events one at a time, in array order, and stops at the first `StoreUnavailable`, so a request never waits longer than one deadline per stored event and a hanging store fails fast. In-order saving also keeps a start and its end in the same batch from competing transactions, and a repeated event ID within one batch counts as a duplicate.

*Alternative:* call Firestore from the route handlers. Rejected: mixes three responsibilities and needs the emulator for every test.

### 3. Firestore data structure
```
events/{eventId}   the validated event + receivedAt (server time)            source of truth
runs/{runId}       sessionId, level, status, startedAt?, endedAt?,            one doc per attempt
                   failureReason?, score?, levelScore?, progress?, durationMs?,
                   startEventId?, endEventId?, updatedAt
```
Each event is saved in one transaction:
1. Read `events/{eventId}`; if it exists → `duplicate`, nothing changes.
2. Read `runs/{runId}`. If it exists and its `sessionId` or `level` differs from the event's, or it already has an event of this type (`startEventId` / `endEventId` set) → `conflict` with a reason, nothing changes.
3. Create `events/{eventId}` and merge into `runs/{runId}`: `run_started` writes `sessionId`, `level`, `startedAt`, `startEventId` and sets `status: unfinished` only when the run has no status yet; `run_ended` writes `sessionId`, `level`, the outcome fields, `endEventId` and `status`.

Order of arrival therefore does not matter, and the first event of a run fixes its session and level. Duplicates are reported separately from conflicts, so a resent event is never counted as rejected. The game never produces conflicts; they can only come from a buggy or foreign client.

*Alternative:* only events, runs derived at read time. Rejected: every statistic would re-pair events; the run documents are also easy to inspect in the emulator UI.

*Alternative:* the last event wins on conflict. Rejected: a run would silently change level or outcome, and the stats could no longer be trusted.

### 4. Statistics computed on read
`StatsService` reads all runs once per request and applies pure functions: `overview(runs)` and `levels(runs)`. A run's status is stored, not derived (`unfinished` until its end arrives), so the statistics need no clock.
- Completion rate = complete ÷ (complete + fail + quit); `null` without finished runs.
- `levels` covers every level with at least one run (finished or unfinished); levels without runs are left out. Per level it adds the average duration of finished runs (complete, fail and quit; unfinished excluded; `null` when none), failed runs per progress range (`min(4, floor(progress / 20))` → 0-19 … 80-99; a run at 100 % has completed), and failed runs per failure reason. All ranges and reasons are always present.

These map directly to the planned dashboard: the overview, a stacked bar of outcomes per level, and the progress and failure-reason breakdowns of failed runs.

*Alternative:* an abandoned status after 30 minutes or a later run in the session, a funnel and activity over time. Rejected: leaving a level is already covered by `quit`; the funnel is unreliable because unlocks persist across visits; activity over time shows little with local test data. Closed-tab detection is listed as an improvement.

*Alternative:* counters updated on write. Rejected for now: more code and consistency issues; listed as an improvement for large data.

### 5. HTTP details
- Express 5; `express.json` and `express.text` (for `text/plain` page-unload requests), both limited to 100 kB.
- `POST /api/events` → `202 { accepted, duplicates, rejected: [{ index, errors }] }` (conflicts appear in `rejected`); `400` for a non-array, empty or > 50 events; `413` for oversize bodies; `503` when the store misses its deadline.
- `GET /api/stats/overview`, `GET /api/stats/levels`; `503` when the store misses its deadline.
- `GET /api/health` → `200` / `503` (ping within the deadline).
- CORS allowlist from `ALLOWED_ORIGINS`, default `http://localhost:5173,http://localhost:4173,http://localhost:5174` (game dev, game preview, dashboard). It controls which pages may read responses; it does not stop posting.
- Errors are returned as `{ error: { message, details? } }`; unexpected errors are logged on the server and answered with `500` without internals.
- Port 3000 (`PORT`).

### 6. Emulator and configuration
- `backend/firebase.json`: Firestore on 8080, emulator UI on 4000, `singleProjectMode`; `backend/.firebaserc`: `demo-neon-snake`; `firestore.rules` denying all client access (only the backend, through the Admin SDK, writes).
- Scripts: `pnpm emulators` (starts Firestore and exports data on exit to `emulator-data/`, importing it only when it exists, so a fresh clone starts too; `emulator-data/` is git-ignored), `pnpm dev` (API with file watching), `pnpm test`, `pnpm test:emulator` (`firebase emulators:exec` around the Firestore adapter tests).
- The scripts set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and the project ID; `server.ts` refuses to start without an emulator host or with a project ID not starting with `demo-`.
- Java 21: the README shows how to put it on `PATH` for the emulator terminal (e.g. Homebrew's `openjdk@21`); no machine-specific path is committed.

*Alternative:* a root `package.json` that starts everything at once. Rejected: it would tie the independent projects together; the README lists three terminals instead.

### 7. Game side
```
main.ts ─ connectAnalytics(controller.events, sender, ids) ─ EventSender
                                                                      ├─ HttpEventSender
                                                                      └─ NoopEventSender (no URL configured)
```
- `game/src/platform/analytics/`: `AnalyticsEvent` type, `connectAnalytics` turns `runStarted`/`runEnded` into contract events (a new run ID per start; each event's ID, created once when the event is built; the ended run reuses its run ID, session ID and level; progress → 0-100; failure reason only for `fail`; `occurredAt` taken from the controller event, so no clock is needed), `HttpEventSender`, `NoopEventSender`.
- `HttpEventSender`:
  - Each event gets its event ID once, when `connectAnalytics` builds it; the sender never creates or changes IDs. Retries and beacons resend the same ID, so the backend can count repeats as duplicates.
  - Events wait in a pending list (max 100) until they are answered. A pending event is either *idle* or *in flight*. Only idle events are put in a `fetch`, so no event is in two requests at once.
  - When the list is full, the oldest event is dropped, even if it is in flight. A later answer for a dropped event is ignored.
  - Sending: if no backoff is running, a new event is posted at once with `fetch` (JSON, `AbortSignal.timeout(5 s)`). During backoff, new events stay idle and go out with the next retry.
  - Answers:
    - `2xx` → the submitted events are resolved permanently: they leave the pending list and are never resent, and the backoff resets to 1 s. The body is not read: events a `202` lists in `rejected` belong to the resolved batch, so they are dropped too and never retried.
    - Network error, timeout, `408`, `429` or `5xx` → the events become idle again and are retried with backoff: the base delay is 1 s doubling to 30 s; the actual delay is `min(30 s, base × random(0.8, 1.2))`, so jitter never pushes it above 30 s (at the cap it is 24-30 s); at most 50 events per batch. `Retry-After` is not read: the backend has no rate limiting, and the header would need `Access-Control-Expose-Headers` to be readable cross-origin.
    - Any other `4xx` → the events are dropped.
  - On `visibilitychange` (hidden) and `pagehide`, all pending events, idle and in flight, go out with `navigator.sendBeacon` as `text/plain` in batches of 50. A JSON content type would need a CORS preflight, which a beacon cannot do.
    - Batches the browser accepts leave the pending list. A later `fetch` answer for those events is ignored and never puts them back.
    - If both the beacon and the earlier request arrive, the backend counts one as a duplicate.
    - `sendBeacon` returning `true` only means the browser queued the batch, so these events can be lost. We accept that at page exit.
  - The backend parses `text/plain` bodies as JSON and answers the CORS preflight for the `fetch` path's `application/json`.
  - `dispose()` removes the page listeners and clears the timers. The game never calls it on page exit: `beforeunload` fires before `pagehide`, so disposing there would remove the beacon listener before it runs. It exists for tests and teardown.
  - `fetch`, `sendBeacon`, timers, page events and the random source for jitter are injected for tests; the ID generator is injected into `connectAnalytics`.
- The URL comes from `VITE_ANALYTICS_URL` at build time (Vite replaces it in the IIFE build too); unset → `NoopEventSender`. `game/.env.example` documents it.
- `runEnded` gains `levelScore` (from the summary the controller already builds) and `failureReason` (from the snapshot; `null` unless the outcome is `fail`); no game rule changes.

*Alternative:* batching on the client. Rejected by choice: immediate sending is simpler and the dashboard is fresher; traffic is tiny.

### 8. Tests
- Backend unit (Vitest): contract validation (ID pattern, failure reason rules, progress against outcome, the future-time limit), ingestion with the in-memory store (duplicates, conflicts on level, session and a second end, out-of-order runs), stats functions (unfinished runs, completion rate, progress ranges, failure reasons, runs with only an end, empty data), routes with Supertest (including `503` from a store that misses its deadline, and a batch stopping at the first missed deadline).
- Backend emulator: the Firestore adapter (transaction, duplicate, conflict, merge order) against the real emulator.
- Game: `connectAnalytics` and `HttpEventSender` with fakes (same event ID on every resend, no event in two requests at once, timeout, retry on network error, `408`, `429` and `5xx` with jitter, no new request during backoff, backoff reset on `2xx`, drop on other `4xx` and rejected entries, pending limit including an in-flight event, batches of 50, beacon on hidden and page hide including in-flight events, late answers after a beacon or a drop ignored, `dispose()`); a controller test for the new `runEnded` fields; existing tests stay green.
- End to end: emulator + backend + game; play levels headless and check documents and stats.

## Risks / Trade-offs

- [Reading all runs per stats request grows with data] → Fine at local scale; counters or scheduled aggregation listed as an improvement.
- [Client clocks can be wrong] → `occurredAt` from the client, `receivedAt` from the server, future times rejected.
- [Runs whose page was closed stay `unfinished` forever, mixed with runs still in play] → Accepted: they are left out of completion rates and shown as their own count; closed-tab detection is listed as an improvement.
- [`sendBeacon` is best effort and limited to about 64 kB per request] → Batches of 50 small events stay far below it; a lost end leaves the run unfinished.
- [Duplicated contract between game and backend can drift] → One written contract (`API.md`), backend validation with clear rejection reasons, and a backend test that feeds exactly the events the game produces.
- [Java 21 is an extra requirement for anyone running it locally] → Stated in the README with install hints; the emulator refuses older Java with a clear message.
- [No authentication: any page can post events, since a `text/plain` POST needs no CORS preflight; CORS only hides responses] → Acceptable while the backend runs only locally; listed as a limitation.
