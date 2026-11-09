import { validateEvent } from '@neon-snake/contract/schemas';
import type { EventArchive } from '../ports/EventArchive';
import type { EventStore, ReceivedEvent, SaveResult } from '../ports/EventStore';

export interface QueuedMessage {
  /** One event as JSON; null for an empty message. */
  value: string | null;
  /** When the API put the event on the queue: stored as the event's `receivedAt`. */
  queuedAt: Date;
}

/** The counter document a partition's worker writes; only that worker writes it, so it never contends. */
export const partitionShard = (partition: number): string => `partition-${partition}`;

/**
 * Turns queued messages into events, logging and leaving out each one that is not JSON or not a valid
 * event: such a message can never be stored, so it must not block the queue. `positions[i]` is the index in
 * `messages` of `events[i]`.
 */
export function parseQueuedBatch(
  messages: readonly QueuedMessage[],
  logError: (message: string) => void
): { events: ReceivedEvent[]; positions: number[] } {
  const events: ReceivedEvent[] = [];
  const positions: number[] = [];
  messages.forEach((message, index) => {
    let input: unknown;
    try {
      input = JSON.parse(message.value ?? '');
    } catch {
      logError(`Skipped a queued message that is not JSON: ${message.value}`);
      return;
    }
    // The API checked it already; checked again because anyone with access to the topic can write to it.
    const validation = validateEvent(input, message.queuedAt);
    if (!validation.ok) {
      logError(`Skipped an invalid queued event: ${validation.errors.join('; ')}`);
      return;
    }
    events.push({ event: validation.event, receivedAt: message.queuedAt });
    positions.push(index);
  });
  return { events, positions };
}

/**
 * Stores a batch of messages taken from one queue partition, in one store transaction whose combined
 * count change goes to that partition's counter document. Delivery is at least once, so a redelivered
 * event is a duplicate and changes nothing. Messages `parseQueuedBatch` leaves out, and events in conflict
 * with their run, are logged and skipped. A store error is passed on, so the batch is not committed and
 * comes back. At most `MAX_EVENTS_PER_BATCH` messages.
 */
export async function storeQueuedBatch(
  store: Pick<EventStore, 'saveEvents'>,
  messages: readonly QueuedMessage[],
  partition: number,
  logError: (message: string) => void
): Promise<Array<SaveResult | 'skipped'>> {
  const results: Array<SaveResult | 'skipped'> = messages.map(() => 'skipped');
  const { events, positions } = parseQueuedBatch(messages, logError);
  if (events.length === 0) return results;

  const saved = await store.saveEvents(events, partitionShard(partition));
  saved.forEach((result, index) => {
    results[positions[index]] = result;
    if (typeof result === 'object') logError(`Skipped queued event ${events[index].event.eventId}: ${result.conflict}`);
  });
  return results;
}

/**
 * Archives a batch of queued messages, leaving out (and logging) those `parseQueuedBatch` rejects. An archive
 * error is passed on, so the batch is not committed and comes back; the archive may then see events twice.
 */
export async function archiveQueuedBatch(
  archive: EventArchive,
  messages: readonly QueuedMessage[],
  logError: (message: string) => void
): Promise<number> {
  const { events } = parseQueuedBatch(messages, logError);
  await archive.write(events);
  return events.length;
}
