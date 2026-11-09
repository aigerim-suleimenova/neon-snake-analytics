import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import type { Run, RunStatus } from '../ports/EventStore';
import { endEvent, validated } from '../test/events';
import { applyEvent } from './runRecord';
import { StatsService } from './StatsService';
import { levels as levelsOf, overview as overviewOf } from './stats';
import { countRuns, type StatsCounts } from './statsCounts';

let nextId = 0;

function run(status: RunStatus, overrides: Partial<Run> = {}): Run {
  nextId += 1;
  const finished = status !== 'unfinished';
  return {
    runId: `r${nextId}`,
    sessionId: 's1',
    level: 1,
    status,
    startedAt: '2026-10-01T11:59:00.000Z',
    endedAt: finished ? '2026-10-01T11:59:10.000Z' : null,
    failureReason: status === 'fail' ? 'wall' : null,
    score: finished ? 10 : null,
    levelScore: finished ? 10 : null,
    progress: status === 'complete' ? 100 : finished ? 50 : null,
    durationMs: finished ? 10_000 : null,
    startEventId: `start-${nextId}`,
    endEventId: finished ? `end-${nextId}` : null,
    ...overrides
  };
}

const overview = (runs: readonly Run[]) => overviewOf(countRuns(runs));
const levels = (runs: readonly Run[]) => levelsOf(countRuns(runs));

const failed = (progress: number, overrides: Partial<Run> = {}) => run('fail', { progress, ...overrides });

describe('overview', () => {
  it('reports mixed outcomes across two sessions', () => {
    const runs = [
      run('complete'),
      run('complete', { sessionId: 's2' }),
      run('fail'),
      run('quit', { sessionId: 's2' }),
      run('unfinished')
    ];

    expect(overview(runs)).toEqual({
      sessions: 2,
      runs: 5,
      finished: 4,
      unfinished: 1,
      completionRate: 0.5,
      runsPerSession: 2.5
    });
  });

  it('reports zero counts and null rates without data', () => {
    expect(overview([])).toEqual({
      sessions: 0,
      runs: 0,
      finished: 0,
      unfinished: 0,
      completionRate: null,
      runsPerSession: null
    });
  });

  it('leaves an unfinished run (tab closed mid-level) out of the completion rate', () => {
    expect(overview([run('complete'), run('unfinished')])).toMatchObject({
      finished: 1,
      unfinished: 1,
      completionRate: 1
    });
  });

  it('counts a run with only an end event as a finished, failed run', () => {
    const endOnly = applyEvent(undefined, validated(endEvent()));

    expect(endOnly.startedAt).toBeNull();
    expect(overview([endOnly])).toMatchObject({ finished: 1, unfinished: 0, completionRate: 0 });
    expect(levels([endOnly])[0].outcomes).toEqual({ complete: 0, fail: 1, quit: 0, unfinished: 0 });
  });
});

