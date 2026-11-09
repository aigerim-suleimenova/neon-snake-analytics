import { useEffect, useReducer, useState } from 'react';

import type { LiveStatsSource, LiveStatus } from '../api/LiveStatsSource';
import type { StatsApi } from '../api/StatsApi';
import type { Clock } from '../clock';
import { toDashboardView, type DashboardView } from '../view/toDashboardView';

export type LoadStatus = 'loading' | 'ready' | 'refreshing' | 'error' | 'retrying';

interface Loaded {
  view: DashboardView;
  updatedAt: Date;
}

/** `pushes` counts live updates, so an answer to a load started before one is known to be older. */
type State =
  | { status: 'loading'; request: number; pushes: number }
  | { status: 'ready' | 'refreshing'; request: number; pushes: number; loaded: Loaded }
  | { status: 'error' | 'retrying'; request: number; pushes: number };

type Action =
  | { type: 'start' }
  | { type: 'succeeded'; loaded: Loaded; pushesAtStart: number }
  | { type: 'failed'; pushesAtStart?: number }
  | { type: 'pushed'; loaded: Loaded };

/**
 * loading ─ok─▶ ready ─Refresh─▶ refreshing ─ok─▶ ready
 *    └─fail─▶ error ─Retry or Refresh─▶ retrying ─ok─▶ ready
 * Any failure leads to error. A start is ignored while a load runs, so at most one load is in flight.
 * A live update leads to ready from any state; the answer to a load started before it is then dropped, as it is
 * older than what is shown.
 */
const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'start':
      if (state.status === 'ready') return { ...state, status: 'refreshing', request: state.request + 1 };
      if (state.status === 'error') return { status: 'retrying', request: state.request + 1, pushes: state.pushes };
      return state;
    case 'succeeded':
      if (action.pushesAtStart !== state.pushes) return state;
      return { status: 'ready', request: state.request, pushes: state.pushes, loaded: action.loaded };
    case 'failed':
      if (action.pushesAtStart !== undefined && action.pushesAtStart !== state.pushes) return state;
      return { status: 'error', request: state.request, pushes: state.pushes };
    case 'pushed':
      return { status: 'ready', request: state.request, pushes: state.pushes + 1, loaded: action.loaded };
  }
};

const pad = (n: number) => String(n).padStart(2, '0');
const statusText = (state: State, live: LiveStatus): string => {
  if ('loaded' in state) {
    const at = state.loaded.updatedAt;
    if (live === 'live') return `Live · updated ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
    return `Updated ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }
  return state.status === 'loading' ? 'Loading…' : 'Offline';
};

export interface DashboardState {
  status: LoadStatus;
  /** The last loaded data; kept while refreshing, null while loading or offline. */
  view: DashboardView | null;
  statusText: string;
  /** `off` without a live source or after it was refused; Refresh is the way to update then. */
  live: LiveStatus;
  canRefresh: boolean;
  canRetry: boolean;
  refresh(): void;
  retry(): void;
}

/**
 * Loads both statistics on mount and on refresh() or retry(). With a live source, every update it pushes is shown
 * as it arrives, and Refresh is not needed while it is live.
 */
export const useDashboard = (api: StatsApi, clock: Clock, liveSource?: LiveStatsSource): DashboardState => {
  const [state, dispatch] = useReducer(reducer, { status: 'loading', request: 0, pushes: 0 });
  const [live, setLive] = useState<LiveStatus>('off');

  useEffect(() => {
    const controller = new AbortController();
    const pushesAtStart = state.pushes;
    Promise.all([api.getOverview(controller.signal), api.getLevels(controller.signal)]).then(
      ([overview, levels]) => {
        if (!controller.signal.aborted)
          dispatch({ type: 'succeeded', pushesAtStart, loaded: { view: toDashboardView(overview, levels), updatedAt: clock.now() } });
      },
      () => {
        if (!controller.signal.aborted) dispatch({ type: 'failed', pushesAtStart });
      }
    );
    // Cancels the load on unmount (and StrictMode's extra effect run in development).
    return () => controller.abort();
    // Only a new request starts a load; a push changes `pushes` without loading again.
  }, [api, clock, state.request]);

  useEffect(() => {
    if (!liveSource) return;
    const stop = liveSource.connect({
      onStats: ({ overview, levels }) => dispatch({ type: 'pushed', loaded: { view: toDashboardView(overview, levels), updatedAt: clock.now() } }),
      onUnavailable: () => dispatch({ type: 'failed' }),
      onStatus: setLive
    });
    return () => {
      stop();
      setLive('off');
    };
  }, [liveSource, clock]);

  const start = () => dispatch({ type: 'start' });

  return {
    status: state.status,
    view: 'loaded' in state ? state.loaded.view : null,
    statusText: statusText(state, live),
    live,
    canRefresh: live !== 'live' && (state.status === 'ready' || state.status === 'error'),
    canRetry: state.status === 'error',
    refresh: start,
    retry: start
  };
};
