import type { AnalyticsEvent } from '@neon-snake/contract';

/** A durable queue between receiving events and storing them. */
export interface EventQueue {
  /** Resolves once every event is stored durably in the queue. Delivery downstream is at least once. */
  publish(events: readonly AnalyticsEvent[]): Promise<void>;
}
