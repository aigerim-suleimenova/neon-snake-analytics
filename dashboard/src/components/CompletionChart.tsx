import type { CompletionRow } from '../view/toDashboardView';
import styles from './CompletionChart.module.css';

export interface CompletionChartProps {
  rows: CompletionRow[];
}

const TICKS = ['100%', '75%', '50%', '25%', '0%'];

/** One vertical bar per level on a fixed 0–100% scale. */
export function CompletionChart({ rows }: CompletionChartProps) {
  return (
    <div className={styles.chart}>
      <div className={styles.axis} aria-hidden="true">
        {TICKS.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
      <ul className={styles.plot} role="list" aria-label="Completion rate by level">
        {rows.map((row) => (
          <li key={row.level} className={styles.column} aria-label={row.description} title={row.description}>
            <span className={styles.value} aria-hidden="true">
              {row.valueText}
            </span>
            {row.hasBar && <span className={row.isZero ? `${styles.bar} ${styles.zero}` : styles.bar} style={{ height: `${row.barPercent}%` }} />}
          </li>
        ))}
      </ul>
      <span aria-hidden="true" />
      <div className={styles.levels} aria-hidden="true">
        {rows.map((row) => (
          <span key={row.level} className={styles.level}>
            {row.label}
          </span>
        ))}
      </div>
    </div>
  );
}
