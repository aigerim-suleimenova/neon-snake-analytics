import type { AnalyticsEvent } from '@neon-snake/contract';
import { generateDemoEvents, type Random } from '../seed/demoEvents';

export interface LoadOptions {
  /** Events posted per second, each in its own request, as the game sends them. */
  eventsPerSecond: number;
  seconds: number;
  /** Share of events posted a second time a little later, as the game does after a lost answer. */
  resendRate: number;
  /** Players playing at once; their events interleave. */
  concurrentSessions: number;
  /** Tells this run's IDs apart from every other run's, so runs never collide. */
  tag: string;
  random: Random;
  /** The sessions' events are placed in the hour before this, so the API never sees them as from the future. */
  now: Date;
}

/** One request of the plan: when to send it, from which client IP, and the event it carries. */
export interface PlannedPost {
  atMs: number;
  clientIp: string;
  event: AnalyticsEvent;
  /** A resend of an event planned earlier; the API should report it as a duplicate. */
  resend: boolean;
}

export interface LoadPlan {
  posts: PlannedPost[];
  /** Every distinct event, each once: what the store should hold when the run is done. */
  events: AnalyticsEvent[];
}

/** How long after the first send a resend goes out, like the game's first retry. */
export const RESEND_DELAY_MS = 1000;

/** A documentation-range (TEST-NET) address per session, so each player counts as its own client. */
const clientIpOf = (session: number): string => `198.18.${Math.floor(session / 250) % 256}.${(session % 250) + 1}`;

/**
 * Plans an open-loop load: `eventsPerSecond` posts every second for `seconds`, whatever the answers. Events
 * come from made-up sessions played like the demo data, `concurrentSessions` at a time, so a player's events
 * arrive in order but interleaved with other players'. A share of events is posted again a second later.
 */
export function planLoad(options: LoadOptions): LoadPlan {
  const total = Math.round(options.eventsPerSecond * options.seconds);
  const intervalMs = 1000 / options.eventsPerSecond;
  const sessionStart = new Date(options.now.getTime() - 60 * 60_000);
  const posts: PlannedPost[] = [];
  const events: AnalyticsEvent[] = [];

  let sessionsStarted = 0;
  const startSession = () => {
    sessionsStarted += 1;
    const queue = generateDemoEvents(options.random, {
      sessions: 1,
      start: sessionStart,
      idPrefix: `load-${options.tag}-${sessionsStarted}`
    });
    return { queue, clientIp: clientIpOf(sessionsStarted) };
  };
  const active = Array.from({ length: Math.max(1, options.concurrentSessions) }, startSession);

  for (let index = 0; index < total; index += 1) {
    const slot = index % active.length;
    if (active[slot].queue.length === 0) active[slot] = startSession();
    const { queue, clientIp } = active[slot];
    const event = queue.shift() as AnalyticsEvent;
    const atMs = index * intervalMs;

    events.push(event);
    posts.push({ atMs, clientIp, event, resend: false });
    if (options.random() < options.resendRate) posts.push({ atMs: atMs + RESEND_DELAY_MS, clientIp, event, resend: true });
  }

  posts.sort((a, b) => a.atMs - b.atMs);
  return { posts, events };
}

/** The value below which `share` of the sorted `values` lie, e.g. 0.95 for the 95th percentile. */
export function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
}
