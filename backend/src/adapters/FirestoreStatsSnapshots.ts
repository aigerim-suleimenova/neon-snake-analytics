import { FieldValue, type Firestore, type Timestamp } from 'firebase-admin/firestore';
import type { StatsSnapshot, StatsSnapshots } from '../ports/StatsSnapshots';
import { toStatsCounts, type Counts, type StatsCounts } from '../services/statsCounts';

/**
 * StatsSnapshots on Firestore: one document, `stats/current`, holding the added-up counts and the server time
 * they were written. A write per second is within what one document sustains; two writers by mistake only write
 * the same totals twice.
 */
export class FirestoreStatsSnapshots implements StatsSnapshots {
  constructor(private readonly db: Firestore) {}

  private get ref() {
    return this.db.collection('stats').doc('current');
  }

  async read(): Promise<StatsSnapshot | null> {
    const snapshot = await this.ref.get();
    const data = snapshot.data() as { counts?: Counts; computedAt?: Timestamp } | undefined;
    if (!data?.counts || !data.computedAt) return null;
    return { counts: toStatsCounts(data.counts), computedAt: data.computedAt.toDate() };
  }

  async write(counts: StatsCounts): Promise<void> {
    // Server time, so every API instance compares the snapshot's age against one clock source.
    await this.ref.set({ counts, computedAt: FieldValue.serverTimestamp() });
  }
}
