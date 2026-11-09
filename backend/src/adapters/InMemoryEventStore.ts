import type { AnalyticsEvent } from '@neon-snake/contract';
import { MAX_EVENTS_PER_BATCH, type EventStore, type ReceivedEvent, type Run, type SaveResult } from '../ports/EventStore';
import { applyBatch } from '../services/eventBatch';
import { addCounts, toStatsCounts, type Counts, type StatsCounts } from '../services/statsCounts';

export type StoredEvent = ReceivedEvent;

/**
 * EventStore kept in memory, for tests and for running without the emulator. Applies events through the
 * same `applyBatch` as FirestoreEventStore, so both find duplicates and conflicts alike.
 */
export class InMemoryEventStore implements EventStore {
  /** What was stored, in order, for tests to inspect; not used to find duplicates. */
  private readonly stored: StoredEvent[] = [];
  private readonly runs = new Map<string, Run>();
  private readonly sessions = new Set<string>();
  private readonly counts: Counts = {};
  /** The counter shard each batch's change went to, in order, for tests. */
  readonly counterShards: string[] = [];

  async saveEvent(event: AnalyticsEvent, receivedAt: Date): Promise<SaveResult> {
    const [result] = await this.saveEvents([{ event, receivedAt }], '0');
    return result;
  }

  async saveEvents(events: readonly ReceivedEvent[], counterShard: string): Promise<SaveResult[]> {
    if (events.length > MAX_EVENTS_PER_BATCH) throw new RangeError(`At most ${MAX_EVENTS_PER_BATCH} events per batch`);
    const outcome = applyBatch(events, this.runs, this.sessions);

    for (const [runId, { run }] of outcome.changedRuns) this.runs.set(runId, run);
    for (const sessionId of outcome.newSessions.keys()) this.sessions.add(sessionId);
    events.forEach((received, index) => outcome.results[index] === 'stored' && this.stored.push(received));
    if (Object.keys(outcome.countChange).length > 0) {
      addCounts(this.counts, outcome.countChange);
      this.counterShards.push(counterShard);
    }
    return outcome.results;
  }

  async readStats(): Promise<StatsCounts> {
    return toStatsCounts(this.counts);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async listRuns(): Promise<Run[]> {
    return [...this.runs.values()];
  }

  storedEvents(): StoredEvent[] {
    return [...this.stored];
  }
}
