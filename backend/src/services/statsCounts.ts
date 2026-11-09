import type { Run, RunStatus } from '../ports/EventStore';
import { FAILURE_REASONS, type FailureReason } from '@neon-snake/contract';
import { PROGRESS_RANGES, progressRange, type ProgressRange } from './stats';

/** Nested counters with a count at every leaf. Sparse: a missing count is 0. */
export type Counts = { [key: string]: number | Counts };

export type LevelCounts = {
  outcomes: Record<RunStatus, number>;
  /** Sum of the durations of the complete, fail and quit runs. */
  durationTotalMs: number;
  failedByProgress: Record<ProgressRange, number>;
  failedByReason: Record<FailureReason, number>;
};

/** Running totals the statistics are computed from, updated with every stored event. */
export type StatsCounts = {
  sessions: number;
  /** Keyed by level number; a level is present once it has a run. */
  levels: Record<string, LevelCounts>;
};

/** Adds `sign` × `delta` into `target`, creating the counts it is missing, and returns `target`. */
export function addCounts(target: Counts, delta: Counts, sign = 1): Counts {
  for (const [key, value] of Object.entries(delta)) {
    const current = target[key];
    target[key] =
      typeof value === 'number'
        ? (typeof current === 'number' ? current : 0) + sign * value
        : addCounts(typeof current === 'object' ? current : {}, value, sign);
  }
  return target;
}

/** `counts` without its zero counts and empty groups. */
export function withoutZeros(counts: Counts): Counts {
  const result: Counts = {};
  for (const [key, value] of Object.entries(counts)) {
    if (typeof value === 'number') {
      if (value !== 0) result[key] = value;
    } else {
      const nested = withoutZeros(value);
      if (Object.keys(nested).length > 0) result[key] = nested;
    }
  }
  return result;
}

/** What one run adds to the counts. */
function runCounts(run: Run): Counts {
  const level: Counts = { outcomes: { [run.status]: 1 } };
  if (run.status !== 'unfinished' && run.durationMs !== null) level.durationTotalMs = run.durationMs;
  if (run.status === 'fail') {
    if (run.progress !== null) level.failedByProgress = { [progressRange(run.progress)]: 1 };
    if (run.failureReason !== null) level.failedByReason = { [run.failureReason]: 1 };
  }
  return { levels: { [run.level]: level } };
}

/**
 * How the counts change when an event turns `before` (none for a new run) into `after`.
 * `newSession` is true when the run is the first of its session. Unchanged counts are left out.
 */
export function countChange(before: Run | undefined, after: Run, newSession: boolean): Counts {
  const change = addCounts({}, runCounts(after));
  if (before) addCounts(change, runCounts(before), -1);
  if (newSession) change.sessions = 1;
  return withoutZeros(change);
}

/** Fills in every count that sparse counts leave out. */
export function toStatsCounts(counts: Counts): StatsCounts {
  const zeros = (keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, 0]));
  const levels = typeof counts.levels === 'object' ? counts.levels : {};
  return {
    sessions: typeof counts.sessions === 'number' ? counts.sessions : 0,
    levels: Object.fromEntries(
      Object.entries(levels).map(([level, sparse]) => {
        const empty: Counts = {
          outcomes: zeros(['complete', 'fail', 'quit', 'unfinished']),
          durationTotalMs: 0,
          failedByProgress: zeros(PROGRESS_RANGES),
          failedByReason: zeros(FAILURE_REASONS)
        };
        return [level, addCounts(empty, typeof sparse === 'object' ? sparse : {}) as LevelCounts];
      })
    )
  };
}

/** Counts the given runs from scratch, e.g. to rebuild the counters of runs stored before them. */
export function countRuns(runs: readonly Run[]): StatsCounts {
  const counts: Counts = { sessions: new Set(runs.map((run) => run.sessionId)).size };
  for (const run of runs) addCounts(counts, runCounts(run));
  return toStatsCounts(counts);
}
