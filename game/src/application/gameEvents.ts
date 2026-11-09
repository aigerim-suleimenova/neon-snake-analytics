import type { FailureReason, GameSnapshot, PauseSource } from '../game/types';

export type RunEndReason = 'complete' | 'fail' | 'quit';

export type GameEventMap = {
  ready: { occurredAt: number };
  runStarted: { level: number; runNumber: number; occurredAt: number };
  runEnded: {
    level: number;
    score: number;
    /** Points earned in this level only. */
    levelScore: number;
    progress: number;
    reason: RunEndReason;
    /** Set only when the reason is `fail`. */
    failureReason: FailureReason | null;
    durationMs: number;
    occurredAt: number;
  };
  scoreChanged: { level: number; score: number; delta: number };
  progressChanged: { level: number; progress: number; collected: number; target: number };
  pauseChanged: { paused: boolean; source: PauseSource };
  audioChanged: { playerMuted: boolean; systemMuted: boolean; effectiveMuted: boolean };
  gameFinished: { score: number; bestScore: number };
  busyChanged: { busy: boolean };
  systemPauseChanged: { paused: boolean };
  stateChanged: GameSnapshot;
};
