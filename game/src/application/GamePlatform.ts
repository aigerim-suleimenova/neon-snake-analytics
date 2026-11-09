import type { RunEndReason } from './gameEvents';

export type RunSummary = {
  level: number;
  /** Running score shown on screen; it carries over between levels. */
  score: number;
  /** Points earned in this level only. */
  levelScore: number;
  /** Share of the level's fruit target, from 0 to 1. */
  progress: number;
  durationMs: number;
};

/**
 * Moments a hosting platform can hold gameplay on. The controller awaits each call
 * before it changes the game, so an implementation can show an ad or a transition.
 */
export interface GamePlatform {
  startRun(level: number): Promise<void>;
  endRun(reason: RunEndReason, summary: RunSummary): Promise<void>;
  finishGame(summary: RunSummary): Promise<void>;
  pauseRun(): Promise<void>;
  resumeRun(): Promise<void>;
}

export const offlinePlatform: GamePlatform = {
  startRun: async () => {},
  endRun: async () => {},
  finishGame: async () => {},
  pauseRun: async () => {},
  resumeRun: async () => {}
};
