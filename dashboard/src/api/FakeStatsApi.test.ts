// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { FakeStatsApi } from './FakeStatsApi';
import { emptyOverview, sampleLevels, sampleOverview } from './sampleStats';
import { StatsUnavailableError } from './StatsApi';

describe('sample data', () => {
  it('matches the numbers of the design reference', () => {
    expect(sampleOverview).toMatchObject({ sessions: 1284, runs: 2472, finished: 2332, unfinished: 140 });
    expect(sampleOverview.completionRate).toBeCloseTo(1415 / 2332);
    expect(sampleOverview.runsPerSession).toBeCloseTo(2472 / 1284);
  });
});

describe('FakeStatsApi', () => {
  it('answers with the current values and counts calls', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    await expect(api.getOverview()).resolves.toBe(sampleOverview);
    api.overview = emptyOverview;
    await expect(api.getOverview()).resolves.toBe(emptyOverview);
    expect(api.calls).toEqual({ overview: 2, levels: 0 });
  });

  it('rejects with a set error', async () => {
    const api = new FakeStatsApi(sampleOverview, new StatsUnavailableError('down'));
    await expect(api.getLevels()).rejects.toThrow('down');
  });

  it('keeps requests pending between hold and release', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    api.hold();
    let settled = false;
    const request = api.getOverview().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    api.release();
    await request;
    expect(settled).toBe(true);
  });
});
