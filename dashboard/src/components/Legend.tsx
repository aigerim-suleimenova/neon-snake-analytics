import type { LegendItem } from '../view/labels';
import styles from './Legend.module.css';

export interface LegendProps<K extends string> {
  items: LegendItem<K>[];
  /** Picks the color token of an item: `--color-<palette>-<key>`. */
  palette: 'progress' | 'reason';
}

export const segmentColor = (palette: LegendProps<string>['palette'], key: string) => `var(--color-${palette}-${key})`;

export function Legend<K extends string>({ items, palette }: LegendProps<K>) {
  return (
    <ul className={styles.legend} role="list" aria-label="Legend">
      {items.map((item) => (
        <li key={item.key} className={styles.item}>
          <span className={styles.swatch} style={{ background: segmentColor(palette, item.key) }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
