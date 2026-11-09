import styles from './Header.module.css';

export interface HeaderProps {
  /** "Loading…", "Updated HH:MM", "Live · updated HH:MM:SS" or "Offline". */
  statusText: string;
  /** Shows a live indicator next to the status. */
  isLive?: boolean;
  isRefreshing: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
}

export function Header({ statusText, isLive = false, isRefreshing, canRefresh, onRefresh }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.titles}>
        <p className={styles.eyebrow}>NEON SNAKE / ANALYTICS</p>
        <h1 className={styles.title}>Gameplay performance</h1>
        <p className={styles.subtitle}>Read-only view of sessions, run outcomes and level difficulty.</p>
      </div>
      <div className={styles.actions}>
        <span className={styles.status} role="status">
          {isLive && <span className={styles.liveDot} aria-hidden="true" />}
          {statusText}
        </span>
        <button type="button" className={styles.refresh} disabled={!canRefresh} onClick={onRefresh}>
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </header>
  );
}
