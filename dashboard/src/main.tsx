import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { EventSourceLiveStats } from './api/EventSourceLiveStats';
import { HttpStatsApi } from './api/HttpStatsApi';
import type { LiveStatsSource } from './api/LiveStatsSource';
import type { StatsApi } from './api/StatsApi';
import { App } from './App';
import { systemClock } from './clock';

import './styles/global.css';

const DEFAULT_API_URL = 'http://localhost:3000';

const baseUrl = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
const sample = new URLSearchParams(location.search).get('sample');

const createApi = async (): Promise<StatsApi> => {
  // The sample switch and its test double are left out of production builds.
  if (import.meta.env.DEV && sample !== null) return (await import('./devSample')).createSampleApi(sample);
  return new HttpStatsApi({ baseUrl, fetch: window.fetch.bind(window) });
};

// Sample data never changes, so it gets no live stream.
const live: LiveStatsSource | undefined =
  import.meta.env.DEV && sample !== null ? undefined : new EventSourceLiveStats({ url: `${baseUrl}/api/stats/stream`, createEventSource: (url) => new EventSource(url) });

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const api = await createApi();
createRoot(root).render(
  <StrictMode>
    <App api={api} clock={systemClock} live={live} />
  </StrictMode>
);
