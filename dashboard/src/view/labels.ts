import { FAILURE_REASONS, PROGRESS_RANGES, type FailureReason, type ProgressRange } from '@neon-snake/contract';

export const PROGRESS_LABELS: Record<ProgressRange, string> = {
  '0-19': '0–19%',
  '20-39': '20–39%',
  '40-59': '40–59%',
  '60-79': '60–79%',
  '80-99': '80–99%'
};

export const REASON_LABELS: Record<FailureReason, string> = {
  wall: 'Wall',
  snake: 'Self collision',
  obstacle: 'Obstacle',
  external: 'Ended by platform'
};

export interface LegendItem<K extends string> {
  key: K;
  label: string;
}

/** Legends in the fixed order of the spec, which is also the tie-break order. */
export const PROGRESS_LEGEND: LegendItem<ProgressRange>[] = PROGRESS_RANGES.map((key) => ({ key, label: PROGRESS_LABELS[key] }));
export const REASON_LEGEND: LegendItem<FailureReason>[] = FAILURE_REASONS.map((key) => ({ key, label: REASON_LABELS[key] }));
