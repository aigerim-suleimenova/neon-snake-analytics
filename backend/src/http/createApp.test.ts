import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import type { EventQueue } from '../ports/EventQueue';
import type { EventStore } from '../ports/EventStore';
import { IngestionService } from '../services/IngestionService';
import { QueuedIngestionService } from '../services/QueuedIngestionService';
import { StatsService } from '../services/StatsService';
import { withQueueDeadline, withStoreDeadline } from '../services/storeDeadline';
import { endEvent, startEvent } from '../test/events';
import { createApp } from './createApp';

const clock = { now: () => new Date('2026-10-01T12:00:00.000Z') };
const GAME_ORIGIN = 'http://localhost:5173';
const never = () => new Promise<never>(() => {});

function setup<S extends EventStore = InMemoryEventStore>(store: S = new InMemoryEventStore() as EventStore as S, logError = vi.fn()) {
  const app = createApp({
    ingestion: new IngestionService(store, clock),
    stats: new StatsService(store),
    health: store,
    allowedOrigins: [GAME_ORIGIN],
    logError
  });
  return { app, store, logError };
}

/** A store that misses every deadline, as when the emulator hangs. */
const hangingStore = () => withStoreDeadline({ saveEvent: never, saveEvents: never, readStats: never, ping: never }, 20);

