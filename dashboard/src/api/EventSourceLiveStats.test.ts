import { describe, expect, it, vi } from 'vitest';

import { EventSourceLiveStats, type EventSourceLike } from './EventSourceLiveStats';
import { sampleLevels, sampleOverview } from './sampleStats';

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data = '') {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

function setup() {
  const sources: FakeEventSource[] = [];
  const timers: Array<() => void> = [];
  const live = new EventSourceLiveStats({
    url: 'http://api.test/api/stats/stream',
    createEventSource: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
    setTimeout: (callback) => timers.push(callback),
    clearTimeout: vi.fn()
  });
  const handlers = { onStats: vi.fn(), onUnavailable: vi.fn(), onStatus: vi.fn() };
  const stop = live.connect(handlers);
  return { sources, timers, handlers, stop };
}

describe('EventSourceLiveStats', () => {
  it('reports connecting, then live once the stream opens, and passes on checked statistics', () => {
    const { sources, handlers } = setup();
    expect(handlers.onStatus).toHaveBeenLastCalledWith('connecting');

    sources[0].emit('open');
    sources[0].emit('stats', JSON.stringify({ overview: sampleOverview, levels: sampleLevels }));

    expect(handlers.onStatus).toHaveBeenLastCalledWith('live');
    expect(handlers.onStats).toHaveBeenCalledWith({ overview: sampleOverview, levels: sampleLevels });
  });

  it('treats a message that does not match the shared schema, or an unavailable event, as unavailable statistics', () => {
    const { sources, handlers } = setup();

    sources[0].emit('stats', JSON.stringify({ overview: { runs: 'many' }, levels: [] }));
    sources[0].emit('stats', '{');
    sources[0].emit('unavailable', '{"message":"down"}');

    expect(handlers.onStats).not.toHaveBeenCalled();
    expect(handlers.onUnavailable).toHaveBeenCalledTimes(3);
  });

  it('reports connecting while the browser reconnects a dropped stream by itself', () => {
    const { sources, handlers } = setup();
    sources[0].emit('open');

    sources[0].readyState = 0;
    sources[0].emit('error');

    expect(handlers.onStatus).toHaveBeenLastCalledWith('connecting');
    expect(sources).toHaveLength(1);
  });

  it('falls back to off when the server refuses the stream, and tries again later', () => {
    const { sources, timers, handlers } = setup();

    sources[0].readyState = 2;
    sources[0].emit('error');

    expect(handlers.onStatus).toHaveBeenLastCalledWith('off');
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(sources).toHaveLength(2);
    expect(handlers.onStatus).toHaveBeenLastCalledWith('connecting');
  });

  it('closes the stream and does not try again once stopped', () => {
    const { sources, timers, stop } = setup();

    stop();
    sources[0].emit('error');

    expect(sources[0].closed).toBe(true);
    expect(timers).toHaveLength(0);
  });
});
