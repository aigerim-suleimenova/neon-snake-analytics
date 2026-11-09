import { describe, expect, it, vi } from 'vitest';
import { InMemoryStatsSnapshots } from '../adapters/InMemoryStatsSnapshots';
import type { StatsCounts } from './statsCounts';
import { runSnapshotLoop } from './statsSnapshotLoop';
import { MAX_SNAPSHOT_AGE_MS, StatsService } from './StatsService';

const fromCounters: StatsCounts = { sessions: 9, levels: {} };
const fromSnapshot: StatsCounts = { sessions: 7, levels: {} };
const writtenAt = new Date('2026-11-09T12:00:00.000Z');

function setup(snapshotAgeMs: number | null) {
  const readStats = vi.fn(async () => fromCounters);
  const snapshots = new InMemoryStatsSnapshots(() => writtenAt);
  const onFallback = vi.fn();
  const service = new StatsService(
    { readStats },
    { cacheMs: 0, snapshots, onFallback, wallClock: () => new Date(writtenAt.getTime() + (snapshotAgeMs ?? 0)) }
  );
  return { service, readStats, snapshots, onFallback, ready: snapshotAgeMs === null ? Promise.resolve() : snapshots.write(fromSnapshot) };
}

describe('StatsService with a snapshot', () => {
  it('reads one snapshot document instead of the counter documents while it is fresh', async () => {
    const { service, readStats, onFallback, ready } = setup(MAX_SNAPSHOT_AGE_MS);
    await ready;

    expect((await service.overview()).sessions).toBe(7);

    expect(readStats).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('adds up the counter documents once the snapshot is stale, as its writer has stopped', async () => {
    const { service, onFallback, ready } = setup(MAX_SNAPSHOT_AGE_MS + 1);
    await ready;

    expect((await service.overview()).sessions).toBe(9);

    expect(onFallback).toHaveBeenCalledWith('stale');
  });

  it('adds up the counter documents when no snapshot was written yet', async () => {
    const { service, onFallback } = setup(null);

    expect((await service.overview()).sessions).toBe(9);

    expect(onFallback).toHaveBeenCalledWith('missing');
  });

  it('keeps the one-read-per-second cache in front of the snapshot', async () => {
    const snapshots = new InMemoryStatsSnapshots(() => writtenAt);
    await snapshots.write(fromSnapshot);
    const read = vi.spyOn(snapshots, 'read');
    const service = new StatsService({ readStats: async () => fromCounters }, { snapshots, now: () => 0, wallClock: () => writtenAt });

    await Promise.all([service.overview(), service.levels(), service.overview()]);

    expect(read).toHaveBeenCalledOnce();
  });
});

describe('runSnapshotLoop', () => {
  function loop(rounds: number, readStats: () => Promise<StatsCounts>) {
    let time = 0;
    let done = 0;
    const write = vi.fn(async () => {
      done += 1;
    });
    const sleeps: number[] = [];
    const logError = vi.fn();
    const run = runSnapshotLoop({
      store: { readStats },
      snapshots: { write },
      isRunning: () => done < rounds,
      sleep: async (ms) => {
        sleeps.push(ms);
        time += ms;
      },
      now: () => time,
      logError
    });
    return { run, write, sleeps, logError, advance: (ms: number) => (time += ms) };
  }

  it('writes the added-up counts as the snapshot, a second apart', async () => {
    const { run, write, sleeps } = loop(3, async () => fromCounters);

    await run;

    expect(write.mock.calls).toEqual([[fromCounters], [fromCounters], [fromCounters]]);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('starts rounds an interval apart, however long the read takes', async () => {
    let time = 0;
    let rounds = 0;
    const sleeps: number[] = [];
    await runSnapshotLoop({
      store: {
        readStats: async () => {
          time += 300;
          return fromCounters;
        }
      },
      snapshots: { write: async () => void (rounds += 1) },
      isRunning: () => rounds < 2,
      sleep: async (ms) => void sleeps.push(ms),
      now: () => time,
      logError: () => {}
    });

    expect(sleeps).toEqual([700]);
  });

  it('logs a failed round and tries again in the next one', async () => {
    const failure = new Error('store down');
    const readStats = vi.fn<() => Promise<StatsCounts>>().mockRejectedValueOnce(failure).mockResolvedValue(fromCounters);
    const { run, write, logError } = loop(1, readStats);

    await run;

    expect(logError).toHaveBeenCalledWith(failure);
    expect(write).toHaveBeenCalledOnce();
  });
});
