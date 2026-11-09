import type { StatsSnapshot, StatsSnapshots } from '../ports/StatsSnapshots';
import type { StatsCounts } from '../services/statsCounts';

/** StatsSnapshots kept in memory, for tests; `now` stands in for the store's clock. */
export class InMemoryStatsSnapshots implements StatsSnapshots {
  private snapshot: StatsSnapshot | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async read(): Promise<StatsSnapshot | null> {
    return this.snapshot;
  }

  async write(counts: StatsCounts): Promise<void> {
    this.snapshot = { counts: structuredClone(counts), computedAt: this.now() };
  }
}
