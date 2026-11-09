import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsEvent } from './AnalyticsEvent';
import {
  HttpEventSender,
  MAX_PENDING_EVENTS,
  MAX_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  type FetchLike
} from './HttpEventSender';
import { listenForPageExit } from './listenForPageExit';

const URL = 'http://localhost:3000/api/events';
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const event = (eventId: string): AnalyticsEvent => ({
  schemaVersion: 1,
  eventId,
  type: 'run_started',
  sessionId: 's1',
  runId: `run-${eventId}`,
  level: 1,
  occurredAt: '2026-10-01T12:00:00.000Z'
});

const idsOf = (body: string): string[] => (JSON.parse(body) as AnalyticsEvent[]).map((sent) => sent.eventId);

const setup = ({ random = () => 0.5, beaconAccepts = true }: { random?: () => number; beaconAccepts?: boolean } = {}) => {
  const requests: { ids: string[]; answer(status: number): Promise<void>; fail(): Promise<void>; signal: AbortSignal }[] = [];
  const fetch = vi.fn<FetchLike>(
    (url, init) =>
      new Promise((resolve, reject) => {
        expect(url).toBe(URL);
        expect(init.headers['Content-Type']).toBe('application/json');
        init.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
        requests.push({
          ids: idsOf(init.body),
          answer: async (status) => {
            resolve({ status });
            await settle();
          },
          fail: async () => {
            reject(new TypeError('Failed to fetch'));
            await settle();
          },
          signal: init.signal
        });
      })
  );

  const beacons: string[][] = [];
  const sendBeacon = vi.fn((url: string, body: string) => {
    expect(url).toBe(URL);
    beacons.push(idsOf(body));
    return beaconAccepts;
  });

  const timers: { callback: () => void; ms: number; active: boolean }[] = [];
  const fakeTimers = {
    setTimeout: (callback: () => void, ms: number) => {
      const timer = { callback, ms, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle: unknown) => {
      (handle as { active: boolean }).active = false;
    }
  };
  const retryTimers = () => timers.filter((timer) => timer.active && timer.ms !== REQUEST_TIMEOUT_MS);
  const fireRetry = async () => {
    const [timer] = retryTimers();
    if (!timer) throw new Error('No retry is scheduled');
    timer.active = false;
    timer.callback();
    await settle();
  };

  let exitListener: (() => void) | null = null;
  const onPageExit = (listener: () => void) => {
    exitListener = listener;
    return () => {
      exitListener = null;
    };
  };
  const exitPage = () => exitListener?.();

  const sender = new HttpEventSender({ url: URL, fetch, sendBeacon, timers: fakeTimers, onPageExit, random });
  return { sender, fetch, requests, beacons, timers, retryTimers, fireRetry, exitPage, hasExitListener: () => exitListener !== null };
};

describe('HttpEventSender', () => {
  it.each([200, 202, 204])('resolves the events for good on %i', async (status) => {
    const { sender, requests, retryTimers, exitPage, beacons } = setup();

    sender.send(event('a'));
    expect(requests.map((request) => request.ids)).toEqual([['a']]);
    await requests[0].answer(status);

    exitPage();
    expect(beacons).toEqual([]);
    expect(retryTimers()).toEqual([]);
  });

  it('retries after a network error with the same event ID', async () => {
    const { sender, requests, retryTimers, fireRetry } = setup();

    sender.send(event('a'));
    await requests[0].fail();
    expect(retryTimers().map((timer) => timer.ms)).toEqual([1000]);

    await fireRetry();
    expect(requests.map((request) => request.ids)).toEqual([['a'], ['a']]);
  });

  it('treats a request without an answer after 5 s as failed', async () => {
    const { sender, requests, timers, retryTimers } = setup();

    sender.send(event('a'));
    const timeout = timers.find((timer) => timer.ms === REQUEST_TIMEOUT_MS && timer.active);
    timeout?.callback();
    await settle();

    expect(requests[0].signal.aborted).toBe(true);
    expect(retryTimers()).toHaveLength(1);
  });

  it.each([408, 429, 500, 503])('retries on %i', async (status) => {
    const { sender, requests, fireRetry } = setup();

    sender.send(event('a'));
    await requests[0].answer(status);
    await fireRetry();

    expect(requests.map((request) => request.ids)).toEqual([['a'], ['a']]);
  });

  it.each([400, 404, 413])('drops the events on %i', async (status) => {
    const { sender, requests, retryTimers, exitPage, beacons } = setup();

    sender.send(event('a'));
    await requests[0].answer(status);
    exitPage();

    expect(retryTimers()).toEqual([]);
    expect(beacons).toEqual([]);
  });

  it('does not resend an event the backend lists as rejected', async () => {
    const { sender, requests, exitPage, beacons } = setup();

    sender.send(event('a'));
    // 202 { accepted: 0, duplicates: 0, rejected: [{ index: 0, errors: [...] }] }
    await requests[0].answer(202);
    exitPage();

    expect(beacons).toEqual([]);
  });

  it('doubles the delay up to 30 s and never exceeds it with the largest jitter', async () => {
    const { sender, requests, retryTimers, fireRetry } = setup({ random: () => 0.999999 });
    const delays: number[] = [];

    sender.send(event('a'));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await requests.at(-1)?.fail();
      delays.push(retryTimers()[0].ms);
      await fireRetry();
    }

    expect(delays.slice(0, 4)).toEqual([1000, 2000, 4000, 8000].map((base) => expect.closeTo(base * 1.2, 0)));
    expect(delays.slice(5)).toEqual([1, 2, 3].map(() => expect.closeTo(MAX_RETRY_DELAY_MS, 0)));
    expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
  });

  it.each([
    [0, 20_000],
    [0.5, 25_000]
  ])('keeps the jitter at the cap, so random %s gives %i ms there', async (random, expected) => {
    const { sender, requests, retryTimers, fireRetry } = setup({ random: () => random });

    sender.send(event('a'));
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await requests.at(-1)?.fail();
      if (attempt < 6) await fireRetry();
    }

    expect(retryTimers()[0].ms).toBeCloseTo(expected, 0);
  });

  it('resets the backoff after a success', async () => {
    const { sender, requests, retryTimers, fireRetry } = setup();

    sender.send(event('a'));
    await requests[0].fail();
    await fireRetry();
    await requests[1].fail();
    expect(retryTimers()[0].ms).toBe(2000);
    await fireRetry();
    await requests[2].answer(202);

    sender.send(event('b'));
    await requests[3].fail();
    expect(retryTimers()[0].ms).toBe(1000);
  });

  it('never puts an in-flight event into a second request', async () => {
    const { sender, requests } = setup();

    sender.send(event('a'));
    sender.send(event('b'));

    expect(requests.map((request) => request.ids)).toEqual([['a'], ['b']]);
  });

  it('holds new events during backoff and sends them with the retry', async () => {
    const { sender, requests, fireRetry } = setup();

    sender.send(event('a'));
    await requests[0].fail();
    sender.send(event('b'));
    expect(requests).toHaveLength(1);

    await fireRetry();
    expect(requests.map((request) => request.ids)).toEqual([['a'], ['a', 'b']]);
  });

  it('drops the oldest event at the pending limit, even in flight, and ignores its late answer', async () => {
    const { sender, requests, retryTimers, exitPage, beacons } = setup();

    sender.send(event('oldest'));
    for (let index = 0; index < MAX_PENDING_EVENTS; index += 1) sender.send(event(`e${index}`));
    await requests[0].answer(500);

    expect(retryTimers()).toEqual([]);
    exitPage();
    expect(beacons.flat()).not.toContain('oldest');
    expect(beacons.flat()).toHaveLength(MAX_PENDING_EVENTS);
  });

  it('sends 80 waiting events as batches of 50 and 30', async () => {
    const { sender, requests, fireRetry } = setup();

    sender.send(event('e0'));
    await requests[0].fail();
    for (let index = 1; index < 80; index += 1) sender.send(event(`e${index}`));
    await fireRetry();

    expect(requests.slice(1).map((request) => request.ids.length)).toEqual([50, 30]);
  });

  it('hands pending events, idle and in flight, to the beacon and ignores the late answer', async () => {
    const { sender, requests, beacons, retryTimers, fireRetry, exitPage } = setup();

    sender.send(event('a'));
    await requests[0].fail();
    await fireRetry();
    sender.send(event('b'));
    // a is in flight in the retry; b waits for the next one.
    exitPage();
    expect(beacons).toEqual([['a', 'b']]);

    await requests[1].answer(500);
    expect(retryTimers()).toEqual([]);
    exitPage();
    expect(beacons).toHaveLength(1);
  });

  it('hands 80 pending events to the beacon as 50 and 30', async () => {
    const { sender, requests, beacons, exitPage } = setup();

    sender.send(event('e0'));
    await requests[0].fail();
    for (let index = 1; index < 80; index += 1) sender.send(event(`e${index}`));
    exitPage();

    expect(beacons.map((batch) => batch.length)).toEqual([50, 30]);
  });

  it('keeps events pending when the browser refuses the beacon', async () => {
    const { sender, requests, fireRetry, exitPage } = setup({ beaconAccepts: false });

    sender.send(event('a'));
    await requests[0].fail();
    exitPage();
    await fireRetry();

    expect(requests.map((request) => request.ids)).toEqual([['a'], ['a']]);
  });

  it('removes the page listener and clears the timers on dispose', async () => {
    const { sender, requests, timers, hasExitListener } = setup();

    sender.send(event('a'));
    await requests[0].fail();
    sender.send(event('b'));
    expect(timers.some((timer) => timer.active)).toBe(true);

    sender.dispose();
    expect(hasExitListener()).toBe(false);
    expect(timers.some((timer) => timer.active)).toBe(false);
  });
});

describe('listenForPageExit', () => {
  const setupPage = () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const win = new EventTarget();
    const listener = vi.fn();
    const stop = listenForPageExit(doc, win, listener);
    return { doc, win, listener, stop };
  };

  it('fires when the page becomes hidden, not when it becomes visible', () => {
    const { doc, listener } = setupPage();

    doc.dispatchEvent(new Event('visibilitychange'));
    expect(listener).not.toHaveBeenCalled();

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires on page hide', () => {
    const { win, listener } = setupPage();

    win.dispatchEvent(new Event('pagehide'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops listening after unsubscribing', () => {
    const { doc, win, listener, stop } = setupPage();

    stop();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('pagehide'));
    expect(listener).not.toHaveBeenCalled();
  });
});
