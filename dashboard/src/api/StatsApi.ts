import type { LevelStats, Overview } from '@neon-snake/contract';

/** What the dashboard needs from the analytics backend. */
export interface StatsApi {
  getOverview(signal?: AbortSignal): Promise<Overview>;
  getLevels(signal?: AbortSignal): Promise<LevelStats[]>;
}

/** The backend could not deliver valid statistics: no answer, a timeout, a non-2xx status or an invalid body. */
export class StatsUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StatsUnavailableError';
  }
}
