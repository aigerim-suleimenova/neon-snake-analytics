import type { AnalyticsEvent, EventSender } from './AnalyticsEvent';

export const MAX_PENDING_EVENTS = 100;
export const MAX_BATCH_EVENTS = 50;
export const REQUEST_TIMEOUT_MS = 5000;
export const INITIAL_RETRY_DELAY_MS = 1000;
export const MAX_RETRY_DELAY_MS = 30_000;
const JITTER = 0.2;
/** Largest base delay: the largest jitter takes it to exactly the cap, so delays there stay spread out. */
const MAX_RETRY_BASE_MS = MAX_RETRY_DELAY_MS / (1 + JITTER);

export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ status: number }>;

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HttpEventSenderDeps {
  url: string;
  fetch: FetchLike;
  /** `navigator.sendBeacon`: a string body goes out as `text/plain`, which needs no CORS preflight. */
  sendBeacon(url: string, body: string): boolean;
  timers: Timers;
  /** Subscribes to the page becoming hidden or being unloaded; returns the unsubscribe function. */
  onPageExit(listener: () => void): () => void;
  /** Random number in [0, 1), for the retry jitter. */
  random(): number;
}

/** A pending event is idle (waiting to be sent) or in flight (in exactly one request). */
interface Entry {
  event: AnalyticsEvent;
  inFlight: boolean;
}

const chunk = <Item>(items: readonly Item[], size: number): Item[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

const isRetryable = (status: number | null): boolean =>
  status === null || status === 408 || status === 429 || status >= 500;

/**
 * Sends each event to the backend at once and keeps it pending until the backend answers.
 * Network errors, timeouts, 408, 429 and 5xx are retried with backoff; any 2xx resolves the
 * events for good (events the backend lists as rejected included); other 4xx drop them.
 * When the page is hidden or unloaded, everything pending goes out with `sendBeacon`.
 * Late answers for events that left the pending list are ignored.
 */
export class HttpEventSender implements EventSender {
  private readonly pending = new Map<string, Entry>();
  private readonly requestTimers = new Set<unknown>();
  private readonly stopListening: () => void;
  private retryTimer: unknown = null;
  private retryBaseMs = INITIAL_RETRY_DELAY_MS;
  private disposed = false;

  constructor(private readonly deps: HttpEventSenderDeps) {
    this.stopListening = deps.onPageExit(() => this.handOverToBrowser());
  }

  send(event: AnalyticsEvent): void {
    if (this.disposed) return;
    if (this.pending.size >= MAX_PENDING_EVENTS) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    this.pending.set(event.eventId, { event, inFlight: false });
    // During backoff, new events wait for the next retry.
    if (this.retryTimer === null) this.postIdle();
  }

  /** Removes the page listeners and clears the timers. Not for page exit: the beacon needs the listener. */
  dispose(): void {
    this.disposed = true;
    this.stopListening();
    if (this.retryTimer !== null) this.deps.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.requestTimers.forEach((timer) => this.deps.timers.clearTimeout(timer));
    this.requestTimers.clear();
  }

  private postIdle(): void {
    const idle = [...this.pending.values()].filter((entry) => !entry.inFlight);
    for (const batch of chunk(idle, MAX_BATCH_EVENTS)) void this.post(batch);
  }

  private async post(batch: Entry[]): Promise<void> {
    batch.forEach((entry) => (entry.inFlight = true));
    const abort = new AbortController();
    const timer = this.deps.timers.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    this.requestTimers.add(timer);

    let status: number | null = null;
    try {
      const response = await this.deps.fetch(this.deps.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map((entry) => entry.event)),
        signal: abort.signal
      });
      status = response.status;
    } catch {
      // Network error or timeout: retried below.
    } finally {
      this.deps.timers.clearTimeout(timer);
      this.requestTimers.delete(timer);
    }
    if (this.disposed) return;

    // Events dropped by the pending limit or handed to a beacon meanwhile are no longer ours.
    const current = batch.filter((entry) => this.pending.get(entry.event.eventId) === entry);
    if (status !== null && status >= 200 && status < 300) {
      current.forEach((entry) => this.pending.delete(entry.event.eventId));
      this.retryBaseMs = INITIAL_RETRY_DELAY_MS;
    } else if (isRetryable(status)) {
      current.forEach((entry) => (entry.inFlight = false));
      if (current.length > 0) this.scheduleRetry();
    } else {
      current.forEach((entry) => this.pending.delete(entry.event.eventId));
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const jitter = 1 - JITTER + this.deps.random() * 2 * JITTER;
    // The base is capped below 30 s, so the jitter never pushes many clients onto the same 30 s delay.
    // The outer cap only guards against rounding.
    const delay = Math.min(MAX_RETRY_DELAY_MS, this.retryBaseMs * jitter);
    this.retryBaseMs = Math.min(MAX_RETRY_BASE_MS, this.retryBaseMs * 2);
    this.retryTimer = this.deps.timers.setTimeout(() => {
      this.retryTimer = null;
      this.postIdle();
    }, delay);
  }

  /** Hands every pending event, idle or in flight, to the browser before the page goes away. */
  private handOverToBrowser(): void {
    for (const batch of chunk([...this.pending.values()], MAX_BATCH_EVENTS)) {
      let queued = false;
      try {
        queued = this.deps.sendBeacon(this.deps.url, JSON.stringify(batch.map((entry) => entry.event)));
      } catch {
        // Treated like a refused beacon: the events stay pending.
      }
      if (queued) batch.forEach((entry) => this.pending.delete(entry.event.eventId));
    }
  }
}
