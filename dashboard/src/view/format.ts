// Number formats of the dashboard spec. A `null` from the backend means "cannot be calculated" and is shown as "—".

export const NO_VALUE = '—';

const counts = new Intl.NumberFormat('en-US');

/** 1284 → "1,284" */
export const formatCount = (value: number): string => counts.format(value);

/** 0.6068 → "60.7%"; 0 → "0.0%" */
export const formatRate = (rate: number | null): string => (rate === null ? NO_VALUE : `${(rate * 100).toFixed(1)}%`);

/** 1.9252 → "1.93" */
export const formatRunsPerSession = (value: number | null): string => (value === null ? NO_VALUE : value.toFixed(2));

/** 65_000 ms → "01:05" (minutes are not wrapped into hours) */
export const formatDuration = (ms: number | null): string => {
  if (ms === null) return NO_VALUE;
  const seconds = Math.round(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
};