describe('POST /api/events', () => {
  it('stores a JSON batch and answers 202 with the summary', async () => {
    const { app, store } = setup();

    const res = await request(app).post('/api/events').send([startEvent()]);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
    expect(await store.listRuns()).toHaveLength(1);
  });

  it('accepts a text/plain body as sent by sendBeacon', async () => {
    const { app, store } = setup();

    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify([startEvent(), endEvent()]));

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    expect(await store.listRuns()).toEqual([expect.objectContaining({ status: 'fail' })]);
  });

  it('stores a post from an allowed origin', async () => {
    const { app } = setup();

    const res = await request(app).post('/api/events').set('Origin', GAME_ORIGIN).send([startEvent()]);

    expect(res.status).toBe(202);
  });

  it('answers 403 and stores nothing for a beacon from another origin', async () => {
    const { app, store } = setup();

    const res = await request(app)
      .post('/api/events')
      .set('Origin', 'https://evil.example')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify([startEvent()]));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { message: 'Origin is not allowed' } });
    expect(await store.listRuns()).toEqual([]);
  });

  it('answers 429 with Retry-After and stores nothing once a client posts too often', async () => {
    const store = new InMemoryEventStore();
    const app = createApp({
      ingestion: new IngestionService(store, clock),
      stats: new StatsService(store),
      health: store,
      allowedOrigins: [GAME_ORIGIN],
      eventsRateLimit: { burst: 1, perSecond: 1, now: () => 0 }
    });
    await request(app).post('/api/events').set('Origin', GAME_ORIGIN).send([startEvent()]);

    const res = await request(app).post('/api/events').set('Origin', GAME_ORIGIN).send([endEvent()]);

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('1');
    // The game reads the status cross-origin, so the CORS headers must be on the 429 too.
    expect(res.headers['access-control-allow-origin']).toBe(GAME_ORIGIN);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await store.listRuns()).toEqual([expect.objectContaining({ status: 'unfinished' })]);
  });

  it('limits the statistics and the health check per client IP, apart from the events and each other', async () => {
    const store = new InMemoryEventStore();
    const app = createApp({
      ingestion: new IngestionService(store, clock),
      stats: new StatsService(store),
      health: store,
      allowedOrigins: [GAME_ORIGIN],
      eventsRateLimit: { burst: 1, perSecond: 1, now: () => 0 },
      readsRateLimit: { burst: 2, perSecond: 1, now: () => 0 }
    });
    expect((await request(app).post('/api/events').send([startEvent()])).status).toBe(202);

    // The two statistics routes share one count, as a dashboard Refresh asks for both.
    expect((await request(app).get('/api/stats/overview')).status).toBe(200);
    expect((await request(app).get('/api/stats/levels')).status).toBe(200);
    const limited = await request(app).get('/api/stats/overview');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('1');
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('counts clients by the address the trusted proxy forwarded', async () => {
    const store = new InMemoryEventStore();
    const app = createApp({
      ingestion: new IngestionService(store, clock),
      stats: new StatsService(store),
      health: store,
      allowedOrigins: [GAME_ORIGIN],
      readsRateLimit: { burst: 1, perSecond: 1, now: () => 0 },
      trustProxy: 1
    });
    const get = (client: string) => request(app).get('/api/health').set('X-Forwarded-For', client);

    expect((await get('203.0.113.1')).status).toBe(200);
    expect((await get('203.0.113.1')).status).toBe(429);
    expect((await get('203.0.113.2')).status).toBe(200);
  });

  it('ignores X-Forwarded-For unless a proxy is trusted, so a client cannot pick its own IP', async () => {
    const store = new InMemoryEventStore();
    const app = createApp({
      ingestion: new IngestionService(store, clock),
      stats: new StatsService(store),
      health: store,
      allowedOrigins: [GAME_ORIGIN],
      readsRateLimit: { burst: 1, perSecond: 1, now: () => 0 }
    });

    expect((await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.1')).status).toBe(200);
    expect((await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.2')).status).toBe(429);
  });

  it('lists invalid events and conflicts in rejected', async () => {
    const { app } = setup();
    await request(app).post('/api/events').send([startEvent()]);

    const res = await request(app)
      .post('/api/events')
      .send([startEvent(), endEvent({ level: 2 }), startEvent({ eventId: 'x', runId: 'r2', level: 0 })]);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      accepted: 0,
      duplicates: 1,
      rejected: [
        { index: 1, errors: ['level: run r1 is on level 1'] },
        { index: 2, errors: ['level: must be a positive integer'] }
      ]
    });
  });

  it.each([
    ['a single object', JSON.stringify(startEvent())],
    ['an empty array', '[]'],
    ['51 events', JSON.stringify(Array.from({ length: 51 }, (_, i) => startEvent({ eventId: `e${i}`, runId: `r${i}` })))]
  ])('answers 400 for %s and stores nothing', async (_, body) => {
    const { app, store } = setup();

    const res = await request(app).post('/api/events').set('Content-Type', 'application/json').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: 'Body must be a JSON array of 1 to 50 events' } });
    expect(await store.listRuns()).toEqual([]);
  });

  it.each(['application/json', 'text/plain'])('answers 400 for invalid JSON sent as %s', async (type) => {
    const { app } = setup();

    const res = await request(app).post('/api/events').set('Content-Type', type).send('[{"eventId":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: 'Body must be valid JSON' } });
  });

  it('answers 400 for a body that is not JSON or text', async () => {
    const { app } = setup();

    const res = await request(app).post('/api/events').set('Content-Type', 'application/xml').send('<events/>');

    expect(res.status).toBe(400);
  });

  it.each(['application/json', 'text/plain'])('answers 413 for a %s body over 100 kB', async (type) => {
    const { app, store } = setup();
    const body = JSON.stringify([startEvent({ padding: 'x'.repeat(101 * 1024) })]);

    const res = await request(app).post('/api/events').set('Content-Type', type).send(body);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: { message: 'Body must not exceed 100 kB' } });
    expect(await store.listRuns()).toEqual([]);
  });

  it('answers 503 when the store misses its deadline', async () => {
    const { app } = setup(hangingStore());

    const res = await request(app).post('/api/events').send([startEvent()]);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { message: 'Storage is unavailable, try again later' } });
  });

  it('answers 500 without internals for an unexpected error and logs it', async () => {
    const failure = new Error('disk on fire');
    const store: EventStore = { saveEvent: () => Promise.reject(failure), saveEvents: never, readStats: never, ping: never };
    const { app, logError } = setup(store);

    const res = await request(app).post('/api/events').send([startEvent()]);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
    expect(logError).toHaveBeenCalledWith(failure);
  });
});

describe('POST /api/events with a queue', () => {
  function setupQueued(queue: EventQueue) {
    const store = new InMemoryEventStore();
    const app = createApp({
      ingestion: new QueuedIngestionService(queue, clock),
      stats: new StatsService(store),
      health: store,
      allowedOrigins: [GAME_ORIGIN]
    });
    return { app, store };
  }

  it('queues the events, answers 202 and leaves storing them to the worker', async () => {
    const queue = { publish: vi.fn(async () => {}) };
    const { app, store } = setupQueued(queue);

    const res = await request(app).post('/api/events').send([startEvent()]);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
    expect(queue.publish).toHaveBeenCalledOnce();
    expect(await store.listRuns()).toEqual([]);
  });

  it('answers 503 when the broker misses its deadline, so the game resends', async () => {
    const { app } = setupQueued(withQueueDeadline({ publish: never }, 20));

    const res = await request(app).post('/api/events').send([startEvent()]);

    expect(res.status).toBe(503);
  });
});

