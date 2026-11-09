import { KPI_DEFINITIONS, type KpiView } from '../view/toDashboardView';
import { NO_VALUE } from '../view/format';
import styles from './KpiGrid.module.css';

export type KpiGridProps = { status: 'ready'; kpis: KpiView[] } | { status: 'loading' } | { status: 'unavailable' };

/** The six overview values. While loading their values are placeholders; when the backend is unreachable they are "—". */
export function KpiGrid(props: KpiGridProps) {
  const cards: (KpiView & { loading: boolean })[] =
    props.status === 'ready'
      ? props.kpis.map((kpi) => ({ ...kpi, loading: false }))
      : KPI_DEFINITIONS.map((definition) =>
          props.status === 'loading'
            ? { ...definition, value: '', loading: true }
            : { ...definition, value: NO_VALUE, explanation: 'Unavailable', loading: false }
        );

  return (
    <section aria-label="Overview">
      <dl className={styles.grid}>
        {cards.map((card) => {
          // The key figure's value is green only when there is one; "—" stays neutral.
          const highlighted = card.isKey && !card.loading && card.value !== NO_VALUE;
          return (
            <div key={card.key} className={card.isKey ? `${styles.card} ${styles.key}` : styles.card}>
              <dt className={styles.label}>{card.label}</dt>
              <dd className={highlighted ? `${styles.value} ${styles.highlighted}` : styles.value}>
                {card.loading ? <span className={styles.skeleton} aria-hidden="true" /> : card.value}
              </dd>
              <dd className={styles.explanation}>{card.explanation}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
