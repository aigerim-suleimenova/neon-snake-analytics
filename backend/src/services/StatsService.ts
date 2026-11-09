import type { EventStore } from '../ports/EventStore';
import type { StatsSnapshots } from '../ports/StatsSnapshots';
import { levels, overview, type LevelStats, type Overview } from './stats';
import type { StatsCounts } from './statsCounts';

/** How long one read of the counts answers statistics requests, in milliseconds. */
export const STATS_CACHE_MS = 1000;

/**
 * A snapshot older than this is not used: its writer has probably stopped, so the counts are added up from the
 * counter documents instead. Ten intervals of the 1 s writer, so a slow write or two never cause a fallback.
 */
export const MAX_SNAPSHOT_AGE_MS = 10_000;

export interface StatsServiceOptions {
  /** 0 reads the store for every request. */
  cacheMs?: number;
  /** Milliseconds since some fixed point; injected for tests. */
  now?: () => number;
  /** Read first, when given; the counter documents are added up only when it is missing or stale. */
  snapshots?: Pick<StatsSnapshots, 'read'>;
  maxSnapshotAgeMs?: number;
  /** The wall clock, to tell a snapshot's age; injected for tests. */
  wallClock?: () => Date;
  /** Called when a missing or stale snapshot makes a read fall back to the counter documents. */
  onFallback?: (reason: 'missing' | 'stale') => void;
}

interface CachedRead {
  counts: Promise<StatsCounts>;
  /** When the read finished; null while it runs. */
  readAt: number | null;
}

/**
 * Computes the statistics from the store's running counts, read from the snapshot (one document) when a fresh
 * one exists, else added up from the counter documents. One read of the counts serves every request for
 * `cacheMs` after it finishes, and requests arriving while it runs wait for it instead of starting their own.
 * So the store sees at most about one read per `cacheMs` per instance, however many dashboards are open, and
 * the statistics are at most `cacheMs` old. A failed read is not kept: the next request reads again.
 */
export class StatsService {
  private cached: CachedRead | null = null;
  private readonly cacheMs: number;
  private readonly now: () => number;
  private readonly snapshots: Pick<StatsSnapshots, 'read'> | null;
  private readonly maxSnapshotAgeMs: number;
  private readonly wallClock: () => Date;
  private readonly onFallback: (reason: 'missing' | 'stale') => void;

  constructor(
    private readonly store: Pick<EventStore, 'readStats'>,
    {
      cacheMs = STATS_CACHE_MS,
      now = () => performance.now(),
      snapshots,
      maxSnapshotAgeMs = MAX_SNAPSHOT_AGE_MS,
      wallClock = () => new Date(),
      onFallback = () => {}
    }: StatsServiceOptions = {}
  ) {
    this.cacheMs = cacheMs;
    this.now = now;
    this.snapshots = snapshots ?? null;
    this.maxSnapshotAgeMs = maxSnapshotAgeMs;
    this.wallClock = wallClock;
    this.onFallback = onFallback;
  }

  async overview(): Promise<Overview> {
    return overview(await this.counts());
  }

  async levels(): Promise<LevelStats[]> {
    return levels(await this.counts());
  }

  private counts(): Promise<StatsCounts> {
    const cached = this.cached;
    if (cached && (cached.readAt === null || this.now() - cached.readAt < this.cacheMs)) return cached.counts;

    const read: CachedRead = { counts: this.readCounts(), readAt: null };
    this.cached = read;
    read.counts.then(
      () => {
        read.readAt = this.now();
      },
      () => {
        if (this.cached === read) this.cached = null;
      }
    );
    return read.counts;
  }

  /** The snapshot when it is fresh; otherwise the counter documents, so a stopped writer costs reads, not answers. */
  private async readCounts(): Promise<StatsCounts> {
    if (!this.snapshots) return this.store.readStats();
    const snapshot = await this.snapshots.read();
    if (snapshot && this.wallClock().getTime() - snapshot.computedAt.getTime() <= this.maxSnapshotAgeMs) return snapshot.counts;
    this.onFallback(snapshot ? 'stale' : 'missing');
    return this.store.readStats();
  }
}
