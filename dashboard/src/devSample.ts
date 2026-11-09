import { FakeStatsApi } from './api/FakeStatsApi';
import { emptyOverview, sampleLevels, sampleOverview } from './api/sampleStats';
import { StatsUnavailableError, type StatsApi } from './api/StatsApi';

/**
 * Development only: `?sample` serves the design reference's sample data instead of the backend, to compare
 * the app with the design. `?sample=empty`, `?sample=error` and `?sample=loading` show the other states.
 */
export const createSampleApi = (mode: string): StatsApi => {
  if (mode === 'empty') return new FakeStatsApi(emptyOverview, []);
  if (mode === 'error') return new FakeStatsApi(new StatsUnavailableError('sample error'), sampleLevels);
  const api = new FakeStatsApi(sampleOverview, sampleLevels);
  if (mode === 'loading') api.hold();
  return api;
};
