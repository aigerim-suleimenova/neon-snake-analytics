import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import type { EventStore } from '../ports/EventStore';
import { endEvent, startEvent } from '../test/events';
import { IngestionService } from './IngestionService';
import { StoreUnavailable, withStoreDeadline } from './storeDeadline';

const now = new Date('2026-10-01T12:00:00.000Z');
const clock = { now: () => now };

function setup() {
  const store = new InMemoryEventStore();
  return { store, service: new IngestionService(store, clock) };
}

describe('IngestionService', () => {
  it('stores a valid batch with the time it was received', async () => {
    const { store, service } = setup();

    const result = await service.ingest([startEvent()]);

    expect(result).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
    expect(store.storedEvents()).toEqual([{ event: startEvent(), receivedAt: now }]);
    expect(await store.listRuns()).toEqual([
      expect.objectContaining({ runId: 'r1', sessionId: 's1', level: 1, status: 'unfinished' })
    ]);
  });

  it('stores the valid events of a partly invalid batch and reports the invalid one', async () => {
    const { store, service } = setup();
    const batch = [startEvent(), startEvent({ eventId: 'start-r2', runId: 'r2' }), startEvent({ eventId: 'x', runId: 'r3', level: 0 })];

    const result = await service.ingest(batch);

    expect(result).toEqual({
      accepted: 2,
      duplicates: 0,
      rejected: [{ index: 2, errors: ['level: must be a positive integer'] }]
    });
    expect((await store.listRuns()).map((run) => run.runId)).toEqual(['r1', 'r2']);
  });

  it('counts a resent batch as duplicates and leaves the data unchanged', async () => {
    const { store, service } = setup();
    const batch = [startEvent(), endEvent()];
    await service.ingest(batch);
    const runs = await store.listRuns();
    const events = store.storedEvents();

    const result = await service.ingest(batch);

    expect(result).toEqual({ accepted: 0, duplicates: 2, rejected: [] });
    expect(await store.listRuns()).toEqual(runs);
    expect(store.storedEvents()).toEqual(events);
  });

  it('merges a run to the same record when its end arrives before its start', async () => {
    const inOrder = setup();
    const reversed = setup();

    await inOrder.service.ingest([startEvent()]);
    await inOrder.service.ingest([endEvent()]);
    await reversed.service.ingest([endEvent()]);
    await reversed.service.ingest([startEvent()]);

    const expected = {
      runId: 'r1',
      sessionId: 's1',
      level: 1,
      status: 'fail',
      startedAt: '2026-10-01T11:59:00.000Z',
      endedAt: '2026-10-01T11:59:09.000Z',
      failureReason: 'wall',
      score: 30,
      levelScore: 30,
      progress: 43,
      durationMs: 9000,
      startEventId: 'start-r1',
      endEventId: 'end-r1'
    };
    expect(await inOrder.store.listRuns()).toEqual([expected]);
    expect(await reversed.store.listRuns()).toEqual([expected]);
  });

  it('rejects an end on another level and leaves the run unchanged', async () => {
    const { store, service } = setup();
    await service.ingest([startEvent()]);
    const runs = await store.listRuns();

    const result = await service.ingest([endEvent({ level: 2 })]);

    expect(result).toEqual({
      accepted: 0,
      duplicates: 0,
      rejected: [{ index: 0, errors: ['level: run r1 is on level 1'] }]
    });
    expect(await store.listRuns()).toEqual(runs);
    expect(store.storedEvents()).toHaveLength(1);
  });

  it('rejects an end from another session', async () => {
    const { service } = setup();
    await service.ingest([startEvent()]);

    const result = await service.ingest([endEvent({ sessionId: 's2' })]);

    expect(result.rejected).toEqual([{ index: 0, errors: ['sessionId: run r1 belongs to session s1'] }]);
  });

  it('rejects a second end with a new event ID and keeps the first outcome', async () => {
    const { store, service } = setup();
    await service.ingest([startEvent(), endEvent()]);

    const result = await service.ingest([
      endEvent({ eventId: 'end-r1-again', outcome: 'complete', failureReason: null, progress: 100 })
    ]);

    expect(result.rejected).toEqual([{ index: 0, errors: ['type: run r1 already has a run_ended event'] }]);
    expect(await store.listRuns()).toEqual([expect.objectContaining({ status: 'fail', endEventId: 'end-r1' })]);
  });

  it('rejects a second start with a new event ID', async () => {
    const { service } = setup();
    await service.ingest([startEvent()]);

    const result = await service.ingest([startEvent({ eventId: 'start-r1-again' })]);

    expect(result.rejected).toEqual([{ index: 0, errors: ['type: run r1 already has a run_started event'] }]);
  });

  it('stores a start and its end from one batch', async () => {
    const { store, service } = setup();

    const result = await service.ingest([startEvent(), endEvent()]);

    expect(result).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    expect(await store.listRuns()).toEqual([expect.objectContaining({ status: 'fail', startEventId: 'start-r1' })]);
  });

  it('counts the same event twice in one batch as one accepted and one duplicate', async () => {
    const { service } = setup();

    const result = await service.ingest([startEvent(), startEvent()]);

    expect(result).toEqual({ accepted: 1, duplicates: 1, rejected: [] });
  });

  it('stops the batch at the first missed store deadline', async () => {
    const inner = new InMemoryEventStore();
    const saveEvent = vi
      .fn<EventStore['saveEvent']>()
      .mockImplementationOnce((event, receivedAt) => inner.saveEvent(event, receivedAt))
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation((event, receivedAt) => inner.saveEvent(event, receivedAt));
    const hanging: EventStore = { saveEvent, saveEvents: () => new Promise(() => {}), readStats: () => inner.readStats(), ping: () => inner.ping() };
    const service = new IngestionService(withStoreDeadline(hanging, 20), clock);
    const batch = [startEvent(), startEvent({ eventId: 'start-r2', runId: 'r2' }), startEvent({ eventId: 'start-r3', runId: 'r3' })];

    await expect(service.ingest(batch)).rejects.toBeInstanceOf(StoreUnavailable);

    expect(saveEvent).toHaveBeenCalledTimes(2);
    expect((await inner.listRuns()).map((run) => run.runId)).toEqual(['r1']);
  });
});
