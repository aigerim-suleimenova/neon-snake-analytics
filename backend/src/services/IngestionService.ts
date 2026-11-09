import type { Clock } from '../ports/Clock';
import type { EventStore } from '../ports/EventStore';
import { validateEvent } from '@neon-snake/contract/schemas';

export interface Rejection {
  index: number;
  errors: string[];
}

export interface IngestionResult {
  accepted: number;
  duplicates: number;
  rejected: Rejection[];
}

/** Checks a batch of incoming events and stores the valid ones. */
export class IngestionService {
  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock
  ) {}

  /**
   * Saves the events one at a time, in array order, so a run's start and end in one batch never race
   * and a repeated event ID counts as a duplicate. A store error, such as `StoreUnavailable`, stops the
   * batch and is passed on; events saved before it stay saved, which is safe because a resend is a duplicate.
   */
  async ingest(batch: readonly unknown[]): Promise<IngestionResult> {
    const now = this.clock.now();
    const result: IngestionResult = { accepted: 0, duplicates: 0, rejected: [] };

    for (const [index, input] of batch.entries()) {
      const validation = validateEvent(input, now);
      if (!validation.ok) {
        result.rejected.push({ index, errors: validation.errors });
        continue;
      }

      const saved = await this.store.saveEvent(validation.event, now);
      if (saved === 'stored') result.accepted += 1;
      else if (saved === 'duplicate') result.duplicates += 1;
      else result.rejected.push({ index, errors: [saved.conflict] });
    }

    return result;
  }
}
