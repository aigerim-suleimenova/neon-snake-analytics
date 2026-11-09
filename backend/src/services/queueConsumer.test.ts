import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import { endEvent, startEvent, validated } from '../test/events';
import type { EventArchive } from '../ports/EventArchive';
import { archiveQueuedBatch, partitionShard, storeQueuedBatch } from './queueConsumer';

const queuedAt = new Date('2026-10-01T12:00:00.000Z');
const message = (event: unknown) => ({ value: JSON.stringify(event), queuedAt });

function setup() {
  return { store: new InMemoryEventStore(), logError: vi.fn() };
}

describe('storeQueuedBatch', () => {
  it('stores the batch in one call, with the time each event was queued as receivedAt', async () => {
    const { store, logError } = setup();
    const saveEvents = vi.spyOn(store, 'saveEvents');

    expect(await storeQueuedBatch(store, [message(startEvent()), message(endEvent())], 2, logError)).toEqual(['stored', 'stored']);

    expect(saveEvents).toHaveBeenCalledOnce();
    expect(store.storedEvents()).toEqual([
      { event: validated(startEvent()), receivedAt: queuedAt },
      { event: validated(endEvent()), receivedAt: queuedAt }
    ]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("sends the counts to the partition's own counter document", async () => {
    const { store, logError } = setup();

    await storeQueuedBatch(store, [message(startEvent())], 2, logError);

    expect(store.counterShards).toEqual(['partition-2']);
    expect(partitionShard(2)).toBe('partition-2');
  });

  it('treats a redelivered event as a duplicate that changes nothing', async () => {
    const { store, logError } = setup();

    await storeQueuedBatch(store, [message(startEvent())], 0, logError);
    expect(await storeQueuedBatch(store, [message(startEvent())], 0, logError)).toEqual(['duplicate']);

    expect(store.storedEvents()).toHaveLength(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs and skips a run conflict, which a retry could never store', async () => {
    const { store, logError } = setup();

    const results = await storeQueuedBatch(store, [message(startEvent()), message(endEvent({ level: 2 }))], 0, logError);

    expect(results).toEqual(['stored', { conflict: 'level: run r1 is on level 1' }]);
    expect(logError).toHaveBeenCalledWith('Skipped queued event end-r1: level: run r1 is on level 1');
  });

  it('skips the messages that are not JSON, empty or invalid, and stores the rest in order', async () => {
    const { store, logError } = setup();

    const results = await storeQueuedBatch(
      store,
      [{ value: '{', queuedAt }, message(startEvent()), { value: null, queuedAt }, message(startEvent({ level: 0 })), message(endEvent())],
      0,
      logError
    );

    expect(results).toEqual(['skipped', 'stored', 'skipped', 'skipped', 'stored']);
    expect(logError).toHaveBeenCalledTimes(3);
  });

  it('does not call the store when nothing in the batch can be stored', async () => {
    const { store, logError } = setup();
    const saveEvents = vi.spyOn(store, 'saveEvents');

    expect(await storeQueuedBatch(store, [{ value: '{', queuedAt }], 0, logError)).toEqual(['skipped']);

    expect(saveEvents).not.toHaveBeenCalled();
  });

  it('passes a store error on, so the batch is not committed and comes back', async () => {
    const { store, logError } = setup();
    const failure = new Error('emulator down');
    vi.spyOn(store, 'saveEvents').mockRejectedValue(failure);

    await expect(storeQueuedBatch(store, [message(startEvent())], 0, logError)).rejects.toBe(failure);
  });
});

describe('archiveQueuedBatch', () => {
  it('archives every valid event, duplicates and conflicts included, and skips the rest', async () => {
    const write = vi.fn<EventArchive['write']>(async () => {});
    const logError = vi.fn();

    const archived = await archiveQueuedBatch(
      { write },
      [message(startEvent()), { value: '{', queuedAt }, message(startEvent()), message(endEvent({ level: 2 }))],
      logError
    );

    expect(archived).toBe(3);
    expect(write).toHaveBeenCalledWith([
      { event: validated(startEvent()), receivedAt: queuedAt },
      { event: validated(startEvent()), receivedAt: queuedAt },
      { event: validated(endEvent({ level: 2 })), receivedAt: queuedAt }
    ]);
    expect(logError).toHaveBeenCalledOnce();
  });

  it('passes an archive error on, so the batch comes back', async () => {
    const failure = new Error('BigQuery down');

    await expect(archiveQueuedBatch({ write: () => Promise.reject(failure) }, [message(startEvent())], vi.fn())).rejects.toBe(failure);
  });
});
