import { describe, expect, it, vi } from 'vitest';
import type { EventQueue } from '../ports/EventQueue';
import { endEvent, startEvent, validated } from '../test/events';
import { QueuedIngestionService } from './QueuedIngestionService';

const clock = { now: () => new Date('2026-10-01T12:00:00.000Z') };

function setup(publish: EventQueue['publish'] = async () => {}) {
  const queue = { publish: vi.fn(publish) };
  return { queue, ingestion: new QueuedIngestionService(queue, clock) };
}

describe('QueuedIngestionService', () => {
  it('publishes the valid events of a batch in one call, as validated', async () => {
    const { queue, ingestion } = setup();

    const result = await ingestion.ingest([startEvent({ extra: 'dropped' }), endEvent()]);

    expect(result).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    expect(queue.publish).toHaveBeenCalledExactlyOnceWith([validated(startEvent()), validated(endEvent())]);
  });

  it('rejects invalid events by position and publishes only the rest', async () => {
    const { queue, ingestion } = setup();

    const result = await ingestion.ingest([startEvent({ level: 0 }), endEvent()]);

    expect(result).toEqual({ accepted: 1, duplicates: 0, rejected: [{ index: 0, errors: ['level: must be a positive integer'] }] });
    expect(queue.publish).toHaveBeenCalledExactlyOnceWith([validated(endEvent())]);
  });

  it('does not publish when no event is valid', async () => {
    const { queue, ingestion } = setup();

    const result = await ingestion.ingest([{}]);

    expect(result.accepted).toBe(0);
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('passes a queue error on, so the API answers with an error and the game resends', async () => {
    const failure = new Error('broker down');
    const { ingestion } = setup(() => Promise.reject(failure));

    await expect(ingestion.ingest([startEvent()])).rejects.toBe(failure);
  });
});
