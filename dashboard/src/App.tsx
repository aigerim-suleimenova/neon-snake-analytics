import type { ReactNode } from 'react';

import type { LiveStatsSource } from './api/LiveStatsSource';
import type { StatsApi } from './api/StatsApi';
import type { Clock } from './clock';
import { ChartCard, type ChartBody } from './components/ChartCard';
import { CompletionChart } from './components/CompletionChart';
import { Header } from './components/Header';
import { KpiGrid } from './components/KpiGrid';
import { LevelTable } from './components/LevelTable';
import { Notice } from './components/Notice';
import { StackedBarChart } from './components/StackedBarChart';
import { useDashboard } from './hooks/useDashboard';
import styles from './App.module.css';

export interface AppProps {
  api: StatsApi;
  clock: Clock;
  /** Pushes updates as they happen; without it, the data changes only on Refresh. */
  live?: LiveStatsSource;
}

const SOURCE = 'GET /api/stats/levels';

export function App({ api, clock, live }: AppProps) {
  const dashboard = useDashboard(api, clock, live);
  const { view } = dashboard;
  const loading = dashboard.status === 'loading';
  const offline = dashboard.status === 'error' || dashboard.status === 'retrying';
  const empty = view?.isEmpty ?? false;

  const chartBody = (chart: () => ReactNode): ChartBody => {
    if (loading) return { status: 'loading' };
    if (offline) return { status: 'message', message: 'Data unavailable' };
    if (!view || empty) return { status: 'message', message: 'No level data yet' };
    return { status: 'ready', chart: chart() };
  };

  return (
    <main className={styles.page}>
      <Header
        statusText={dashboard.statusText}
        isLive={dashboard.live === 'live'}
        isRefreshing={dashboard.status === 'refreshing'}
        canRefresh={dashboard.canRefresh}
        onRefresh={dashboard.refresh}
      />

      {empty && <Notice tone="info" message={dashboard.live === 'live' ? 'No gameplay recorded yet. Play a level in the game: it appears here as it happens.' : 'No gameplay recorded yet. Play a level in the game, then click Refresh.'} />}
      {offline && (
        <Notice
          tone="error"
          title="Analytics backend is unreachable"
          message="Check that the backend and Firestore emulator are running, then retry."
          action={{ label: dashboard.status === 'retrying' ? 'Retrying…' : 'Retry', disabled: !dashboard.canRetry, onClick: dashboard.retry }}
        />
      )}

      {view ? <KpiGrid status="ready" kpis={view.kpis} /> : <KpiGrid status={loading ? 'loading' : 'unavailable'} />}

      <div className={styles.charts}>
        <ChartCard
          title="Completion rate by level"
          subtitle="Difficulty curve: finished runs that cleared the level."
          source={`${SOURCE} · completionRate`}
          body={chartBody(() => view && <CompletionChart rows={view.completion} />)}
        />
        <ChartCard
          title="Failed runs by progress"
          subtitle="Where in the level players fail: share of fruit target reached."
          source={`${SOURCE} · failedByProgress`}
          body={chartBody(() => view && <StackedBarChart label="Failed runs by progress" chart={view.progress} palette="progress" />)}
        />
        <ChartCard
          title="Failed runs by reason"
          subtitle="Why players fail on each level."
          source={`${SOURCE} · failedByReason`}
          body={chartBody(() => view && <StackedBarChart label="Failed runs by reason" chart={view.reasons} palette="reason" />)}
        />
      </div>

      {loading ? (
        <LevelTable status="loading" />
      ) : offline || !view ? (
        <LevelTable status="message" message="Data unavailable" />
      ) : empty ? (
        <LevelTable status="message" message="No levels played yet" />
      ) : (
        <LevelTable status="ready" rows={view.table} />
      )}

      <footer className={styles.footer}>Data from the local analytics backend · read only{dashboard.live === 'live' ? ' · live' : ''}</footer>
    </main>
  );
}
