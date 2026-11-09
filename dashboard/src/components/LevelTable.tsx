import type { TableRow } from '../view/toDashboardView';
import styles from './LevelTable.module.css';

export type LevelTableProps = { status: 'ready'; rows: TableRow[] } | { status: 'loading' } | { status: 'message'; message: string };

interface Column {
  label: string;
  numeric: boolean;
  /** Outcome color shown as a dot next to the header. */
  outcome?: 'complete' | 'fail' | 'quit' | 'unfinished';
}

const COLUMNS: Column[] = [
  { label: 'Level', numeric: false },
  { label: 'Runs', numeric: true },
  { label: 'Complete', numeric: true, outcome: 'complete' },
  { label: 'Fail', numeric: true, outcome: 'fail' },
  { label: 'Quit', numeric: true, outcome: 'quit' },
  { label: 'Unfinished', numeric: true, outcome: 'unfinished' },
  { label: 'Completion', numeric: true },
  { label: 'Avg duration', numeric: true },
  { label: 'Most fails at', numeric: true },
  { label: 'Top failure reason', numeric: false }
];

const SKELETON_WIDTHS = [92, 78, 85];

/** One row per level with outcome counts and the derived values; scrolls sideways inside its card on narrow screens. */
export function LevelTable(props: LevelTableProps) {
  return (
    <section className={styles.card} aria-labelledby="level-table-title">
      <div className={styles.heading}>
        <h2 id="level-table-title" className={styles.title}>
          Per-level detail
        </h2>
        <p className={styles.subtitle}>— means not enough finished or failed runs to calculate.</p>
      </div>
      {/* Focusable so keyboard users can scroll the table when it is wider than the screen. */}
      <div className={styles.scroller} tabIndex={0} role="region" aria-label="Per-level table, scrolls sideways">
        <table className={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.label} scope="col" className={column.numeric ? styles.numeric : undefined}>
                  <span className={styles.header}>
                    {column.outcome && <span className={styles.dot} style={{ background: `var(--color-${column.outcome})` }} aria-hidden="true" />}
                    {column.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.status === 'ready' &&
              props.rows.map((row) => (
                <tr key={row.level}>
                  <th scope="row" className={styles.level}>
                    {row.label}
                  </th>
                  <td className={styles.numeric}>{row.runs}</td>
                  <td className={styles.numeric}>{row.complete}</td>
                  <td className={styles.numeric}>{row.fail}</td>
                  <td className={styles.numeric}>{row.quit}</td>
                  <td className={styles.numeric}>{row.unfinished}</td>
                  <td className={`${styles.numeric} ${styles.strong}`}>{row.completion}</td>
                  <td className={styles.numeric}>{row.averageDuration}</td>
                  <td className={styles.numeric}>{row.mostFailsAt}</td>
                  <td className={styles.reason}>{row.topReason}</td>
                </tr>
              ))}
            {props.status === 'loading' &&
              SKELETON_WIDTHS.map((width) => (
                <tr key={width} aria-hidden="true">
                  <td colSpan={COLUMNS.length}>
                    <span className={styles.skeleton} style={{ width: `${width}%` }} />
                  </td>
                </tr>
              ))}
            {props.status === 'message' && (
              <tr>
                <td colSpan={COLUMNS.length} className={styles.message}>
                  {props.message}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.source}>GET /api/stats/levels</p>
    </section>
  );
}
