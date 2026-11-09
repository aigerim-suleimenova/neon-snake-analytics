import type { z } from 'zod';

import type { LevelStats, Overview } from '@neon-snake/contract';
import { LevelsResponseSchema, OverviewSchema } from '@neon-snake/contract/schemas';
import { StatsUnavailableError, type StatsApi } from './StatsApi';

export interface HttpStatsApiOptions {
  /** Backend address, e.g. http://localhost:3000. */
  baseUrl: string;
  fetch: typeof fetch;
  /** Above the backend's 3 s store deadline, so its 503 normally arrives first. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Reads the statistics over HTTP and checks every answer against the documented shape. */
export class HttpStatsApi implements StatsApi {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpStatsApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetch = options.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getOverview(signal?: AbortSignal): Promise<Overview> {
    return this.get('/api/stats/overview', OverviewSchema, signal);
  }

  async getLevels(signal?: AbortSignal): Promise<LevelStats[]> {
    return (await this.get('/api/stats/levels', LevelsResponseSchema, signal)).levels;
  }

  private async get<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetch(this.baseUrl + path, { signal: combined });
      if (!response.ok) throw new StatsUnavailableError(`${path} answered ${response.status}`);
      const body: unknown = await response.json().catch((error: unknown) => {
        throw new StatsUnavailableError(`${path} returned an unexpected body`, { cause: error });
      });
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new StatsUnavailableError(`${path} returned an unexpected body`, { cause: parsed.error });
      return parsed.data;
    } catch (error) {
      // A load the caller cancelled (e.g. on unmount) is not a backend failure; let it through as is.
      if (signal?.aborted) throw error;
      if (error instanceof StatsUnavailableError) throw error;
      const reason = timeout.aborted ? `timed out after ${this.timeoutMs} ms` : 'could not be reached';
      throw new StatsUnavailableError(`${path} ${reason}`, { cause: error });
    }
  }
}
