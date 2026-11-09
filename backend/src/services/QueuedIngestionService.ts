import type { Clock } from '../ports/Clock';
import type { EventQueue } from '../ports/EventQueue';
import type { AnalyticsEvent } from '@neon-snake/contract';
import { validateEvent } from '@neon-snake/contract/schemas';
import type { IngestionResult } from './IngestionService';

/**
 * Checks a batch of incoming events and puts the valid ones on the queue, without touching the store.
 * The ingestion worker stores them later, so duplicates and run conflicts are found there, not here:
 * `accepted` counts queued events and `duplicates` is always 0.
 */
export class QueuedIngestionService {
  constructor(
    private readonly queue: EventQueue,
    private readonly clock: Clock
  ) {}

  /** A queue error, such as `StoreUnavailable`, is passed on; part of the batch may be queued anyway, so a resend is a duplicate. */
  async ingest(batch: readonly unknown[]): Promise<IngestionResult> {
    const now = this.clock.now();
    const result: IngestionResult = { accepted: 0, duplicates: 0, rejected: [] };
    const valid: AnalyticsEvent[] = [];

    for (const [index, input] of batch.entries()) {
      const validation = validateEvent(input, now);
      if (validation.ok) valid.push(validation.event);
      else result.rejected.push({ index, errors: validation.errors });
    }

    if (valid.length > 0) await this.queue.publish(valid);
    result.accepted = valid.length;
    return result;
  }
}
