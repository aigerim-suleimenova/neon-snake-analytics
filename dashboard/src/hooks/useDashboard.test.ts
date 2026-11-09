import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FakeStatsApi } from '../api/FakeStatsApi';
import type { LiveHandlers, LiveStatsSource } from '../api/LiveStatsSource';
import { emptyOverview, sampleLevels, sampleOverview } from '../api/sampleStats';
import { StatsUnavailableError } from '../api/StatsApi';
import type { Clock } from '../clock';
import { useDashboard } from './useDashboard';

const clockAt = (hours: number, minutes: number) => {
  const clock = { time: new Date(2026, 9, 1, hours, minutes), now: () => clock.time };
  return clock;
};

const setup = (api: FakeStatsApi, clock: Clock = clockAt(12, 4)) => renderHook(() => useDashboard(api, clock));

/** Lets pending promise callbacks run. */
const settle = () => act(async () => {});

describe('useDashboard', () => {
  it('loads both statistics once on mount and shows them', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const { result } = setup(api);

    expect(result.current).toMatchObject({ status: 'loading', view: null, statusText: 'Loading…', canRefresh: false, canRetry: false });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.statusText).toBe('Updated 12:04');
    expect(result.current.view?.kpis[0].value).toBe('1,284');
    expect(result.current.canRefresh).toBe(true);
    expect(api.calls).toEqual({ overview: 1, levels: 1 });
  });

  it('shows the update time in 24-hour format', async () => {
    const { result } = setup(new FakeStatsApi(sampleOverview, sampleLevels), clockAt(21, 7));

    await waitFor(() => expect(result.current.statusText).toBe('Updated 21:07'));
  });

  it('keeps the old data and time while refreshing, then shows the new', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const clock = clockAt(12, 4);
    const { result } = setup(api, clock);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = result.current.view;

    api.hold();
    api.overview = emptyOverview;
    api.levels = [];
    clock.time = new Date(2026, 9, 1, 12, 10);
    act(() => result.current.refresh());

    expect(result.current).toMatchObject({ status: 'refreshing', statusText: 'Updated 12:04', canRefresh: false });
    expect(result.current.view).toBe(before);

    act(() => api.release());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.statusText).toBe('Updated 12:10');
    expect(result.current.view?.isEmpty).toBe(true);
  });

  it('shows the error state when one of the two requests fails', async () => {
    const api = new FakeStatsApi(sampleOverview, new StatsUnavailableError('/api/stats/levels answered 503'));
    const { result } = setup(api);

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ view: null, statusText: 'Offline', canRetry: true });
  });

  it('shows the error state when a refresh fails', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const { result } = setup(api);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    api.overview = new StatsUnavailableError('/api/stats/overview could not be reached');
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.view).toBeNull();
  });

  it('retries back to the data, staying offline while the retry runs', async () => {
    const api = new FakeStatsApi(new StatsUnavailableError('down'), sampleLevels);
    const { result } = setup(api);
    await waitFor(() => expect(result.current.status).toBe('error'));

    api.overview = sampleOverview;
    api.hold();
    act(() => result.current.retry());

    expect(result.current).toMatchObject({ status: 'retrying', statusText: 'Offline', canRetry: false, canRefresh: false });

    act(() => api.release());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.calls).toEqual({ overview: 2, levels: 2 });
  });

  it('starts no second load while one runs', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    api.hold();
    const { result } = setup(api);

    act(() => result.current.refresh());
    act(() => result.current.retry());
    expect(api.calls).toEqual({ overview: 1, levels: 1 });

    act(() => api.release());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    api.hold();
    act(() => result.current.refresh());
    act(() => result.current.refresh());
    expect(api.calls).toEqual({ overview: 2, levels: 2 });
  });

  it('makes no requests without a call', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const { result } = setup(api);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await settle();
    await settle();
    expect(api.calls).toEqual({ overview: 1, levels: 1 });
  });

  it('cancels the load on unmount', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    api.hold();
    const { unmount } = setup(api);

    unmount();
    expect(api.signals.every((signal) => signal.aborted)).toBe(true);

    act(() => api.release());
    await settle();
  });
});

describe('useDashboard with live updates', () => {
  function liveSource() {
    let handlers: LiveHandlers | null = null;
    const stop = vi.fn();
    const source: LiveStatsSource = {
      connect: (given) => {
        handlers = given;
        return stop;
      }
    };
    const current = () => handlers as unknown as LiveHandlers;
    return { source, stop, current };
  }

  it('shows every pushed update as it arrives, marked live, with Refresh not needed', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const live = liveSource();
    const clock = clockAt(12, 4);
    const { result } = renderHook(() => useDashboard(api, clock, live.source));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    clock.time = new Date(2026, 9, 1, 12, 5, 9);
    act(() => {
      live.current().onStatus('live');
      live.current().onStats({ overview: emptyOverview, levels: [] });
    });

    expect(result.current).toMatchObject({ status: 'ready', live: 'live', statusText: 'Live · updated 12:05:09', canRefresh: false });
    expect(result.current.view?.isEmpty).toBe(true);
  });

  it('drops the answer of a load started before a push, as it is older than what is shown', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const live = liveSource();
    const clock = clockAt(12, 4);
    const { result } = renderHook(() => useDashboard(api, clock, live.source));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    api.hold();
    act(() => result.current.refresh());
    act(() => live.current().onStats({ overview: emptyOverview, levels: [] }));
    act(() => api.release());
    await settle();

    expect(result.current.view?.isEmpty).toBe(true);
  });

  it('shows the error state when the backend reports the statistics unavailable, and recovers with the next push', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const live = liveSource();
    const clock = clockAt(12, 4);
    const { result } = renderHook(() => useDashboard(api, clock, live.source));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => live.current().onUnavailable());
    expect(result.current.status).toBe('error');

    act(() => live.current().onStats({ overview: sampleOverview, levels: sampleLevels }));
    expect(result.current.status).toBe('ready');
  });

  it('offers Refresh again when live updates are off', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const live = liveSource();
    const clock = clockAt(12, 4);
    const { result } = renderHook(() => useDashboard(api, clock, live.source));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => live.current().onStatus('live'));
    expect(result.current.canRefresh).toBe(false);
    act(() => live.current().onStatus('off'));

    expect(result.current).toMatchObject({ live: 'off', canRefresh: true, statusText: 'Updated 12:04' });
  });

  it('stops listening on unmount', async () => {
    const live = liveSource();
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    const clock = clockAt(12, 4);
    const { unmount } = renderHook(() => useDashboard(api, clock, live.source));

    unmount();

    expect(live.stop).toHaveBeenCalledOnce();
  });
});
