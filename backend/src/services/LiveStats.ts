import { createHash } from 'node:crypto';
import type { LiveStats } from '@neon-snake/contract';

/** How often the statistics are checked for changes while anyone is watching: as often as the read cache expires. */
export const LIVE_INTERVAL_MS = 1000;
/** A comment line this often keeps proxies and load balancers from closing a quiet stream. */
export const KEEP_ALIVE_MS = 20_000;
/** How long a browser waits before reconnecting a dropped stream. */
export const RECONNECT_MS = 3000;
export const MAX_STREAMS = 1000;
export const MAX_STREAMS_PER_CLIENT = 5;

export interface LiveTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface LiveStatsOptions {
  /** Both statistics from one read; the cached StatsService, so watching costs no extra store reads. */
  read: () => Promise<LiveStats>;
  timers?: LiveTimers;
  intervalMs?: number;
  keepAliveMs?: number;
  maxStreams?: number;
  maxStreamsPerClient?: number;
  logError?: (error: unknown) => void;
}

/** Why a new stream is refused: the client has too many open, or this instance is full. */
export type Refusal = 'client-limit' | 'full';

/** Where a stream's messages go, and how it is ended from the server side. */
export interface StreamSink {
  write(chunk: string): void;
  end(): void;
}

interface Stream extends StreamSink {
  client: string;
}

const message = (event: string, data: unknown, id?: string): string =>
  `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Pushes the statistics to every open stream (Server-Sent Events). One loop per instance reads them once per
 * interval, only while at least one stream is open, and sends them only when they changed, so the store sees the
 * same reads however many dashboards watch, and quiet periods send nothing but keep-alives. Each message's ID is
 * a hash of its data: a browser reconnecting with that ID as `Last-Event-ID` is not sent the same data again.
 * A failed read sends one `unavailable` event and keeps the streams open; the next good read recovers them.
 */
export class LiveStatsBroadcaster {
  private readonly streams = new Set<Stream>();
  private readonly read: () => Promise<LiveStats>;
  private readonly timers: LiveTimers;
  private readonly intervalMs: number;
  private readonly keepAliveMs: number;
  private readonly maxStreams: number;
  private readonly maxStreamsPerClient: number;
  private readonly logError: (error: unknown) => void;

  private latest: { id: string; chunk: string } | null = null;
  private unavailable = false;
  private reading = false;
  private poll: unknown = null;
  private keepAlive: unknown = null;
  private closed = false;

  constructor({
    read,
    timers = { setInterval: (callback, ms) => setInterval(callback, ms), clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout) },
    intervalMs = LIVE_INTERVAL_MS,
    keepAliveMs = KEEP_ALIVE_MS,
    maxStreams = MAX_STREAMS,
    maxStreamsPerClient = MAX_STREAMS_PER_CLIENT,
    logError = console.error
  }: LiveStatsOptions) {
    this.read = read;
    this.timers = timers;
    this.intervalMs = intervalMs;
    this.keepAliveMs = keepAliveMs;
    this.maxStreams = maxStreams;
    this.maxStreamsPerClient = maxStreamsPerClient;
    this.logError = logError;
  }

  get size(): number {
    return this.streams.size;
  }

  /** Whether a new stream from `client` would be accepted; ask before sending any headers. */
  admit(client: string): Refusal | null {
    if (this.closed || this.streams.size >= this.maxStreams) return 'full';
    let open = 0;
    for (const stream of this.streams) if (stream.client === client) open += 1;
    return open >= this.maxStreamsPerClient ? 'client-limit' : null;
  }

  /**
   * Opens a stream: tells the browser how soon to reconnect, sends the current statistics unless it already has
   * them (`lastEventId`), and from then on every change. Returns the function that closes it.
   */
  subscribe(client: string, sink: StreamSink, lastEventId?: string): () => void {
    const stream: Stream = { client, write: (chunk) => sink.write(chunk), end: () => sink.end() };
    this.streams.add(stream);
    stream.write(`retry: ${RECONNECT_MS}\n\n`);
    if (this.latest && this.latest.id !== lastEventId) stream.write(this.latest.chunk);
    this.start();
    if (!this.latest) void this.check();
    return () => {
      this.streams.delete(stream);
      if (this.streams.size === 0) this.stop();
    };
  }

  /** Ends every stream and stops, as on shutdown; browsers reconnect to another instance. */
  close(): void {
    this.closed = true;
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    this.stop();
  }

  /** Reads the statistics and sends them if they changed; one read at a time. */
  async check(): Promise<void> {
    if (this.reading || this.streams.size === 0) return;
    this.reading = true;
    try {
      const stats = await this.read();
      const data = JSON.stringify(stats);
      const id = createHash('sha256').update(data).digest('base64url').slice(0, 16);
      if (id === this.latest?.id && !this.unavailable) return;
      this.latest = { id, chunk: `id: ${id}\nevent: stats\ndata: ${data}\n\n` };
      this.unavailable = false;
      this.broadcast(this.latest.chunk);
    } catch (error) {
      if (!this.unavailable) {
        this.logError(error);
        this.unavailable = true;
        this.broadcast(message('unavailable', { message: 'Statistics are unavailable, retrying' }));
      }
    } finally {
      this.reading = false;
    }
  }

  private broadcast(chunk: string): void {
    for (const stream of this.streams) stream.write(chunk);
  }

  private start(): void {
    if (this.poll !== null) return;
    this.poll = this.timers.setInterval(() => void this.check(), this.intervalMs);
    this.keepAlive = this.timers.setInterval(() => this.broadcast(': keep-alive\n\n'), this.keepAliveMs);
  }

  private stop(): void {
    if (this.poll !== null) this.timers.clearInterval(this.poll);
    if (this.keepAlive !== null) this.timers.clearInterval(this.keepAlive);
    this.poll = null;
    this.keepAlive = null;
    // Nobody watched meanwhile, so the next stream must not start from old data: it triggers a fresh read.
    this.latest = null;
    this.unavailable = false;
  }
}
