import type { RunEndReason } from '../../application/gameEvents';

/** Documented `EventParams` of the Famobi GameInterface. */
export type FamobiEventParams = {
  metrics?: Record<string, number | string | boolean | null>;
};

export type FamobiScoreType = 'live' | 'total' | 'level' | 'stage';

export type FamobiStorage = {
  getItem(key: string): unknown;
  setItem(key: string, value: unknown): void;
};

/** The part of the Famobi GameInterface (https://docs.famobi.com/api) that Neon Snake uses. */
export interface FamobiGameInterface {
  sendPreloadProgress(progress: number): void;
  gameReady(isPlayerReady?: boolean): void;

  gameStart(level?: number, params?: FamobiEventParams): Promise<void>;
  gameEnd(reason: RunEndReason, params?: FamobiEventParams): Promise<void>;
  gameFinished(params?: FamobiEventParams): Promise<void>;
  gamePause(params?: FamobiEventParams): Promise<void>;
  gameResume(params?: FamobiEventParams): Promise<void>;

  sendScore(score: number, params?: { type?: FamobiScoreType; level?: number; stage?: number }): void;
  sendProgress(progress: number): void;

  gameMuted(isMuted?: boolean): void;
  isMuted(): boolean;
  onMuteStateChange(callback: (isMuted: boolean) => void): void;
  isPaused(): boolean;
  onPauseStateChange(callback: (isPaused: boolean) => void): void;

  onGoToHome(callback: () => void): void;
  onGoToNextLevel(callback: () => void): void;
  onGoToLevel(callback: (level: number) => void): void;
  onRestartGame(callback: () => void): void;
  onQuitGame(callback: () => void): void;
  onGameOver(callback: () => void): void;

  storage: FamobiStorage;
}

declare global {
  interface Window {
    GameInterface?: FamobiGameInterface;
  }
}

/** The GameInterface installed by init.js, or undefined where init.js stays inactive (e.g. GitHub Pages). */
export const getGameInterface = (): FamobiGameInterface | undefined =>
  typeof window === 'undefined' ? undefined : window.GameInterface;
