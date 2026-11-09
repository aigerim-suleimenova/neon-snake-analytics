export type Direction = 'up' | 'down' | 'left' | 'right';

export type GamePhase = 'menu' | 'playing' | 'paused' | 'level-complete' | 'game-over' | 'finished';

export type PauseSource = 'player' | 'system' | null;

export type Point = {
  x: number;
  y: number;
};

export type LevelConfig = {
  level: number;
  target: number;
  tickMs: number;
  obstacles: Point[];
};

export type GameSnapshot = {
  phase: GamePhase;
  level: number;
  score: number;
  levelScore: number;
  fruitEaten: number;
  target: number;
  progress: number;
  snake: Point[];
  food: Point;
  obstacles: Point[];
  direction: Direction;
  pauseSource: PauseSource;
  failureReason: FailureReason | null;
};

/** What ended a failed level; `external` is a game over requested by the platform. */
export type FailureReason = 'wall' | 'snake' | 'obstacle' | 'external';

export type GameListener = (snapshot: GameSnapshot) => void;
