import type { ReactNode } from 'react';

import styles from './ChartCard.module.css';

export type ChartBody = { status: 'ready'; chart: ReactNode } | { status: 'loading' } | { status: 'message'; message: string };

export interface ChartCardProps {
  title: string;
  subtitle: string;
  /** Endpoint and field the graph comes from. */
  source: string;
  body: ChartBody;
}

/** Frame of one graph, with the shared loading placeholder and the "no data" / "unavailable" message. */
export function ChartCard({ title, subtitle, source, body }: ChartCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.heading}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      {body.status === 'ready' && body.chart}
      {body.status === 'loading' && <div className={styles.skeleton} aria-hidden="true" />}
      {body.status === 'message' && <p className={styles.message}>{body.message}</p>}
      <p className={styles.source}>{source}</p>
    </article>
  );
}
