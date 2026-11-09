import type { LevelStats, Overview } from '@neon-snake/contract';
import { StatsUnavailableError, type StatsApi } from './StatsApi';

type Answer<T> = T | StatsUnavailableError;

/**
 * Test double: answers with whatever was last set. `hold()` keeps every request pending until
 * `release()`, so tests can look at the page while a load runs.
 */
export class FakeStatsApi implements StatsApi {
  overview: Answer<Overview>;
  levels: Answer<LevelStats[]>;
  calls = { overview: 0, levels: 0 };
  /** Every signal a request was made with, to check cancellation. */
  signals: AbortSignal[] = [];

  private held: (() => void)[] | null = null;

  constructor(overview: Answer<Overview>, levels: Answer<LevelStats[]>) {
    this.overview = overview;
    this.levels = levels;
  }

  getOverview(signal?: AbortSignal): Promise<Overview> {
    this.calls.overview += 1;
    return this.answer(() => this.overview, signal);
  }

  getLevels(signal?: AbortSignal): Promise<LevelStats[]> {
    this.calls.levels += 1;
    return this.answer(() => this.levels, signal);
  }

  hold(): void {
    this.held ??= [];
  }

  release(): void {
    const waiting = this.held ?? [];
    this.held = null;
    waiting.forEach((resume) => resume());
  }

  private answer<T>(current: () => Answer<T>, signal?: AbortSignal): Promise<T> {
    if (signal) this.signals.push(signal);
    return new Promise<T>((resolve, reject) => {
      const settle = () => {
        if (signal?.aborted) return reject(signal.reason);
        const value = current();
        if (value instanceof StatsUnavailableError) reject(value);
        else resolve(value);
      };
      if (this.held) this.held.push(settle);
      else queueMicrotask(settle);
    });
  }
}