describe('GET /api/stats', () => {
  it('serves the overview and the levels', async () => {
    const { app } = setup();
    await request(app).post('/api/events').send([startEvent(), endEvent()]);

    const overview = await request(app).get('/api/stats/overview');
    const levels = await request(app).get('/api/stats/levels');

    expect(overview.status).toBe(200);
    expect(overview.body).toEqual({
      sessions: 1,
      runs: 1,
      finished: 1,
      unfinished: 0,
      completionRate: 0,
      runsPerSession: 1
    });
    expect(levels.status).toBe(200);
    expect(levels.body).toEqual({
      levels: [
        {
          level: 1,
          outcomes: { complete: 0, fail: 1, quit: 0, unfinished: 0 },
          completionRate: 0,
          averageDurationMs: 9000,
          failedByProgress: { '0-19': 0, '20-39': 0, '40-59': 1, '60-79': 0, '80-99': 0 },
          failedByReason: { wall: 1, snake: 0, obstacle: 0, external: 0 }
        }
      ]
    });
  });

  it.each(['/api/stats/overview', '/api/stats/levels'])('answers 503 on %s when the store misses its deadline', async (path) => {
    const { app } = setup(hangingStore());

    const res = await request(app).get(path);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { message: 'Storage is unavailable, try again later' } });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each(['/api/stats/overview', '/api/stats/levels'])(
    'lets %s be cached only after checking with the server, which reads the store at most once a second',
    async (path) => {
      let time = 0;
      const store = new InMemoryEventStore();
      const app = createApp({
        ingestion: new IngestionService(store, clock),
        stats: new StatsService(store, { now: () => time }),
        health: store,
        allowedOrigins: [GAME_ORIGIN]
      });
      await request(app).post('/api/events').send([startEvent()]);

      const first = await request(app).get(path);
      await request(app).post('/api/events').send([endEvent()]);
      time = 999;
      const withinASecond = await request(app).get(path).set('If-None-Match', first.headers.etag);
      time = 2000;
      const later = await request(app).get(path).set('If-None-Match', first.headers.etag);

      expect(first.headers['cache-control']).toBe('no-cache');
      expect(first.headers.etag).toBeDefined();
      expect(withinASecond.status).toBe(304);
      expect(later.status).toBe(200);
    }
  );
});

describe('GET /api/health', () => {
  it('answers 200 when the store is reachable', async () => {
    const res = await request(setup().app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers 503 when the store misses its deadline', async () => {
    const res = await request(setup(hangingStore()).app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { message: 'Storage is unavailable' } });
  });

  it('answers 503 when the store reports it is unreachable', async () => {
    const store = new InMemoryEventStore();
    vi.spyOn(store, 'ping').mockResolvedValue(false);

    expect((await request(setup(store).app).get('/api/health')).status).toBe(503);
  });
});

describe('errors and CORS', () => {
  it('answers 404 in the error format for unknown routes', async () => {
    const res = await request(setup().app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { message: 'Not found' } });
  });

  it.each([
    ['POST /api/events', (app: ReturnType<typeof setup>['app']) => request(app).post('/api/events').send([startEvent()])],
    ['GET /api/health', (app: ReturnType<typeof setup>['app']) => request(app).get('/api/health')],
    ['an unknown route', (app: ReturnType<typeof setup>['app']) => request(app).get('/api/nope')]
  ])('marks %s as not cacheable', async (_, send) => {
    const res = await send(setup().app);

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sends security headers on every answer', async () => {
    const app = setup().app;

    for (const res of [await request(app).get('/api/health'), await request(app).get('/api/nope')]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('lets an allowed origin read responses', async () => {
    const res = await request(setup().app).get('/api/health').set('Origin', GAME_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(GAME_ORIGIN);
    expect(res.headers.vary).toContain('Origin');
  });

  it('answers the preflight for a JSON post from an allowed origin', async () => {
    const res = await request(setup().app)
      .options('/api/events')
      .set('Origin', GAME_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(GAME_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toMatch(/content-type/i);
  });

  it('gives a disallowed origin no CORS headers, so the browser hides the response', async () => {
    const app = setup().app;

    const get = await request(app).get('/api/stats/overview').set('Origin', 'https://evil.example');
    const preflight = await request(app)
      .options('/api/events')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(get.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-methods']).toBeUndefined();
  });
});
