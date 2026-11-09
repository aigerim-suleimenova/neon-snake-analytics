import { validateEvent } from '@neon-snake/contract/schemas';
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../seed/demoEvents';
import { percentile, planLoad, RESEND_DELAY_MS, type LoadOptions } from './loadPlan';

const now = new Date('2026-11-09T12:00:00.000Z');
const options = (overrides: Partial<LoadOptions> = {}): LoadOptions => ({
  eventsPerSecond: 100,
  seconds: 10,
  resendRate: 0,
  concurrentSessions: 50,
  tag: 't1',
  random: seededRandom(1),
  now,
  ...overrides
});

describe('planLoad', () => {
  it('spreads exactly rate × seconds events evenly over the run', () => {
    const { posts, events } = planLoad(options());

    expect(events).toHaveLength(1000);
    expect(posts).toHaveLength(1000);
    expect(posts[1].atMs - posts[0].atMs).toBeCloseTo(10);
    expect(posts.at(-1)?.atMs).toBeLessThan(10_000);
  });

  it('plans only events the API accepts, each once, none from the future', () => {
    const { events } = planLoad(options());

    expect(events.map((event) => validateEvent(event, now)).filter((result) => !result.ok)).toEqual([]);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
  });

  it("keeps each player's events in order and on one client IP", () => {
    const { posts } = planLoad(options());
    const bySession = new Map<string, { ips: Set<string>; eventIds: string[] }>();
    for (const { event, clientIp } of posts) {
      const session = bySession.get(event.sessionId) ?? { ips: new Set(), eventIds: [] };
      session.ips.add(clientIp);
      session.eventIds.push(event.eventId);
      bySession.set(event.sessionId, session);
    }

    for (const { ips, eventIds } of bySession.values()) {
      expect(ips.size).toBe(1);
      expect(eventIds.indexOf(eventIds.find((id) => id.endsWith('-r01-start')) ?? '')).toBe(0);
    }
    expect(new Set(posts.map((post) => post.clientIp)).size).toBe(bySession.size);
  });

  it('keeps every player below one post per second when sessions are three times the rate', () => {
    const { posts } = planLoad(options({ concurrentSessions: 300 }));
    const lastByIp = new Map<string, number>();
    let shortestGapMs = Infinity;
    for (const { atMs, clientIp } of posts) {
      const last = lastByIp.get(clientIp);
      if (last !== undefined) shortestGapMs = Math.min(shortestGapMs, atMs - last);
      lastByIp.set(clientIp, atMs);
    }

    expect(shortestGapMs).toBeGreaterThanOrEqual(1000);
  });

  it('posts a share of events again a second later, marked as resends', () => {
    const { posts, events } = planLoad(options({ resendRate: 0.1 }));
    const resends = posts.filter((post) => post.resend);

    expect(resends.length).toBeGreaterThan(50);
    expect(resends.length).toBeLessThan(150);
    expect(posts).toHaveLength(events.length + resends.length);
    const first = posts.find((post) => !post.resend && post.event === resends[0].event);
    expect(resends[0].atMs - (first?.atMs ?? 0)).toBe(RESEND_DELAY_MS);
  });

  it("never reuses another run's IDs", () => {
    const a = planLoad(options({ tag: 'a' })).events.map((event) => event.eventId);
    const b = new Set(planLoad(options({ tag: 'b' })).events.map((event) => event.eventId));

    expect(a.some((id) => b.has(id))).toBe(false);
  });
});

describe('percentile', () => {
  it('reads the value below which the share lies', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);

    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.99)).toBe(99);
    expect(percentile(values, 1)).toBe(100);
    expect(percentile([], 0.5)).toBe(0);
  });
});
