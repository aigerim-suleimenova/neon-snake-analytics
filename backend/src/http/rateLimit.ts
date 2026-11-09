import type { RequestHandler } from 'express';

export interface RateLimitOptions {
  /** Requests a client may send at once, after being idle. */
  burst: number;
  /** Requests per second a client may keep sending. */
  perSecond: number;
  /** Milliseconds since some fixed point; injected for tests. */
  now?: () => number;
}

/** A game sends an event per run start and end, so 1 per second with bursts of 60 is far above play. */
export const EVENTS_RATE_LIMIT: RateLimitOptions = { burst: 60, perSecond: 1 };

/**
 * For the statistics and the health check, each counted on its own. A dashboard Refresh is two requests and
 * a health probe one every few seconds; both read Firestore, so a flood of them must not reach it.
 */
export const READS_RATE_LIMIT: RateLimitOptions = { burst: 30, perSecond: 2 };

/**
 * One instance's share of a limit meant for all `instances` together. Each instance counts only the requests
 * it receives, so without this the total allowed would grow with every instance added. The burst never drops
 * below 1, so a client is never refused outright.
 */
export function shareOf(limit: RateLimitOptions, instances: number): RateLimitOptions {
  return { ...limit, burst: Math.max(1, Math.ceil(limit.burst / instances)), perSecond: limit.perSecond / instances };
}

/** Above this many tracked clients, the ones whose bucket has refilled are forgotten. */
const MAX_TRACKED_CLIENTS = 10_000;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token bucket per client IP, kept in this process's memory: each request takes a token, tokens refill
 * at `perSecond` up to `burst`. Without a token the request is answered `429` with `Retry-After`,
 * before its body is read. Several API instances would each count separately, so production limits belong
 * at the edge (e.g. Cloud Armor), with this as a last line of defence.
 */
export function rateLimit({ burst, perSecond, now = () => performance.now() }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  const refill = (bucket: Bucket, time: number) => {
    bucket.tokens = Math.min(burst, bucket.tokens + ((time - bucket.updatedAt) / 1000) * perSecond);
    bucket.updatedAt = time;
  };

  const forgetIdleClients = (time: number) => {
    for (const [client, bucket] of buckets) {
      refill(bucket, time);
      if (bucket.tokens >= burst) buckets.delete(client);
    }
  };

  return (req, res, next) => {
    const time = now();
    const client = req.ip ?? 'unknown';
    if (!buckets.has(client) && buckets.size >= MAX_TRACKED_CLIENTS) forgetIdleClients(time);

    const bucket = buckets.get(client) ?? { tokens: burst, updatedAt: time };
    buckets.set(client, bucket);
    refill(bucket, time);

    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.ceil((1 - bucket.tokens) / perSecond);
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: { message: `Too many requests, try again in ${retryAfterSeconds} s` } });
      return;
    }
    bucket.tokens -= 1;
    next();
  };
}
