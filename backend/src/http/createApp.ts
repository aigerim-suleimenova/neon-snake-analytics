import express, { type ErrorRequestHandler, type Response } from 'express';
import helmet from 'helmet';
import { MAX_BATCH_EVENTS } from '@neon-snake/contract';
import type { IngestionService } from '../services/IngestionService';
import type { LiveStatsBroadcaster } from '../services/LiveStats';
import type { StatsService } from '../services/StatsService';
import { StoreUnavailable } from '../services/storeDeadline';
import { cors, rejectOtherOrigins } from './cors';
import { EVENTS_RATE_LIMIT, READS_RATE_LIMIT, rateLimit, type RateLimitOptions } from './rateLimit';

const BODY_LIMIT_KB = 100;
const BODY_LIMIT = `${BODY_LIMIT_KB}kb`;

export interface AppDeps {
  ingestion: Pick<IngestionService, 'ingest'>;
  stats: Pick<StatsService, 'overview' | 'levels'>;
  health: { ping(): Promise<boolean> };
  /** Serves `GET /api/stats/stream` when given. */
  live?: Pick<LiveStatsBroadcaster, 'admit' | 'subscribe'>;
  allowedOrigins: readonly string[];
  /** Limit per client IP on `POST /api/events`; defaults to `EVENTS_RATE_LIMIT`. */
  eventsRateLimit?: RateLimitOptions;
  /** Limit per client IP on the statistics, and separately on the health check; defaults to `READS_RATE_LIMIT`. */
  readsRateLimit?: RateLimitOptions;
  /**
   * Express's `trust proxy`: which proxies' `X-Forwarded-For` entries to believe for the client IP the rate
   * limits count by. Behind a load balancer without it, every client has the balancer's IP and shares one limit.
   */
  trustProxy?: number | string | false;
  logError?: (error: unknown) => void;
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { message } });
}

/** Statistics may be kept by the browser but are checked on every request, so Refresh always shows current data. */
function sendStats(res: Response, body: unknown): void {
  res.set('Cache-Control', 'no-cache').json(body);
}

/** The HTTP layer only: parsing, routes, security headers, CORS and mapping errors to status codes. */
export function createApp({
  ingestion,
  stats,
  health,
  live,
  allowedOrigins,
  eventsRateLimit = EVENTS_RATE_LIMIT,
  readsRateLimit = READS_RATE_LIMIT,
  trustProxy = false,
  logError = console.error
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  // Express's default, set explicitly: the statistics' no-cache relies on it for 304 answers.
  app.set('etag', 'weak');
  app.use(
    helmet({
      // The API only answers JSON: no page may load anything from it or frame it.
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      // Who may read responses is decided by the CORS allowlist below, not by this header.
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );
  app.use(cors(allowedOrigins));
  // Nothing is cached unless a route allows it; errors and event answers never are.
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.post(
    '/api/events',
    // Both before parsing, so a rejected post's body is never read.
    rateLimit(eventsRateLimit),
    rejectOtherOrigins(allowedOrigins),
    express.json({ limit: BODY_LIMIT }),
    // navigator.sendBeacon posts text/plain to avoid a preflight; the body is still JSON.
    express.text({ type: 'text/plain', limit: BODY_LIMIT }),
    async (req, res) => {
      let batch: unknown = req.body;
      if (typeof batch === 'string') {
        try {
          batch = JSON.parse(batch);
        } catch {
          return sendError(res, 400, 'Body must be valid JSON');
        }
      }
      if (!Array.isArray(batch) || batch.length === 0 || batch.length > MAX_BATCH_EVENTS) {
        return sendError(res, 400, `Body must be a JSON array of 1 to ${MAX_BATCH_EVENTS} events`);
      }
      res.status(202).json(await ingestion.ingest(batch));
    }
  );

  // One limiter for both statistics routes, as a dashboard Refresh asks for both.
  const statsLimit = rateLimit(readsRateLimit);
  app.get('/api/stats/overview', statsLimit, async (_req, res) => {
    sendStats(res, await stats.overview());
  });

  app.get('/api/stats/levels', statsLimit, async (_req, res) => {
    sendStats(res, { levels: await stats.levels() });
  });

  // Server-Sent Events: the statistics on connect and on every change. The read limit counts opening a stream.
  if (live) {
    app.get('/api/stats/stream', statsLimit, (req, res) => {
      const client = req.ip ?? 'unknown';
      const refusal = live.admit(client);
      if (refusal === 'client-limit') return sendError(res, 429, 'Too many open streams from this client');
      if (refusal === 'full') {
        res.set('Retry-After', '5');
        return sendError(res, 503, 'Too many open streams, try again later');
      }
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        // Proxies such as nginx must not hold back the messages.
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      const unsubscribe = live.subscribe(client, { write: (chunk) => res.write(chunk), end: () => res.end() }, req.get('Last-Event-ID'));
      res.on('close', unsubscribe);
    });
  }

  // Its own count, so a busy dashboard never makes a load balancer's health probe fail.
  app.get('/api/health', rateLimit(readsRateLimit), async (_req, res) => {
    const reachable = await health.ping().catch(() => false);
    if (reachable) res.json({ status: 'ok' });
    else sendError(res, 503, 'Storage is unavailable');
  });

  app.use((_req, res) => sendError(res, 404, 'Not found'));

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof StoreUnavailable) return sendError(res, 503, 'Storage is unavailable, try again later');
    if (error?.type === 'entity.too.large') return sendError(res, 413, `Body must not exceed ${BODY_LIMIT_KB} kB`);
    if (error?.type === 'entity.parse.failed') return sendError(res, 400, 'Body must be valid JSON');
    logError(error);
    sendError(res, 500, 'Internal server error');
  };
  app.use(handleError);

  return app;
}
