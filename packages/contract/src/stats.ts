import type { FailureReason, Outcome } from './events';

/** A run's state: unfinished until its run_ended event arrives. */
export type RunStatus = 'unfinished' | Outcome;

export const PROGRESS_RANGES = ['0-19', '20-39', '40-59', '60-79', '80-99'] as const;
export type ProgressRange = (typeof PROGRESS_RANGES)[number];

/** `GET /api/stats/overview`. */
export interface Overview {
  sessions: number;
  runs: number;
  finished: number;
  unfinished: number;
  /** complete ÷ finished; `null` when no run has finished. */
  completionRate: number | null;
  /** runs ÷ sessions; `null` without runs. */
  runsPerSession: number | null;
}

/** One entry of `GET /api/stats/levels`. */
export interface LevelStats {
  level: number;
  outcomes: Record<RunStatus, number>;
  /** complete ÷ (complete + fail + quit); `null` when the level has no finished runs. */
  completionRate: number | null;
  /** Average duration of complete, fail and quit runs, rounded to whole ms; `null` when none. */
  averageDurationMs: number | null;
  failedByProgress: Record<ProgressRange, number>;
  failedByReason: Record<FailureReason, number>;
}

/** `GET /api/stats/levels`. */
export interface LevelsResponse {
  levels: LevelStats[];
}

/**
 * One `stats` message of `GET /api/stats/stream` (Server-Sent Events): both statistics from the same read, so
 * the overview and the levels always agree. Sent on connect and whenever they change.
 */
export interface LiveStats {
  overview: Overview;
  levels: LevelStats[];
}
