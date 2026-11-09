import type { LevelStats, Overview } from '@neon-snake/contract';

// The sample data of the design reference (Neon Snake Analytics.dc.html), in the backend's response
// shape. Used as test fixtures and to compare the app with the design.

type Counts = [complete: number, fail: number, quit: number, unfinished: number];
type Five = [number, number, number, number, number];
type Four = [wall: number, snake: number, obstacle: number, external: number];

const level = (n: number, [complete, fail, quit, unfinished]: Counts, durationMs: number, progress: Five, reasons: Four): LevelStats => {
  const finished = complete + fail + quit;
  return {
    level: n,
    outcomes: { complete, fail, quit, unfinished },
    completionRate: finished ? complete / finished : null,
    averageDurationMs: finished ? durationMs : null,
    failedByProgress: { '0-19': progress[0], '20-39': progress[1], '40-59': progress[2], '60-79': progress[3], '80-99': progress[4] },
    failedByReason: { wall: reasons[0], snake: reasons[1], obstacle: reasons[2], external: reasons[3] }
  };
};

export const sampleLevels: LevelStats[] = [
  level(1, [438, 52, 22, 18], 42_000, [20, 14, 10, 5, 3], [31, 12, 7, 2]),
  level(2, [384, 78, 34, 21], 57_000, [18, 28, 17, 10, 5], [20, 46, 9, 3]),
  level(3, [298, 112, 59, 25], 74_000, [22, 38, 27, 17, 8], [67, 25, 16, 4]),
  level(4, [204, 126, 84, 30], 91_000, [15, 28, 41, 30, 12], [22, 28, 71, 5]),
  level(5, [91, 132, 109, 34], 108_000, [12, 25, 44, 35, 16], [20, 79, 28, 5]),
  level(6, [0, 38, 71, 12], 65_000, [14, 10, 7, 5, 2], [8, 6, 21, 3])
];

/** A level with only unfinished runs, for the edge cases. */
export const unfinishedOnlyLevel: LevelStats = level(7, [0, 0, 0, 9], 0, [0, 0, 0, 0, 0], [0, 0, 0, 0]);

const SESSIONS = 1284;

/** The overview that matches sampleLevels: 2,472 runs, 2,332 finished, 140 unfinished, 1,415 complete. */
export const sampleOverview: Overview = (() => {
  const sum = (pick: (l: LevelStats) => number) => sampleLevels.reduce((total, l) => total + pick(l), 0);
  const complete = sum((l) => l.outcomes.complete);
  const finished = sum((l) => l.outcomes.complete + l.outcomes.fail + l.outcomes.quit);
  const unfinished = sum((l) => l.outcomes.unfinished);
  const runs = finished + unfinished;
  return { sessions: SESSIONS, runs, finished, unfinished, completionRate: complete / finished, runsPerSession: runs / SESSIONS };
})();

export const emptyOverview: Overview = {
  sessions: 0,
  runs: 0,
  finished: 0,
  unfinished: 0,
  completionRate: null,
  runsPerSession: null
};
