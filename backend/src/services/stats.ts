import { PROGRESS_RANGES, type LevelStats, type Overview, type ProgressRange, type RunStatus } from '@neon-snake/contract';
import type { LevelCounts, StatsCounts } from './statsCounts';

export { PROGRESS_RANGES, type LevelStats, type Overview, type ProgressRange };

const FINISHED: readonly RunStatus[] = ['complete', 'fail', 'quit'];

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const finishedOf = (outcomes: Record<RunStatus, number>) => sum(FINISHED.map((status) => outcomes[status]));
const runsOf = (outcomes: Record<RunStatus, number>) => finishedOf(outcomes) + outcomes.unfinished;

function completionRate(outcomes: Record<RunStatus, number>): number | null {
  const finished = finishedOf(outcomes);
  return finished === 0 ? null : outcomes.complete / finished;
}

export function progressRange(progress: number): ProgressRange {
  return PROGRESS_RANGES[Math.min(PROGRESS_RANGES.length - 1, Math.floor(progress / 20))];
}

export function overview(counts: StatsCounts): Overview {
  const outcomes: Record<RunStatus, number> = { complete: 0, fail: 0, quit: 0, unfinished: 0 };
  for (const level of Object.values(counts.levels)) {
    for (const status of Object.keys(outcomes) as RunStatus[]) outcomes[status] += level.outcomes[status];
  }
  const runs = runsOf(outcomes);
  return {
    sessions: counts.sessions,
    runs,
    finished: finishedOf(outcomes),
    unfinished: outcomes.unfinished,
    completionRate: completionRate(outcomes),
    runsPerSession: counts.sessions === 0 ? null : runs / counts.sessions
  };
}

function levelStats(level: number, counts: LevelCounts): LevelStats {
  const finished = finishedOf(counts.outcomes);
  return {
    level,
    outcomes: { ...counts.outcomes },
    completionRate: completionRate(counts.outcomes),
    averageDurationMs: finished === 0 ? null : Math.round(counts.durationTotalMs / finished),
    failedByProgress: { ...counts.failedByProgress },
    failedByReason: { ...counts.failedByReason }
  };
}

/** One entry per level with at least one run, in ascending level order. */
export function levels(counts: StatsCounts): LevelStats[] {
  return Object.entries(counts.levels)
    .filter(([, levelCounts]) => runsOf(levelCounts.outcomes) > 0)
    .map(([level, levelCounts]) => levelStats(Number(level), levelCounts))
    .sort((a, b) => a.level - b.level);
}
