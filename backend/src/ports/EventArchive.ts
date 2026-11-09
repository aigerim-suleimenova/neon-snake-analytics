import type { ReceivedEvent } from './EventStore';

/**
 * Keeps every raw event for analysis, apart from the live statistics. Fed from the queue at least once, so
 * it may receive an event twice; readers remove duplicates by `eventId`.
 */
export interface EventArchive {
  /** Resolves once every event is durably kept; a rejection means the whole batch must be sent again. */
  write(events: readonly ReceivedEvent[]): Promise<void>;
}
