import type { LiveStats } from '@neon-snake/contract';
import { describe, expect, it, vi } from 'vitest';
import { LiveStatsBroadcaster, type LiveTimers } from './LiveStats';

const statsWith = (runs: number): LiveStats => ({
  overview: { sessions: 1, runs, finished: runs, unfinished: 0, completionRate: 1, runsPerSession: runs },
  levels: []
});

/** Timers that run only when told, so a test decides when the next check happens. */
function manualTimers() {
  const intervals = new Map<number, { callback: () => void; ms: number }>();
  let next = 0;
  const timers: LiveTimers = {
    setInterval: (callback, ms) => {
      intervals.set(++next, { callback, ms });
      return next;
    },
    clearInterval: (handle) => void intervals.delete(handle as number)
  };
  const fire = (ms: number) => [...intervals.values()].filter((interval) => interval.ms === ms).forEach(({ callback }) => callback());
  return { timers, fire, running: () => intervals.size };
}

function setup(read = vi.fn(async () => statsWith(1)), options: { maxStreams?: number; maxStreamsPerClient?: number } = {}) {
  const clock = manualTimers();
  const logError = vi.fn();
  const live = new LiveStatsBroadcaster({ read, timers: clock.timers, intervalMs: 1000, keepAliveMs: 20_000, logError, ...options });
  const open = (client = 'a', lastEventId?: string) => {
    const chunks: string[] = [];
    const end = vi.fn();
    const close = live.subscribe(client, { write: (chunk) => chunks.push(chunk), end }, lastEventId);
    return { chunks, end, close, events: () => chunks.filter((chunk) => chunk.includes('event:')) };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { live, read, clock, logError, open, settle };
}

const idOf = (chunk: string) => /^id: (.+)$/m.exec(chunk)?.[1];

describe('LiveStatsBroadcaster', () => {
  it('tells the browser how soon to reconnect and sends the statistics as soon as a stream opens', async () => {
    const { open, settle } = setup();

    const stream = open();
    await settle();

    expect(stream.chunks[0]).toBe('retry: 3000\n\n');
    expect(stream.events()).toHaveLength(1);
    expect(stream.events()[0]).toMatch(/^id: \S+\nevent: stats\ndata: \{"overview":\{"sessions":1,"runs":1/);
  });

  it('reads once per interval for every stream together, and sends only changes', async () => {
    let runs = 1;
    const { open, read, clock, settle } = setup(vi.fn(async () => statsWith(runs)));
    const streams = [open('a'), open('b'), open('c')];
    await settle();

    clock.fire(1000);
    await settle();
    runs = 2;
    clock.fire(1000);
    await settle();

    expect(read).toHaveBeenCalledTimes(3);
    for (const stream of streams) {
      expect(stream.events().map((chunk) => JSON.parse(chunk.split('data: ')[1]).overview.runs)).toEqual([1, 2]);
    }
  });

  it('sends a stream joining later the current statistics at once, without another read', async () => {
    const { open, read, settle } = setup();
    open('a');
    await settle();

    const later = open('b');

    expect(later.events()).toHaveLength(1);
    expect(read).toHaveBeenCalledOnce();
  });

  it('does not resend data a reconnecting browser already has', async () => {
    const { open, settle } = setup();
    const first = open('a');
    await settle();
    const id = idOf(first.events()[0]);

    const reconnected = open('a', id);

    expect(reconnected.events()).toEqual([]);
  });

  it('sends one unavailable event when a read fails, keeps streaming, and recovers with the next good read', async () => {
    const read = vi.fn<() => Promise<LiveStats>>().mockResolvedValueOnce(statsWith(1)).mockRejectedValueOnce(new Error('store down')).mockRejectedValueOnce(new Error('still down')).mockResolvedValue(statsWith(1));
    const { open, clock, logError, settle } = setup(read);
    const stream = open();
    await settle();

    for (let tick = 0; tick < 3; tick += 1) {
      clock.fire(1000);
      await settle();
    }

    expect(stream.events().map((chunk) => /event: (\w+)/.exec(chunk)?.[1])).toEqual(['stats', 'unavailable', 'stats']);
    expect(logError).toHaveBeenCalledOnce();
  });

  it('keeps quiet streams open with a comment', async () => {
    const { open, clock, settle } = setup();
    const stream = open();
    await settle();

    clock.fire(20_000);

    expect(stream.chunks.at(-1)).toBe(': keep-alive\n\n');
  });

  it('stops reading when the last stream closes, and reads afresh for the next one', async () => {
    const { open, read, clock, settle } = setup();
    const stream = open();
    await settle();

    stream.close();
    expect(clock.running()).toBe(0);
    open();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('refuses a client beyond its stream limit, and anyone once the instance is full', () => {
    const { live, open } = setup(undefined, { maxStreams: 3, maxStreamsPerClient: 2 });
    open('a');
    open('a');

    expect(live.admit('a')).toBe('client-limit');
    expect(live.admit('b')).toBeNull();
    open('b');
    expect(live.admit('c')).toBe('full');
  });

  it('ends every stream on close and accepts no new ones', async () => {
    const { live, open, clock, settle } = setup();
    const streams = [open('a'), open('b')];
    await settle();

    live.close();

    for (const stream of streams) expect(stream.end).toHaveBeenCalledOnce();
    expect(live.size).toBe(0);
    expect(clock.running()).toBe(0);
    expect(live.admit('c')).toBe('full');
  });
});
