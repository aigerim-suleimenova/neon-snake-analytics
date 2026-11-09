import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { AnalyticsEvent } from '@neon-snake/contract';
import { MAX_EVENTS_PER_BATCH, type EventStore, type ReceivedEvent, type Run, type SaveResult } from '../ports/EventStore';
import { applyBatch, candidateSessionsOf, runIdsOf, type ChangedRun } from '../services/eventBatch';
import { addCounts, countRuns, toStatsCounts, type Counts, type StatsCounts } from '../services/statsCounts';

/**
 * Counter documents `saveEvent` spreads the counts over: each event increments one of `0..STATS_SHARDS-1`
 * at random, so busy writes do not queue on a single document. `saveEvents` names its own shard instead,
 * e.g. one per queue partition. A statistics request adds up every document in `statsShards/`.
 */
export const STATS_SHARDS = 8;

/** When each of a run's events reached the backend; kept on the run document, not in `Run`. */
const RECEIVED_AT_FIELD = { run_started: 'startReceivedAt', run_ended: 'endReceivedAt' } as const;

/**
 * EventStore on Firestore: `runs/{runId}` holds one record per run (the document ID is the run ID), with
 * both its events merged in and when each arrived; `sessions/{sessionId}` marks a session as counted, and
 * `statsShards/` holds the statistics counts. Events have no documents of their own: the run holds their IDs,
 * which is all finding duplicates needs. A batch is one transaction that reads its runs and possibly new
 * sessions, then writes each changed run and new session once and the combined counts once.
 */
export class FirestoreEventStore implements EventStore {
  constructor(
    private readonly db: Firestore,
    private readonly random: () => number = Math.random
  ) {}

  async saveEvent(event: AnalyticsEvent, receivedAt: Date): Promise<SaveResult> {
    const [result] = await this.saveEvents([{ event, receivedAt }], String(Math.floor(this.random() * STATS_SHARDS)));
    return result;
  }

  async saveEvents(events: readonly ReceivedEvent[], counterShard: string): Promise<SaveResult[]> {
    if (events.length > MAX_EVENTS_PER_BATCH) throw new RangeError(`At most ${MAX_EVENTS_PER_BATCH} events per batch`);
    if (events.length === 0) return [];

    // Firestore may run this again on contention; it only reads, then computes, then writes.
    return this.db.runTransaction(async (tx) => {
      const runSnapshots = await tx.getAll(...runIdsOf(events).map((runId) => this.runRef(runId)));
      const storedRuns = new Map(runSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, toRun(snapshot)]));
      const candidates = candidateSessionsOf(events, storedRuns);
      const sessionSnapshots = candidates.length > 0 ? await tx.getAll(...candidates.map((id) => this.sessionRef(id))) : [];
      const storedSessions = new Set(sessionSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id));

      const outcome = applyBatch(events, storedRuns, storedSessions);
      for (const [runId, changed] of outcome.changedRuns) {
        // Merging keeps the receivedAt of an event from an earlier batch; every `Run` field is written anyway.
        tx.set(this.runRef(runId), runFields(changed), { merge: true });
      }
      for (const [sessionId, firstSeenAt] of outcome.newSessions) {
        tx.set(this.sessionRef(sessionId), { firstSeenAt: Timestamp.fromDate(firstSeenAt) });
      }
      if (Object.keys(outcome.countChange).length > 0) {
        tx.set(this.shardRef(counterShard), increments(outcome.countChange), { merge: true });
      }
      return outcome.results;
    });
  }

  async readStats(): Promise<StatsCounts> {
    const snapshot = await this.db.collection('statsShards').get();
    const total: Counts = {};
    for (const shard of snapshot.docs) addCounts(total, shard.data() as Counts);
    return toStatsCounts(total);
  }

  /** Reads every run; for tests and `rebuildStats` only, never for a request. */
  async listRuns(): Promise<Run[]> {
    const snapshot = await this.db.collection('runs').get();
    return snapshot.docs.map(toRun);
  }

  /**
   * Recounts the statistics from every stored run, for runs stored before the counts existed.
   * Run it while no events arrive: an event stored meanwhile may be counted twice or not at all.
   */
  async rebuildStats(): Promise<StatsCounts> {
    const runs = await this.listRuns();
    const counts = countRuns(runs);
    const writer = this.db.bulkWriter();
    const writes: Promise<unknown>[] = [...new Set(runs.map((run) => run.sessionId))].map((sessionId) =>
      // Merging nothing marks the session as counted and keeps an existing `firstSeenAt`.
      writer.set(this.sessionRef(sessionId), {}, { merge: true })
    );
    // Every other counter document goes, the random ones and those named by `saveEvents` alike.
    const shards = await this.db.collection('statsShards').listDocuments();
    writes.push(writer.set(this.shardRef('0'), counts));
    for (const shard of shards) if (shard.id !== '0') writes.push(writer.delete(shard));
    await writer.close();
    await Promise.all(writes);
    return counts;
  }

  async ping(): Promise<boolean> {
    await this.db.listCollections();
    return true;
  }

  private runRef(runId: string) {
    return this.db.collection('runs').doc(runId);
  }

  private sessionRef(sessionId: string) {
    return this.db.collection('sessions').doc(sessionId);
  }

  private shardRef(shard: string) {
    return this.db.collection('statsShards').doc(shard);
  }
}

/** A changed run as written: its `Run` fields without the ID, when its events arrived, and when it changed. */
function runFields({ run, receivedAt }: ChangedRun): Record<string, unknown> {
  const { runId: _, ...fields } = run;
  return {
    ...fields,
    ...Object.fromEntries(
      Object.entries(receivedAt).map(([type, at]) => [RECEIVED_AT_FIELD[type as AnalyticsEvent['type']], Timestamp.fromDate(at)])
    ),
    updatedAt: FieldValue.serverTimestamp()
  };
}

function toRun(snapshot: DocumentSnapshot): Run {
  const { updatedAt: _updated, startReceivedAt: _start, endReceivedAt: _end, ...data } = snapshot.data() as Omit<Run, 'runId'> & {
    updatedAt: unknown;
    startReceivedAt?: unknown;
    endReceivedAt?: unknown;
  };
  return { runId: snapshot.id, ...data };
}

/** The same nesting as `counts`, with every count as an atomic increment for a merging write. */
function increments(counts: Counts): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [key, typeof value === 'number' ? FieldValue.increment(value) : increments(value)])
  );
}
