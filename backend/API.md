# Neon Snake Analytics API

The backend receives gameplay events from the game and serves statistics for the dashboard. It runs on `http://localhost:3000` (`PORT`), listens only on `127.0.0.1` so other devices on the network cannot reach it (`HOST`; a container sets `0.0.0.0`), and stores data only in the local Firestore emulator.

- [Event contract](#event-contract)
- [POST /api/events](#post-apievents)
- [GET /api/stats/overview](#get-apistatsoverview)
- [GET /api/stats/levels](#get-apistatslevels)
- [GET /api/stats/stream](#get-apistatsstream)
- [GET /api/health](#get-apihealth)
- [Errors](#errors)
- [Security headers](#security-headers)
- [Caching](#caching)
- [CORS](#cors)

## Event contract

Schema version `1`, defined in code in `packages/contract`. The game records one `run_started` and one `run_ended` event per run (one level attempt). A session is one game-page session: a reload or a new tab starts a new one.

### Common fields

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | number | `1` |
| `eventId` | string | unique per event; kept when the event is resent |
| `type` | string | `run_started` or `run_ended` |
| `sessionId` | string | one per page session |
| `runId` | string | one per level attempt |
| `level` | number | positive integer |
| `occurredAt` | string | ISO 8601 UTC time, e.g. `2026-10-01T12:00:00.000Z`; at most `MAX_FUTURE_SKEW_MS` (5 minutes) ahead of the server clock; no limit on past times |

IDs consist of 1 to 100 letters, digits, `-` or `_` (`^[A-Za-z0-9_-]{1,100}$`).

### `run_ended` fields

| Field | Type | Rule |
| --- | --- | --- |
| `outcome` | string | `complete`, `fail` or `quit` |
| `failureReason` | string or null | required for `fail`: `wall`, `snake`, `obstacle` or `external` (a game over requested by the platform); absent or `null` otherwise |
| `score` | number | non-negative integer: the run's on-screen score |
| `levelScore` | number | non-negative integer: points earned in this level |
| `progress` | number | integer 0-100, share of the level's fruit target; exactly `100` for `complete`, below `100` for `fail` and `quit` |
| `durationMs` | number | non-negative integer |

For `run_started`, `failureReason` must be absent or `null`. Fields outside the contract are dropped and not stored.

### Examples

```json
{
  "schemaVersion": 1,
  "eventId": "Jq8v2LxT0bM1kz3c",
  "type": "run_started",
  "sessionId": "p4Rk9sWm2nQe7tYb",
  "runId": "H3fZ8aKd1uVo6cXs",
  "level": 2,
  "occurredAt": "2026-10-01T12:00:00.000Z"
}
```

```json
{
  "schemaVersion": 1,
  "eventId": "a7Dn4Wq0Ry2Lp9Ve",
  "type": "run_ended",
  "sessionId": "p4Rk9sWm2nQe7tYb",
  "runId": "H3fZ8aKd1uVo6cXs",
  "level": 2,
  "occurredAt": "2026-10-01T12:00:14.250Z",
  "outcome": "fail",
  "failureReason": "obstacle",
  "score": 70,
  "levelScore": 20,
  "progress": 29,
  "durationMs": 14250
}
```

### Runs

The first stored event of a run fixes its session and level. A run has at most one `run_started` and one `run_ended`. A run without a `run_ended` is `unfinished`: still being played, or its page was closed. The order in which a run's two events arrive does not matter.

## POST /api/events

Stores a batch of 1 to 50 events.

- Body: a JSON array of events, at most 100 kB, sent as `application/json` or as `text/plain` (the form `navigator.sendBeacon` uses at page exit; the body is still JSON).
- Events are checked and saved one at a time, in array order.

### `202 Accepted`

```json
{
  "accepted": 1,
  "duplicates": 1,
  "rejected": [
    { "index": 2, "errors": ["level: must be a positive integer"] }
  ]
}
```

- `accepted`: events stored now.
- `duplicates`: events whose `eventId` was already stored (also a repeat within the same batch). They change nothing and are safe to resend.
- `rejected`: events that do not match the contract or conflict with their run, with their position in the array and the reasons. Each reason names the field it is about. Conflicts:
  - `sessionId: run r1 belongs to session s1`
  - `level: run r1 is on level 1`
  - `type: run r1 already has a run_ended event`

  A rejected event is not stored and should not be resent.

### With the Kafka queue

When the backend runs with `KAFKA_BROKERS` (`pnpm dev:kafka`), it checks each event, puts the valid ones on the `analytics-events` topic and answers `202` without storing them; `pnpm worker` stores them shortly after. Duplicates and run conflicts are then found by the worker, not in the answer:

- `accepted`: events queued now.
- `duplicates`: always `0`. A resent event is queued again and ignored by the worker, so resending stays safe.
- `rejected`: only events that do not match the contract. The worker logs and skips events that conflict with their run.

The worker stores up to 200 queued events per Firestore transaction, so stored data and statistics follow the queue in batches.
- `503`: the broker did not confirm within 3 s. Some events may be queued anyway; resending the batch is safe because the worker ignores duplicates.

### Other answers

| Status | When |
| --- | --- |
| `400` | the body is not valid JSON, not an array, empty, or holds more than 50 events; nothing is stored |
| `403` | the request has an `Origin` header that is not [allowed](#cors); nothing is stored. Requests without `Origin`, such as the seed script or curl, are not affected |
| `413` | the body is larger than 100 kB; nothing is stored |
| `429` | the client IP sent more than 60 posts at once or more than 1 per second on average; nothing is stored. `Retry-After` gives the seconds to wait. The game retries with growing delays anyway |
| `503` | the store did not answer within 3 s; processing stopped there. Events before that point may be stored, so resending the batch is safe |

## Rate limits

Each client IP has its own limits, kept in the API process:

| Requests | Burst | Then, per second |
| --- | --- | --- |
| `POST /api/events` | 60 | 1 |
| `GET /api/stats/overview` and `GET /api/stats/levels`, counted together | 30 | 2 |
| `GET /api/health` | 30 | 2 |

Beyond a limit the answer is `429` with `Retry-After`. Each API instance counts only the requests it receives, so with `API_INSTANCES=n` each instance enforces 1/n of these limits and all of them together keep the totals above. Behind a load balancer or other proxy, set `TRUST_PROXY` to the number of proxies in front of the API (e.g. `1`) or their addresses, so the limits count the client's IP from `X-Forwarded-For` rather than the proxy's. `TRUST_PROXY=true` is refused: it would let any client choose its own IP. These limits are a last line of defence; across many instances, the real limit belongs at the edge.

## GET /api/stats/overview

```json
{
  "sessions": 2,
  "runs": 5,
  "finished": 4,
  "unfinished": 1,
  "completionRate": 0.5,
  "runsPerSession": 2.5
}
```

- `finished`: runs with a `run_ended` (`complete`, `fail` or `quit`), also when their `run_started` is missing.
- `completionRate`: complete ÷ finished; `null` when no run has finished.
- `runsPerSession`: runs ÷ sessions; `null` without runs.

`503` when the store did not answer within 3 s.

## GET /api/stats/levels

Every level with at least one run, in ascending order. Levels without runs are left out.

```json
{
  "levels": [
    {
      "level": 2,
      "outcomes": { "complete": 1, "fail": 3, "quit": 0, "unfinished": 1 },
      "completionRate": 0.25,
      "averageDurationMs": 12500,
      "failedByProgress": { "0-19": 2, "20-39": 1, "40-59": 0, "60-79": 0, "80-99": 0 },
      "failedByReason": { "wall": 1, "snake": 0, "obstacle": 2, "external": 0 }
    }
  ]
}
```

- `completionRate`: complete ÷ (complete + fail + quit); `null` when the level has no finished runs.
- `averageDurationMs`: average duration of finished runs (unfinished runs excluded), rounded to whole milliseconds; `null` when the level has no finished runs.
- `failedByProgress`: failed runs per progress range. A run at 100 % has completed, so the last range ends at 99.
- `failedByReason`: failed runs per failure reason.
- All ranges and reasons are always present, with `0` where there are no runs.

`503` when the store did not answer within 3 s.

## GET /api/stats/stream

The statistics as [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html), for the dashboard's live view: `Content-Type: text/event-stream`.

```text
retry: 3000

id: 8kH2vQ1mXc0aZb9p
event: stats
data: {"overview":{"sessions":2,"runs":4,...},"levels":[{"level":1,...}]}

: keep-alive

event: unavailable
data: {"message":"Statistics are unavailable, retrying"}
```

- `stats`: the overview and the levels, in the shapes of the two routes above, from one read. Sent on connect and whenever they change, checked about once a second. The `id` identifies the data: a browser reconnecting with it in `Last-Event-ID` is not sent the same data again.
- `unavailable`: the store could not be read; the stream stays open and the next `stats` message follows when it can.
- A `: keep-alive` comment every 20 s; `retry: 3000` asks browsers to reconnect after 3 s.
- Opening a stream counts against the statistics' [rate limit](#rate-limits). `429` with more than 5 open streams from one client IP; `503` with `Retry-After` when the instance holds 1,000 streams.

## GET /api/health

- `200` with `{ "status": "ok" }` when the Firestore emulator answers within 3 s.
- `503` with the error format otherwise.
- `429` beyond its [rate limit](#rate-limits).

## Errors

Every error answer has this form; `details` is optional:

```json
{ "error": { "message": "Body must be a JSON array of 1 to 50 events" } }
```

Unexpected errors are logged on the server and answered with `500` and a generic message.

## Security headers

Every answer carries `helmet`'s security headers, among them `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: default-src 'none';frame-ancestors 'none'`. `Cross-Origin-Resource-Policy` is `cross-origin`: the [CORS](#cors) allowlist decides which pages may read responses.

## Caching

- `GET /api/stats/overview` and `GET /api/stats/levels`: `Cache-Control: no-cache` with an `ETag`. The browser may keep the answer but checks with the server on every request; unchanged statistics come back as `304 Not Modified` without a body. The server reads the counts at most once a second and answers from that read meanwhile. With `pnpm snapshot` running, that read is one precomputed document refreshed every second, so the statistics are at most about 2 s old; without it, the counter documents are added up on each read.
- Every other answer, errors included: `Cache-Control: no-store`.

## CORS

Only these origins may read responses (`ALLOWED_ORIGINS`, comma-separated):

- `http://localhost:5173` (game, dev server)
- `http://localhost:4173` (game, preview)
- `http://localhost:5174` (dashboard)

The backend answers the CORS preflight for `application/json` posts. CORS only controls which pages can read responses: a `text/plain` post, as `sendBeacon` sends, needs no preflight and reaches the server from any page. So `POST /api/events` also checks the `Origin` header and answers `403` for any other origin. This stops other web pages, not scripts, which can send any header.
