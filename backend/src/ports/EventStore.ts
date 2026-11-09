import type { AnalyticsEvent, FailureReason, RunStatus } from '@neon-snake/contract';
import type { StatsCounts } from '../services/statsCounts';

export type { RunStatus };

/** One level attempt, summarised from its run_started and run_ended events. */
export interface Run {
  runId: string;
  sessionId: string;
  level: number;
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: FailureReason | null;
  score: number | null;
  levelScore: number | null;
  progress: number | null;
  durationMs: number | null;
  startEventId: string | null;
  endEventId: string | null;
}

/** A conflict names the field and the run, e.g. `level: run r1 is on level 1`. */
export type SaveResult = 'stored' | 'duplicate' | { conflict: string };

/**
 * Most events `saveEvents` takes at once. Each writes at most its run and its session, plus one counter
 * write per batch: about 400 writes, within what one Firestore transaction allows, and small enough that a
 * transaction rarely has to retry.
 */
export const MAX_EVENTS_PER_BATCH = 200;

/** An event and when it reached the backend. */
export interface ReceivedEvent {
  event: AnalyticsEvent;
  receivedAt: Date;
}

export interface EventStore {
  /**
   * Stores the event, merges it into its run and updates the statistics counts, atomically.
   * Changes nothing for a duplicate or conflict.
   */
  saveEvent(event: AnalyticsEvent, receivedAt: Date): Promise<SaveResult>;
  /**
   * Saves a batch of events in order and atomically: all of it or none. The results equal saving them one
   * at a time. The batch's combined change to the statistics counts goes to the counter document
   * `counterShard`, so a single writer per shard (e.g. one per queue partition) never contends on it.
   * At most `MAX_EVENTS_PER_BATCH` events.
   */
  saveEvents(events: readonly ReceivedEvent[], counterShard: string): Promise<SaveResult[]>;
  /** The running counts over all runs; reads a few documents, however many runs are stored. */
  readStats(): Promise<StatsCounts>;
  /** Resolves `true` when the store is reachable. */
  ping(): Promise<boolean>;
}
