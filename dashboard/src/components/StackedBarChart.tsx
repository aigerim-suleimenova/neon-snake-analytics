import type { StackedChart } from '../view/toDashboardView';
import { Legend, segmentColor, type LegendProps } from './Legend';
import styles from './StackedBarChart.module.css';

export interface StackedBarChartProps<K extends string> {
  /** Accessible name of the bar list, e.g. "Failed runs by reason". */
  label: string;
  chart: StackedChart<K>;
  palette: LegendProps<K>['palette'];
}

/** One horizontal stacked bar per level on a shared scale, with the total next to it and a legend below. */
export function StackedBarChart<K extends string>({ label, chart, palette }: StackedBarChartProps<K>) {
  return (
    <div className={styles.chart}>
      <ul className={styles.rows} role="list" aria-label={label}>
        {chart.rows.map((row) => (
          <li key={row.level} className={styles.row} aria-label={row.description} title={row.description}>
            <span className={styles.level} aria-hidden="true">
              {row.label}
            </span>
            <span className={styles.bar} aria-hidden="true">
              {row.segments.map((segment) => (
                <span
                  key={segment.key}
                  className={styles.segment}
                  title={`${segment.label}: ${segment.count}`}
                  style={{ width: `${segment.widthPercent}%`, background: segmentColor(palette, segment.key) }}
                />
              ))}
            </span>
            <span className={styles.total} aria-hidden="true">
              {row.totalText}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        <Legend items={chart.legend} palette={palette} />
        <p className={styles.scale}>Bar length: failed runs, same scale for every level</p>
      </div>
    </div>
  );
}
