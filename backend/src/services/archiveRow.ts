import type { ReceivedEvent } from '../ports/EventStore';

/**
 * One archived event as a flat row, the same in every archive: every contract field, with the `run_ended`
 * ones null for `run_started`, plus when the event reached the backend. Matches infra/bigquery/raw_events.sql.
 */
export interface ArchiveRow {
  eventId: string;
  schemaVersion: number;
  type: string;
  sessionId: string;
  runId: string;
  level: number;
  occurredAt: string;
  receivedAt: string;
  outcome: string | null;
  failureReason: string | null;
  score: number | null;
  levelScore: number | null;
  progress: number | null;
  durationMs: number | null;
}

export function toArchiveRow({ event, receivedAt }: ReceivedEvent): ArchiveRow {
  const ended = event.type === 'run_ended' ? event : null;
  return {
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
    type: event.type,
    sessionId: event.sessionId,
    runId: event.runId,
    level: event.level,
    occurredAt: event.occurredAt,
    receivedAt: receivedAt.toISOString(),
    outcome: ended?.outcome ?? null,
    failureReason: ended?.failureReason ?? null,
    score: ended?.score ?? null,
    levelScore: ended?.levelScore ?? null,
    progress: ended?.progress ?? null,
    durationMs: ended?.durationMs ?? null
  };
}
