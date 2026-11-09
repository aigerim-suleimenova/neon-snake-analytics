import { describe, expect, it, vi } from 'vitest';
import { groupCommit } from './groupCommit';

/** A flush that finishes only when told to, so tests control what overlaps. */
function controlledFlush() {
  const calls: Array<{ items: number[]; finish: () => void; fail: (error: unknown) => void }> = [];
  const flush = vi.fn(
    (items: number[]) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ items: [...items], finish: resolve, fail: reject });
      })
  );
  return { flush, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('groupCommit', () => {
  it('flushes at once when nothing else is flushing', async () => {
    const { flush, calls } = controlledFlush();
    const publish = groupCommit(flush, 100);

    const done = publish([1, 2]);
    await tick();
    expect(calls.map((call) => call.items)).toEqual([[1, 2]]);
    calls[0].finish();

    await expect(done).resolves.toBeUndefined();
  });

  it('sends everything that arrived during a flush together in the next one', async () => {
    const { flush, calls } = controlledFlush();
    const publish = groupCommit(flush, 100);

    const first = publish([1]);
    const waiting = [publish([2]), publish([3, 4]), publish([5])];
    await tick();
    expect(calls).toHaveLength(1);

    calls[0].finish();
    await first;
    await tick();
    expect(calls.map((call) => call.items)).toEqual([[1], [2, 3, 4, 5]]);
    calls[1].finish();

    await Promise.all(waiting);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('settles each caller with the flush that carried its items', async () => {
    const { flush, calls } = controlledFlush();
    const publish = groupCommit(flush, 100);
    const failure = new Error('broker down');

    const first = publish([1]);
    const second = publish([2]);
    await tick();
    calls[0].fail(failure);
    await expect(first).rejects.toBe(failure);
    await tick();
    calls[1].finish();

    await expect(second).resolves.toBeUndefined();
  });

  it('starts a new group beyond maxItems, without splitting a call', async () => {
    const { flush, calls } = controlledFlush();
    const publish = groupCommit(flush, 3);

    const all = [publish([0]), publish([1, 2]), publish([3]), publish([4, 5, 6, 7])];
    for (let index = 0; index < 4; index += 1) {
      await tick();
      calls[index]?.finish();
    }
    await Promise.all(all);

    expect(calls.map((call) => call.items)).toEqual([[0], [1, 2, 3], [4, 5, 6, 7]]);
  });

  it('keeps working after a failed flush', async () => {
    const { flush, calls } = controlledFlush();
    const publish = groupCommit(flush, 100);

    const failed = publish([1]);
    await tick();
    calls[0].fail(new Error('once'));
    await expect(failed).rejects.toThrow('once');

    const next = publish([2]);
    await tick();
    calls[1].finish();
    await expect(next).resolves.toBeUndefined();
  });
});
