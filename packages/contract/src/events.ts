/** Event contract, schema version 1. The written version lives in backend/API.md. */
export const SCHEMA_VERSION = 1;

/** How far ahead of the server clock an event's time may be. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Most events one request may carry. */
export const MAX_BATCH_EVENTS = 50;

/** Safe as a Firestore document ID. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export const OUTCOMES = ['complete', 'fail', 'quit'] as const;
export const FAILURE_REASONS = ['wall', 'snake', 'obstacle', 'external'] as const;

export type Outcome = (typeof OUTCOMES)[number];
export type FailureReason = (typeof FAILURE_REASONS)[number];

interface EventBase {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  sessionId: string;
  runId: string;
  level: number;
  /** ISO 8601, UTC. */
  occurredAt: string;
}

export interface RunStartedEvent extends EventBase {
  type: 'run_started';
}

export interface RunEndedEvent extends EventBase {
  type: 'run_ended';
  outcome: Outcome;
  /** Set only when the outcome is `fail`. */
  failureReason: FailureReason | null;
  score: number;
  levelScore: number;
  /** Integer percentage of the level's fruit target: 100 for complete, below 100 otherwise. */
  progress: number;
  durationMs: number;
}

export type AnalyticsEvent = RunStartedEvent | RunEndedEvent;
