import type { AnalyticsEvent } from '@neon-snake/contract';
import type { ReceivedEvent, Run, SaveResult } from '../ports/EventStore';
import { applyEvent, findConflict, isDuplicate } from './runRecord';
import { addCounts, countChange, withoutZeros, type Counts } from './statsCounts';

/** A run the batch changed: its final state and when each of its events in the batch arrived. */
export interface ChangedRun {
  run: Run;
  receivedAt: Partial<Record<AnalyticsEvent['type'], Date>>;
}

/** Everything a store must write for a batch, so it can write each document once. */
export interface BatchOutcome {
  /** One result per event, in order. */
  results: SaveResult[];
  /** Keyed by run ID. */
  changedRuns: Map<string, ChangedRun>;
  /** Sessions first seen in this batch, with when their first event arrived. */
  newSessions: Map<string, Date>;
  /** The combined change to the statistics counts; empty when nothing was stored. */
  countChange: Counts;
}

/**
 * Applies a batch of events, in order, to the runs and sessions already stored, without writing anything.
 * Each event sees the ones before it, so the results are exactly those of saving the events one at a time:
 * a start and its end in one batch form one run, an event repeated in the batch is a duplicate, and a
 * session is counted once however many of its runs the batch starts.
 *
 * `storedRuns` must hold every stored run the batch's events belong to; `storedSessions` every stored
 * session among those of runs not in `storedRuns`.
 */
export function applyBatch(
  events: readonly ReceivedEvent[],
  storedRuns: ReadonlyMap<string, Run>,
  storedSessions: ReadonlySet<string>
): BatchOutcome {
  const runs = new Map(storedRuns);
  const outcome: BatchOutcome = { results: [], changedRuns: new Map(), newSessions: new Map(), countChange: {} };

  for (const { event, receivedAt } of events) {
    const run = runs.get(event.runId);
    if (isDuplicate(run, event)) {
      outcome.results.push('duplicate');
      continue;
    }
    const conflict = findConflict(run, event);
    if (conflict) {
      outcome.results.push({ conflict });
      continue;
    }

    // A known run's session is already counted; only a new run can bring a new session.
    const newSession = !run && !storedSessions.has(event.sessionId) && !outcome.newSessions.has(event.sessionId);
    const updated = applyEvent(run, event);
    runs.set(event.runId, updated);

    const changed = outcome.changedRuns.get(event.runId) ?? { run: updated, receivedAt: {} };
    changed.run = updated;
    changed.receivedAt[event.type] = receivedAt;
    outcome.changedRuns.set(event.runId, changed);
    if (newSession) outcome.newSessions.set(event.sessionId, receivedAt);
    addCounts(outcome.countChange, countChange(run, updated, newSession));
    outcome.results.push('stored');
  }

  outcome.countChange = withoutZeros(outcome.countChange);
  return outcome;
}

/** The run IDs the batch's events belong to, each once. */
export const runIdsOf = (events: readonly ReceivedEvent[]): string[] => [...new Set(events.map(({ event }) => event.runId))];

/** The sessions that may be new: those of events whose run is not stored yet. */
export const candidateSessionsOf = (events: readonly ReceivedEvent[], storedRuns: ReadonlyMap<string, Run>): string[] => [
  ...new Set(events.filter(({ event }) => !storedRuns.has(event.runId)).map(({ event }) => event.sessionId))
];
