import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventStore } from '../ports/EventStore';
import { STORE_DEADLINE_MS, StoreUnavailable, withQueueDeadline, withStoreDeadline } from './storeDeadline';

const never = () => new Promise<never>(() => {});

describe('withStoreDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through answers that arrive in time', async () => {
    const store: EventStore = {
      saveEvent: async () => 'stored',
      saveEvents: async () => ['stored'],
      readStats: async () => ({ sessions: 0, levels: {} }),
      ping: async () => true
    };
    const guarded = withStoreDeadline(store);

    expect(await guarded.ping()).toBe(true);
    expect(await guarded.readStats()).toEqual({ sessions: 0, levels: {} });
    expect(await guarded.saveEvents([], 'p0')).toEqual(['stored']);
  });

  it('fails every call with StoreUnavailable after 3 s without an answer', async () => {
    vi.useFakeTimers();
    const guarded = withStoreDeadline({ saveEvent: never, saveEvents: never, readStats: never, ping: never });

    const calls = [guarded.ping(), guarded.readStats(), guarded.saveEvents([], 'p0')];
    calls.forEach((call) => call.catch(() => {}));
    await vi.advanceTimersByTimeAsync(STORE_DEADLINE_MS - 1);
    let settled = false;
    Promise.allSettled(calls).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    for (const call of calls) await expect(call).rejects.toBeInstanceOf(StoreUnavailable);
  });

  it('passes store errors through unchanged', async () => {
    const failure = new Error('broken');
    const guarded = withStoreDeadline({ saveEvent: never, saveEvents: never, readStats: () => Promise.reject(failure), ping: never });

    await expect(guarded.readStats()).rejects.toBe(failure);
  });
});

describe('withQueueDeadline', () => {
  it('fails a publish with StoreUnavailable when the broker does not answer in time', async () => {
    const guarded = withQueueDeadline({ publish: never }, 20);

    await expect(guarded.publish([])).rejects.toBeInstanceOf(StoreUnavailable);
  });

  it('passes through a publish that completes in time', async () => {
    const publish = vi.fn(async () => {});

    await withQueueDeadline({ publish }).publish([]);

    expect(publish).toHaveBeenCalledWith([]);
  });
});
