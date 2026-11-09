import type { FailureReason, LevelStats, Overview, ProgressRange } from '@neon-snake/contract';
import { formatCount, formatDuration, formatRate, formatRunsPerSession, NO_VALUE } from './format';
import { PROGRESS_LEGEND, REASON_LEGEND, type LegendItem } from './labels';

export interface KpiDefinition {
  key: 'sessions' | 'runs' | 'finished' | 'unfinished' | 'completionRate' | 'runsPerSession';
  label: string;
  explanation: string;
  /** The completion rate is marked as the key figure. */
  isKey: boolean;
}

export interface KpiView extends KpiDefinition {
  value: string;
}

/** The six overview values; also shown (without values) while loading or offline. */
export const KPI_DEFINITIONS: KpiDefinition[] = [
  { key: 'sessions', label: 'Sessions', explanation: 'game page visits', isKey: false },
  { key: 'runs', label: 'Total runs', explanation: 'all level attempts', isKey: false },
  { key: 'finished', label: 'Finished runs', explanation: 'ended: complete, fail or quit', isKey: false },
  { key: 'unfinished', label: 'Unfinished runs', explanation: 'no end yet: playing or tab closed', isKey: false },
  { key: 'completionRate', label: 'Completion rate', explanation: 'complete ÷ finished runs', isKey: true },
  { key: 'runsPerSession', label: 'Runs per session', explanation: 'attempts per visit', isKey: false }
];

export interface CompletionRow {
  level: number;
  label: string;
  valueText: string;
  /** Bar height in percent of the 0–100% scale. */
  barPercent: number;
  /** False without finished runs: no bar, "—". */
  hasBar: boolean;
  /** A real 0% rate, drawn as a minimal bar. */
  isZero: boolean;
  description: string;
}

export interface Segment<K extends string> {
  key: K;
  label: string;
  count: number;
  /** Width in percent of the shared scale (the level with the most failed runs = 100). */
  widthPercent: number;
}

export interface StackedRow<K extends string> {
  level: number;
  label: string;
  totalText: string;
  /** Only segments with at least one failed run, in legend order. */
  segments: Segment<K>[];
  description: string;
}

export interface StackedChart<K extends string> {
  rows: StackedRow<K>[];
  legend: LegendItem<K>[];
}

export interface TableRow {
  level: number;
  label: string;
  runs: string;
  complete: string;
  fail: string;
  quit: string;
  unfinished: string;
  completion: string;
  averageDuration: string;
  mostFailsAt: string;
  topReason: string;
}

export interface DashboardView {
  /** No runs stored yet; decided from the overview alone. */
  isEmpty: boolean;
  kpis: KpiView[];
  completion: CompletionRow[];
  progress: StackedChart<ProgressRange>;
  reasons: StackedChart<FailureReason>;
  table: TableRow[];
}

const levelLabel = (level: number) => `L${level}`;

/** Index of the largest count; on a tie the first one, which is the lower range or the earlier reason. */
const indexOfMax = (counts: number[]) => counts.reduce((best, count, i) => (count > counts[best] ? i : best), 0);

const kpiValue = (key: KpiDefinition['key'], overview: Overview): string => {
  switch (key) {
    case 'completionRate':
      return formatRate(overview.completionRate);
    case 'runsPerSession':
      return formatRunsPerSession(overview.runsPerSession);
    default:
      return formatCount(overview[key]);
  }
};

const kpis = (overview: Overview): KpiView[] => KPI_DEFINITIONS.map((definition) => ({ ...definition, value: kpiValue(definition.key, overview) }));

const completionRow = (level: LevelStats): CompletionRow => {
  const rate = level.completionRate;
  const valueText = formatRate(rate);
  return {
    level: level.level,
    label: levelLabel(level.level),
    valueText,
    barPercent: rate === null ? 0 : rate * 100,
    hasBar: rate !== null,
    isZero: rate === 0,
    description: rate === null ? `Level ${level.level}: no finished runs` : `Level ${level.level}: ${valueText} completion`
  };
};

const stackedChart = <K extends string>(levels: LevelStats[], legend: LegendItem<K>[], countsOf: (level: LevelStats) => Record<K, number>): StackedChart<K> => {
  const scale = Math.max(0, ...levels.map((level) => level.outcomes.fail));
  const rows = levels.map((level): StackedRow<K> => {
    const counts = countsOf(level);
    const segments = legend
      .filter(({ key }) => counts[key] > 0)
      .map(({ key, label }) => ({ key, label, count: counts[key], widthPercent: scale ? (counts[key] / scale) * 100 : 0 }));
    const total = formatCount(level.outcomes.fail);
    const parts = legend.map(({ key, label }) => `${label} ${formatCount(counts[key])}`).join(', ');
    return {
      level: level.level,
      label: levelLabel(level.level),
      totalText: total,
      segments,
      description: `Level ${level.level}: ${total} failed runs. ${parts}.`
    };
  });
  return { rows, legend };
};

const mostOf = <K extends string>(legend: LegendItem<K>[], counts: Record<K, number>): LegendItem<K> & { count: number } => {
  const values = legend.map(({ key }) => counts[key]);
  const best = legend[indexOfMax(values)];
  return { ...best, count: counts[best.key] };
};

const tableRow = (level: LevelStats): TableRow => {
  const { complete, fail, quit, unfinished } = level.outcomes;
  const range = mostOf(PROGRESS_LEGEND, level.failedByProgress);
  const reason = mostOf(REASON_LEGEND, level.failedByReason);
  return {
    level: level.level,
    label: levelLabel(level.level),
    runs: formatCount(complete + fail + quit + unfinished),
    complete: formatCount(complete),
    fail: formatCount(fail),
    quit: formatCount(quit),
    unfinished: formatCount(unfinished),
    completion: formatRate(level.completionRate),
    averageDuration: formatDuration(level.averageDurationMs),
    mostFailsAt: range.count > 0 ? range.label : NO_VALUE,
    topReason: reason.count > 0 ? `${reason.label} · ${formatCount(reason.count)}` : NO_VALUE
  };
};

/** Turns the two statistics answers into everything the page shows. Levels keep the backend's ascending order. */
export const toDashboardView = (overview: Overview, levels: LevelStats[]): DashboardView => ({
  isEmpty: overview.runs === 0,
  kpis: kpis(overview),
  completion: levels.map(completionRow),
  progress: stackedChart(levels, PROGRESS_LEGEND, (level) => level.failedByProgress),
  reasons: stackedChart(levels, REASON_LEGEND, (level) => level.failedByReason),
  table: levels.map(tableRow)
});
