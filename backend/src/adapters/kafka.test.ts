import type { Batch } from 'kafkajs';
import { describe, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '../services/queueConsumer';
import { createBatchConsumer, type BatchHandler } from './kafka';

const messages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    offset: String(100 + index),
    timestamp: String(Date.parse('2026-10-01T12:00:00.000Z') + index),
    value: Buffer.from(`{"n":${index}}`),
    key: null,
    attributes: 0,
    headers: {}
  }));

function payload(count: number, partition = 1) {
  return {
    batch: { partition, messages: messages(count) } as unknown as Batch,
    resolveOffset: vi.fn(),
    heartbeat: vi.fn(async () => {}),
    isRunning: vi.fn(() => true),
    isStale: vi.fn(() => false)
  };
}

describe('createBatchConsumer', () => {
  it('hands the batch over in chunks, resolving each chunk only after it is stored', async () => {
    const handle = vi.fn<BatchHandler>(async (_messages: QueuedMessage[], _partition: number) => {});
    const run = payload(5);

    await createBatchConsumer(handle, 2)(run);

    expect(handle.mock.calls.map(([chunk, partition]) => [chunk.length, partition])).toEqual([
      [2, 1],
      [2, 1],
      [1, 1]
    ]);
    expect(run.resolveOffset.mock.calls).toEqual([['101'], ['103'], ['104']]);
    expect(run.heartbeat).toHaveBeenCalledTimes(3);
  });

  it('passes the value and the time the message was queued', async () => {
    const handle = vi.fn(async () => {});

    await createBatchConsumer(handle, 10)(payload(1));

    expect(handle).toHaveBeenCalledWith([{ value: '{"n":0}', queuedAt: new Date('2026-10-01T12:00:00.000Z') }], 1);
  });

  it('leaves a failed chunk and the rest unresolved, so they are fetched again', async () => {
    const failure = new Error('store down');
    const handle = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    const run = payload(5);

    await expect(createBatchConsumer(handle, 2)(run)).rejects.toBe(failure);

    expect(run.resolveOffset.mock.calls).toEqual([['101']]);
  });

  it('stops between chunks when the consumer stops or the partition moved away', async () => {
    const handle = vi.fn(async () => {});
    const run = payload(5);
    run.isStale.mockReturnValueOnce(false).mockReturnValue(true);

    await createBatchConsumer(handle, 2)(run);

    expect(handle).toHaveBeenCalledOnce();
    expect(run.resolveOffset.mock.calls).toEqual([['101']]);
  });
});
