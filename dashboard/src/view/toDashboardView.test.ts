// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { emptyOverview, sampleLevels, sampleOverview, unfinishedOnlyLevel } from '../api/sampleStats';
import type { LevelStats } from '@neon-snake/contract';
import { toDashboardView } from './toDashboardView';

type Progress = [number, number, number, number, number];
type Reasons = [wall: number, snake: number, obstacle: number, external: number];

/** A level whose fail count is the sum of its progress ranges. */
const level = (n: number, complete: number, quit: number, unfinished: number, progress: Progress, reasons: Reasons): LevelStats => {
  const fail = progress.reduce((a, b) => a + b, 0);
  const finished = complete + fail + quit;
  return {
    level: n,
    outcomes: { complete, fail, quit, unfinished },
    completionRate: finished ? complete / finished : null,
    averageDurationMs: finished ? 30_000 : null,
    failedByProgress: { '0-19': progress[0], '20-39': progress[1], '40-59': progress[2], '60-79': progress[3], '80-99': progress[4] },
    failedByReason: { wall: reasons[0], snake: reasons[1], obstacle: reasons[2], external: reasons[3] }
  };
};

const sample = toDashboardView(sampleOverview, sampleLevels);
const widthOf = (row: { segments: { widthPercent: number }[] }) => row.segments.reduce((total, s) => total + s.widthPercent, 0);

describe('overview', () => {
  it('shows the six values with labels, explanations and the key figure', () => {
    expect(sample.isEmpty).toBe(false);
    expect(sample.kpis.map(({ label, value, explanation, isKey }) => [label, value, explanation, isKey])).toEqual([
      ['Sessions', '1,284', 'game page visits', false],
      ['Total runs', '2,472', 'all level attempts', false],
      ['Finished runs', '2,332', 'ended: complete, fail or quit', false],
      ['Unfinished runs', '140', 'no end yet: playing or tab closed', false],
      ['Completion rate', '60.7%', 'complete ÷ finished runs', true],
      ['Runs per session', '1.93', 'attempts per visit', false]
    ]);
  });

  it('is empty without runs: zero counts and — for the rates', () => {
    const view = toDashboardView(emptyOverview, []);

    expect(view.isEmpty).toBe(true);
    expect(view.kpis.map((k) => k.value)).toEqual(['0', '0', '0', '0', '—', '—']);
    expect(view.completion).toEqual([]);
    expect(view.progress.rows).toEqual([]);
    expect(view.table).toEqual([]);
  });

  it('decides emptiness from the overview alone', () => {
    expect(toDashboardView(emptyOverview, sampleLevels).isEmpty).toBe(true);
  });
});

describe('completion rate graph', () => {
  it('draws the difficulty curve on a 0–100% scale', () => {
    const view = toDashboardView(sampleOverview, [level(1, 855, 45, 0, [100, 0, 0, 0, 0], [100, 0, 0, 0]), level(2, 635, 65, 0, [300, 0, 0, 0, 0], [300, 0, 0, 0]), level(3, 0, 5, 0, [5, 0, 0, 0, 0], [5, 0, 0, 0])]);

    expect(view.completion.map(({ valueText, barPercent, hasBar, isZero }) => [valueText, barPercent, hasBar, isZero])).toEqual([
      ['85.5%', 85.5, true, false],
      ['63.5%', 63.5, true, false],
      ['0.0%', 0, true, true]
    ]);
  });

  it('shows a real zero as a minimal bar and a level without finished runs as —', () => {
    const view = toDashboardView(sampleOverview, [...sampleLevels, unfinishedOnlyLevel]);
    const [l6, l7] = view.completion.slice(-2);

    expect(l6).toMatchObject({ label: 'L6', valueText: '0.0%', hasBar: true, isZero: true, description: 'Level 6: 0.0% completion' });
    expect(l7).toMatchObject({ label: 'L7', valueText: '—', hasBar: false, isZero: false, description: 'Level 7: no finished runs' });
  });
});

