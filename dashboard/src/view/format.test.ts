// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { formatCount, formatDuration, formatRate, formatRunsPerSession } from './format';

describe('number formats', () => {
  it('uses a thousands separator for counts', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(0)).toBe('0');
  });

  it('shows rates as percentages with one decimal, zero as 0.0% and null as —', () => {
    expect(formatRate(1415 / 2332)).toBe('60.7%');
    expect(formatRate(1)).toBe('100.0%');
    expect(formatRate(0)).toBe('0.0%');
    expect(formatRate(null)).toBe('—');
  });

  it('shows runs per session with two decimals', () => {
    expect(formatRunsPerSession(2472 / 1284)).toBe('1.93');
    expect(formatRunsPerSession(null)).toBe('—');
  });

  it('shows durations as mm:ss, rounded to seconds', () => {
    expect(formatDuration(42_000)).toBe('00:42');
    expect(formatDuration(65_499)).toBe('01:05');
    expect(formatDuration(108_000)).toBe('01:48');
    expect(formatDuration(4_500_000)).toBe('75:00');
    expect(formatDuration(null)).toBe('—');
  });
});
