import type { StatsCounts } from '../services/statsCounts';

/** The statistics counts added up once, and when. */
export interface StatsSnapshot {
  counts: StatsCounts;
  computedAt: Date;
}

/**
 * One precomputed total of the statistics counts, so a statistics read costs one document however many
 * counter documents there are. Written by a single background process; read by every API instance.
 */
export interface StatsSnapshots {
  /** The latest snapshot, or null when none was written yet. */
  read(): Promise<StatsSnapshot | null>;
  /** Replaces the snapshot; its `computedAt` is the store's time of the write. */
  write(counts: StatsCounts): Promise<void>;
}