describe('failed runs graphs', () => {
  it('share one scale: the level with the most failed runs fills the full width', () => {
    const view = toDashboardView(sampleOverview, [sampleLevels[0], sampleLevels[3]]);
    const [l1, l4] = view.progress.rows;

    expect(widthOf(l4)).toBeCloseTo(100);
    expect(widthOf(l1)).toBeCloseTo((52 / 126) * 100);
    expect(widthOf(view.reasons.rows[0])).toBeCloseTo((52 / 126) * 100);
    expect(l1.totalText).toBe('52');
  });

  it('scale the sample to its largest level (L5, 132 failed runs)', () => {
    expect(sample.progress.rows.map((row) => Math.round(widthOf(row)))).toEqual([39, 59, 85, 95, 100, 29]);
  });

  it('split each bar by progress range in legend order', () => {
    expect(sample.progress.legend.map((l) => l.label)).toEqual(['0–19%', '20–39%', '40–59%', '60–79%', '80–99%']);
    expect(sample.progress.rows[0].segments.map((s) => [s.label, s.count])).toEqual([
      ['0–19%', 20],
      ['20–39%', 14],
      ['40–59%', 10],
      ['60–79%', 5],
      ['80–99%', 3]
    ]);
  });

  it('label the reasons and show the total', () => {
    const view = toDashboardView(sampleOverview, [level(1, 0, 0, 0, [40, 0, 0, 0, 0], [10, 18, 8, 4])]);
    const row = view.reasons.rows[0];

    expect(view.reasons.legend.map((l) => l.label)).toEqual(['Wall', 'Self collision', 'Obstacle', 'Ended by platform']);
    expect(row.segments.map((s) => [s.label, s.count])).toEqual([
      ['Wall', 10],
      ['Self collision', 18],
      ['Obstacle', 8],
      ['Ended by platform', 4]
    ]);
    expect(row.totalText).toBe('40');
  });

  it('show an empty bar and 0 for a level without failed runs', () => {
    const view = toDashboardView(sampleOverview, [...sampleLevels, unfinishedOnlyLevel]);
    const l7 = view.reasons.rows[6];

    expect(l7.segments).toEqual([]);
    expect(l7.totalText).toBe('0');
  });

  it('show empty bars and totals of 0 when no level has failed runs', () => {
    const view = toDashboardView(sampleOverview, [level(1, 5, 1, 0, [0, 0, 0, 0, 0], [0, 0, 0, 0]), unfinishedOnlyLevel]);

    for (const row of [...view.progress.rows, ...view.reasons.rows]) {
      expect(row.segments).toEqual([]);
      expect(row.totalText).toBe('0');
    }
  });

  it('describe each bar with the level, total and every count', () => {
    expect(sample.reasons.rows[3].description).toBe('Level 4: 126 failed runs. Wall 22, Self collision 28, Obstacle 71, Ended by platform 5.');
    expect(sample.progress.rows[3].description).toBe('Level 4: 126 failed runs. 0–19% 15, 20–39% 28, 40–59% 41, 60–79% 30, 80–99% 12.');
  });
});

describe('per-level table', () => {
  it('shows a level with all columns', () => {
    expect(sample.table[0]).toEqual({
      level: 1,
      label: 'L1',
      runs: '530',
      complete: '438',
      fail: '52',
      quit: '22',
      unfinished: '18',
      completion: '85.5%',
      averageDuration: '00:42',
      mostFailsAt: '0–19%',
      topReason: 'Wall · 31'
    });
  });

  it('breaks ties by the lower range and the first reason', () => {
    const view = toDashboardView(sampleOverview, [level(1, 0, 0, 0, [0, 5, 5, 0, 0], [3, 0, 3, 0])]);

    expect(view.table[0].mostFailsAt).toBe('20–39%');
    expect(view.table[0].topReason).toBe('Wall · 3');
  });

  it('shows — for everything that cannot be calculated on a level with only unfinished runs', () => {
    const view = toDashboardView(sampleOverview, [unfinishedOnlyLevel]);

    expect(view.table[0]).toMatchObject({
      label: 'L7',
      runs: '9',
      complete: '0',
      fail: '0',
      quit: '0',
      unfinished: '9',
      completion: '—',
      averageDuration: '—',
      mostFailsAt: '—',
      topReason: '—'
    });
  });

  it('shows 0.0% for a level with finished runs but no clears', () => {
    expect(sample.table[5]).toMatchObject({ label: 'L6', completion: '0.0%', averageDuration: '01:05', topReason: 'Obstacle · 21' });
  });
});
