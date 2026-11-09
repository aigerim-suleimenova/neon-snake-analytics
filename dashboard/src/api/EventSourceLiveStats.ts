import { LiveStatsSchema } from '@neon-snake/contract/schemas';

import type { LiveHandlers, LiveStatsSource } from './LiveStatsSource';

/** The part of the browser's EventSource used here, so tests can drive it. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export interface EventSourceLiveStatsOptions {
  /** e.g. http://localhost:3000/api/stats/stream */
  url: string;
  createEventSource: (url: string) => EventSourceLike;
  /** After the server refuses a stream (429, 503), how long until live updates are tried again. */
  retryAfterMs?: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** EventSource.CLOSED: the browser gave up and will not reconnect on its own. */
const CLOSED = 2;

/**
 * LiveStatsSource on Server-Sent Events. The browser reconnects a dropped stream by itself (status `connecting`,
 * then `live` again). When the server refuses a stream outright, the browser stops; this then reports `off`, so the
 * dashboard falls back to Refresh, and tries again after `retryAfterMs`. Every message is checked against the
 * shared schema; one that does not match counts as unavailable statistics.
 */
export class EventSourceLiveStats implements LiveStatsSource {
  private readonly retryAfterMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: EventSourceLiveStatsOptions) {
    this.retryAfterMs = options.retryAfterMs ?? 30_000;
    this.setTimer = options.setTimeout ?? ((callback, ms) => window.setTimeout(callback, ms));
    this.clearTimer = options.clearTimeout ?? ((handle) => window.clearTimeout(handle as number));
  }

  connect(handlers: LiveHandlers): () => void {
    let source: EventSourceLike | null = null;
    let retry: unknown = null;
    let stopped = false;

    const open = () => {
      handlers.onStatus('connecting');
      const current = this.options.createEventSource(this.options.url);
      source = current;
      current.addEventListener('open', () => handlers.onStatus('live'));
      current.addEventListener('stats', (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return handlers.onUnavailable();
        }
        const parsed = LiveStatsSchema.safeParse(data);
        if (parsed.success) handlers.onStats(parsed.data);
        else handlers.onUnavailable();
      });
      current.addEventListener('unavailable', () => handlers.onUnavailable());
      current.addEventListener('error', () => {
        if (current.readyState !== CLOSED) return handlers.onStatus('connecting');
        current.close();
        handlers.onStatus('off');
        if (!stopped) retry = this.setTimer(open, this.retryAfterMs);
      });
    };

    open();
    return () => {
      stopped = true;
      if (retry !== null) this.clearTimer(retry);
      source?.close();
    };
  }
}