describe('levels', () => {
  it('reports outcomes and the completion rate of a hard level', () => {
    const [entry] = levels([run('complete', { level: 2 }), failed(10, { level: 2 }), failed(20, { level: 2 }), failed(30, { level: 2 })]);

    expect(entry).toMatchObject({
      level: 2,
      outcomes: { complete: 1, fail: 3, quit: 0, unfinished: 0 },
      completionRate: 0.25
    });
  });

  it('counts failed runs per progress range', () => {
    const [entry] = levels([failed(0, { level: 3 }), failed(11, { level: 3 }), failed(89, { level: 3 })]);

    expect(entry.failedByProgress).toEqual({ '0-19': 2, '20-39': 0, '40-59': 0, '60-79': 0, '80-99': 1 });
  });

  it('puts each range boundary in the right range', () => {
    const [entry] = levels([19, 20, 39, 40, 59, 60, 79, 80, 99].map((progress) => failed(progress)));

    expect(entry.failedByProgress).toEqual({ '0-19': 1, '20-39': 2, '40-59': 2, '60-79': 2, '80-99': 2 });
  });

  it('counts failed runs per failure reason', () => {
    const [entry] = levels([
      failed(10, { level: 2, failureReason: 'obstacle' }),
      failed(10, { level: 2, failureReason: 'obstacle' }),
      failed(10, { level: 2, failureReason: 'wall' }),
      run('quit', { level: 2 })
    ]);

    expect(entry.failedByReason).toEqual({ wall: 1, snake: 0, obstacle: 2, external: 0 });
  });

  it('averages the duration of complete, failed and quit runs and skips unfinished ones', () => {
    const [entry] = levels([
      run('complete', { durationMs: 10_000 }),
      run('fail', { durationMs: 4000 }),
      run('quit', { durationMs: 1000 }),
      run('unfinished')
    ]);

    expect(entry.averageDurationMs).toBe(5000);
    expect(entry.outcomes.unfinished).toBe(1);
  });

  it('reports a level with only unfinished runs with null rates', () => {
    const [entry] = levels([run('unfinished', { level: 3 }), run('unfinished', { level: 3 })]);

    expect(entry).toEqual({
      level: 3,
      outcomes: { complete: 0, fail: 0, quit: 0, unfinished: 2 },
      completionRate: null,
      averageDurationMs: null,
      failedByProgress: { '0-19': 0, '20-39': 0, '40-59': 0, '60-79': 0, '80-99': 0 },
      failedByReason: { wall: 0, snake: 0, obstacle: 0, external: 0 }
    });
  });

  it('lists only levels with runs, in ascending order', () => {
    const result = levels([run('complete', { level: 5 }), run('fail', { level: 1 }), run('quit', { level: 3 })]);

    expect(result.map((entry) => entry.level)).toEqual([1, 3, 5]);
  });

  it('returns no levels without data', () => {
    expect(levels([])).toEqual([]);
  });
});

describe('StatsService', () => {
  it('computes both statistics from the stored counts', async () => {
    const store = new InMemoryEventStore();
    await store.saveEvent(validated(endEvent()), new Date('2026-10-01T12:00:00.000Z'));
    const service = new StatsService(store);

    expect(await service.overview()).toMatchObject({ runs: 1, finished: 1, completionRate: 0 });
    expect(await service.levels()).toEqual([expect.objectContaining({ level: 1, outcomes: expect.objectContaining({ fail: 1 }) })]);
  });

  describe('reading the store', () => {
    const empty: StatsCounts = { sessions: 0, levels: {} };

    function setup(cacheMs?: number) {
      let time = 0;
      const readStats = vi.fn(async () => empty);
      const service = new StatsService({ readStats }, { cacheMs, now: () => time });
      return { service, readStats, advance: (ms: number) => (time += ms) };
    }

    it('serves both statistics from one read for a second after it finishes', async () => {
      const { service, readStats, advance } = setup();

      await service.overview();
      advance(999);
      await service.levels();
      expect(readStats).toHaveBeenCalledOnce();

      advance(1);
      await service.overview();
      expect(readStats).toHaveBeenCalledTimes(2);
    });

    it('lets requests that arrive during a read wait for it', async () => {
      const { service, readStats } = setup();
      let finish: (counts: StatsCounts) => void = () => {};
      readStats.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

      const requests = [service.overview(), service.levels(), service.overview()];
      finish(empty);
      await Promise.all(requests);

      expect(readStats).toHaveBeenCalledOnce();
    });

    it('counts the second from when the read finished, so a slow read is not stale at once', async () => {
      const { service, readStats, advance } = setup();
      let finish: (counts: StatsCounts) => void = () => {};
      readStats.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

      const first = service.overview();
      advance(5000);
      finish(empty);
      await first;
      advance(999);
      await service.overview();

      expect(readStats).toHaveBeenCalledOnce();
    });

    it('does not keep a failed read: the next request reads again', async () => {
      const { service, readStats } = setup();
      const failure = new Error('store down');
      readStats.mockRejectedValueOnce(failure);

      await expect(service.overview()).rejects.toBe(failure);
      expect(await service.overview()).toMatchObject({ runs: 0 });

      expect(readStats).toHaveBeenCalledTimes(2);
    });

    it('reads for every request with cacheMs 0', async () => {
      const { service, readStats } = setup(0);

      await service.overview();
      await service.overview();

      expect(readStats).toHaveBeenCalledTimes(2);
    });
  });
});
