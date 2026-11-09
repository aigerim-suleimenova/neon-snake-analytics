import type { AnalyticsEvent } from '@neon-snake/contract';

export { SCHEMA_VERSION, type AnalyticsEvent, type RunEndedEvent, type RunStartedEvent } from '@neon-snake/contract';

/** Delivers analytics events. Never blocks or throws into gameplay. */
export interface EventSender {
  send(event: AnalyticsEvent): void;
}

/** Used when no backend URL is configured: analytics is off. */
export class NoopEventSender implements EventSender {
  send(): void {}
}
