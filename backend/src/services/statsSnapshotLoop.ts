import type { EventStore } from '../ports/EventStore';
import type { StatsSnapshots } from '../ports/StatsSnapshots';

/** How often the snapshot is rewritten: as often as the API's statistics cache expires. */
export const SNAPSHOT_INTERVAL_MS = 1000;

export interface SnapshotLoopDeps {
  store: Pick<EventStore, 'readStats'>;
  snapshots: Pick<StatsSnapshots, 'write'>;
  isRunning: () => boolean;
  sleep: (ms: number) => Promise<void>;
  /** Milliseconds since some fixed point. */
  now: () => number;
  logError: (error: unknown) => void;
  intervalMs?: number;
}

/**
 * Adds up the counter documents and writes the total as the snapshot, once per interval, until stopped. A
 * failed round is logged and the next one tries again: the API falls back to the counters meanwhile. Rounds
 * start an interval apart, however long each takes, and never overlap.
 */
export async function runSnapshotLoop({
  store,
  snapshots,
  isRunning,
  sleep,
  now,
  logError,
  intervalMs = SNAPSHOT_INTERVAL_MS
}: SnapshotLoopDeps): Promise<void> {
  while (isRunning()) {
    const started = now();
    try {
      await snapshots.write(await store.readStats());
    } catch (error) {
      logError(error);
    }
    if (isRunning()) await sleep(Math.max(0, intervalMs - (now() - started)));
  }
}
