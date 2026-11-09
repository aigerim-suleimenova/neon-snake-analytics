import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { LiveStatsSchema } from '@neon-snake/contract/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import { IngestionService } from '../services/IngestionService';
import { LiveStatsBroadcaster } from '../services/LiveStats';
import { StatsService } from '../services/StatsService';
import { endEvent, startEvent } from '../test/events';
import { createApp } from './createApp';

const GAME_ORIGIN = 'http://localhost:5173';
const clock = { now: () => new Date('2026-10-01T12:00:00.000Z') };
let server: Server | null = null;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = null;
});

async function start(options: { maxStreamsPerClient?: number } = {}) {
  const store = new InMemoryEventStore();
  const stats = new StatsService(store, { cacheMs: 0 });
  const live = new LiveStatsBroadcaster({
    read: async () => ({ overview: await stats.overview(), levels: await stats.levels() }),
    intervalMs: 20,
    ...options
  });
  const app = createApp({ ingestion: new IngestionService(store, clock), stats, health: store, live, allowedOrigins: [GAME_ORIGIN] });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, live, store };
}

/** Reads a stream's messages as they arrive, until `until` is satisfied. */
async function readEvents(response: Response, until: (events: Array<{ event: string; data: unknown }>) => boolean) {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: Array<{ event: string; data: unknown }> = [];
  let buffer = '';
  while (!until(events)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) events.push({ event, data: JSON.parse(data) });
    }
  }
  await reader.cancel();
  return events;
}

describe('GET /api/stats/stream', () => {
  it('streams the statistics in the shared schema at once and again when they change', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/api/stats/stream`, { headers: { Origin: 'http://localhost:5174' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const posted = fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([startEvent(), endEvent()])
    });
    const events = await readEvents(response, (received) => received.some((e) => (e.data as { overview?: { runs: number } }).overview?.runs === 1));
    await posted;

    expect(events[0]).toMatchObject({ event: 'stats', data: { overview: { runs: 0 } } });
    expect(events.at(-1)).toMatchObject({ event: 'stats', data: { overview: { runs: 1, finished: 1 } } });
    for (const { data } of events) expect(LiveStatsSchema.parse(data)).toEqual(data);
  });

  it('lets the dashboard read the stream cross-origin', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/api/stats/stream`, { headers: { Origin: GAME_ORIGIN } });

    expect(response.headers.get('access-control-allow-origin')).toBe(GAME_ORIGIN);
    await response.body?.cancel();
  });

  it('refuses a client beyond its stream limit with 429, and frees the place when a stream closes', async () => {
    const { base, live } = await start({ maxStreamsPerClient: 1 });
    const first = await fetch(`${base}/api/stats/stream`);

    const second = await fetch(`${base}/api/stats/stream`);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: { message: 'Too many open streams from this client' } });

    await first.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(live.size).toBe(0);
  });

  it('ends the open streams when the broadcaster closes, as on shutdown', async () => {
    const { base, live } = await start();
    const response = await fetch(`${base}/api/stats/stream`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();

    live.close();

    let done = false;
    while (!done) ({ done } = await reader.read());
    expect(done).toBe(true);
  });
});
