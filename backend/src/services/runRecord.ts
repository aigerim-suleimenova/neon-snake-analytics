import type { Run } from '../ports/EventStore';
import type { AnalyticsEvent } from '@neon-snake/contract';

/**
 * An event is a duplicate when its run already holds its ID, as start or end event: the game resends
 * with the same ID, and a queue may deliver twice. Event IDs are random per event, so the run is the only
 * place one can already be.
 */
export function isDuplicate(run: Run | undefined, event: AnalyticsEvent): boolean {
  return run !== undefined && (run.startEventId === event.eventId || run.endEventId === event.eventId);
}

/**
 * Run identity rules shared by every EventStore: the first event fixes the run's session and level,
 * and a run has at most one event of each type. Returns the conflict, or `null` when the event fits.
 */
export function findConflict(run: Run | undefined, event: AnalyticsEvent): string | null {
  if (!run) return null;
  if (run.sessionId !== event.sessionId) return `sessionId: run ${run.runId} belongs to session ${run.sessionId}`;
  if (run.level !== event.level) return `level: run ${run.runId} is on level ${run.level}`;
  const existing = event.type === 'run_started' ? run.startEventId : run.endEventId;
  if (existing !== null) return `type: run ${run.runId} already has a ${event.type} event`;
  return null;
}

/** Merges an event that passed `findConflict` into its run. The result is the same in either arrival order. */
export function applyEvent(run: Run | undefined, event: AnalyticsEvent): Run {
  const current: Run = run ?? {
    runId: event.runId,
    sessionId: event.sessionId,
    level: event.level,
    status: 'unfinished',
    startedAt: null,
    endedAt: null,
    failureReason: null,
    score: null,
    levelScore: null,
    progress: null,
    durationMs: null,
    startEventId: null,
    endEventId: null
  };

  if (event.type === 'run_started') {
    return { ...current, startedAt: event.occurredAt, startEventId: event.eventId };
  }
  return {
    ...current,
    status: event.outcome,
    endedAt: event.occurredAt,
    failureReason: event.failureReason,
    score: event.score,
    levelScore: event.levelScore,
    progress: event.progress,
    durationMs: event.durationMs,
    endEventId: event.eventId
  };
}
