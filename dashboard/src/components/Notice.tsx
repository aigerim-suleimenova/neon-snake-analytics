import styles from './Notice.module.css';

export interface NoticeAction {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

export interface NoticeProps {
  tone: 'info' | 'error';
  title?: string;
  message: string;
  action?: NoticeAction;
}

/** A page-wide message: "no gameplay yet" (info) or "backend unreachable" with Retry (error). */
export function Notice({ tone, title, message, action }: NoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className={styles.body}>
        <span className={styles.marker} aria-hidden="true">
          {tone === 'error' ? '!' : ''}
        </span>
        <div className={styles.text}>
          {title && <p className={styles.title}>{title}</p>}
          <p className={title ? styles.detail : undefined}>{message}</p>
        </div>
      </div>
      {action && (
        <button type="button" className={styles.action} disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
