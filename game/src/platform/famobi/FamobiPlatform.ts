import type { RunEndReason } from '../../application/gameEvents';
import type { GamePlatform, RunSummary } from '../../application/GamePlatform';
import type { FamobiEventParams, FamobiGameInterface } from './FamobiGameInterface';

/** A 0-1 share as the integer percentage the SDK expects. */
export const toPercent = (share: number): number => Math.round(Math.min(1, Math.max(0, share)) * 100);

const metricsOf = (summary: RunSummary): FamobiEventParams => ({
  metrics: {
    level: summary.level,
    score: summary.score,
    levelScore: summary.levelScore,
    durationMs: summary.durationMs,
    progress: toPercent(summary.progress)
  }
});

/** The awaited gameplay moments, reported to the Famobi GameInterface. */
export class FamobiPlatform implements GamePlatform {
  // The SDK accepts gameFinished only once per session and flags any event after it.
  private gameFinishedSent = false;

  constructor(private readonly sdk: FamobiGameInterface) {}

  startRun(level: number): Promise<void> {
    return this.sdk.gameStart(level);
  }

  endRun(reason: RunEndReason, summary: RunSummary): Promise<void> {
    this.sdk.sendScore(summary.levelScore, { type: 'level', level: summary.level });
    this.sdk.sendScore(summary.score, { type: 'total' });
    return this.sdk.gameEnd(reason, metricsOf(summary));
  }

  async finishGame(): Promise<void> {
    if (this.gameFinishedSent) return;
    this.gameFinishedSent = true;
    await this.sdk.gameFinished();
  }

  pauseRun(): Promise<void> {
    return this.sdk.gamePause();
  }

  resumeRun(): Promise<void> {
    return this.sdk.gameResume();
  }
}
