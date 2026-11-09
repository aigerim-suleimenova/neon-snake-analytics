import { BOARD_SIZE, getLevelConfig, LEVELS } from './levels';
import type { Direction, GameListener, GamePhase, GameSnapshot, PauseSource, Point } from './types';

const directionVectors: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const oppositeDirections: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left'
};

const samePoint = (first: Point, second: Point) => first.x === second.x && first.y === second.y;

export class SnakeGame {
  private phase: GamePhase = 'menu';
  private level = 1;
  private score = 0;
  private scoreAtLevelStart = 0;
  private fruitEaten = 0;
  private snake: Point[] = [];
  private food: Point = { x: 15, y: 10 };
  private direction: Direction = 'right';
  private queuedDirection: Direction = 'right';
  private pauseSource: PauseSource = null;
  private failureReason: GameSnapshot['failureReason'] = null;
  private listeners = new Set<GameListener>();

  constructor() {
    this.resetBoard();
  }

  subscribe(listener: GameListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): GameSnapshot {
    const config = getLevelConfig(this.level);

    return {
      phase: this.phase,
      level: this.level,
      score: this.score,
      levelScore: this.score - this.scoreAtLevelStart,
      fruitEaten: this.fruitEaten,
      target: config.target,
      progress: this.fruitEaten / config.target,
      snake: this.snake.map((point) => ({ ...point })),
      food: { ...this.food },
      obstacles: config.obstacles.map((point) => ({ ...point })),
      direction: this.direction,
      pauseSource: this.pauseSource,
      failureReason: this.failureReason
    };
  }

  start(): void {
    this.level = 1;
    this.score = 0;
    this.scoreAtLevelStart = 0;
    this.startLevel();
  }

  startAtLevel(level: number): void {
    getLevelConfig(level);
    this.level = level;
    this.score = 0;
    this.scoreAtLevelStart = 0;
    this.startLevel();
  }

  restartLevel(): void {
    this.score = this.scoreAtLevelStart;
    this.startLevel();
  }

  nextLevel(): void {
    if (this.phase !== 'level-complete') return;
    this.level += 1;
    this.scoreAtLevelStart = this.score;
    this.startLevel();
  }

  pause(source: Exclude<PauseSource, null>): void {
    if (this.phase !== 'playing' && this.phase !== 'paused') return;
    if (this.phase === 'paused' && this.pauseSource === source) return;
    this.phase = 'paused';
    this.pauseSource = source;
    this.emit();
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.pauseSource = null;
    this.emit();
  }

  quitToMenu(): void {
    if (this.phase === 'menu') return;
    this.phase = 'menu';
    this.emit();
  }

  setDirection(direction: Direction): void {
    if (this.phase !== 'playing') return;
    if (oppositeDirections[this.direction] === direction) return;
    this.queuedDirection = direction;
  }

  forceGameOver(): void {
    if (this.phase !== 'playing' && this.phase !== 'paused') return;
    this.fail('external');
  }

  step(): void {
    if (this.phase !== 'playing') return;

    this.direction = this.queuedDirection;
    const head = this.snake[0];
    const vector = directionVectors[this.direction];
    const nextHead = { x: head.x + vector.x, y: head.y + vector.y };

    if (this.isOutsideBoard(nextHead)) {
      this.fail('wall');
      return;
    }

    const config = getLevelConfig(this.level);
    if (config.obstacles.some((obstacle) => samePoint(obstacle, nextHead))) {
      this.fail('obstacle');
      return;
    }

    const eatsFood = samePoint(nextHead, this.food);
    const collisionBody = eatsFood ? this.snake : this.snake.slice(0, -1);
    if (collisionBody.some((segment) => samePoint(segment, nextHead))) {
      this.fail('snake');
      return;
    }

    this.snake.unshift(nextHead);

    if (eatsFood) {
      this.fruitEaten += 1;
      this.score += this.level * 10;

      if (this.fruitEaten >= config.target) {
        this.phase = this.level === LEVELS.length ? 'finished' : 'level-complete';
        this.emit();
        return;
      }

      this.food = this.placeFood();
    } else {
      this.snake.pop();
    }

    this.emit();
  }

  private startLevel(): void {
    this.phase = 'playing';
    this.pauseSource = null;
    this.fruitEaten = 0;
    this.failureReason = null;
    this.resetBoard();
    this.emit();
  }

  private resetBoard(): void {
    const center = Math.floor(BOARD_SIZE / 2);
    this.snake = [
      { x: center, y: center },
      { x: center - 1, y: center },
      { x: center - 2, y: center }
    ];
    this.direction = 'right';
    this.queuedDirection = 'right';
    this.food = this.placeFood();
  }

  private placeFood(): Point {
    const obstacles = getLevelConfig(this.level).obstacles;
    const available: Point[] = [];

    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const point = { x, y };
        const occupied = this.snake.some((segment) => samePoint(segment, point));
        const blocked = obstacles.some((obstacle) => samePoint(obstacle, point));
        if (!occupied && !blocked) available.push(point);
      }
    }

    return available[Math.floor(Math.random() * available.length)] ?? { x: 1, y: 1 };
  }

  private isOutsideBoard(point: Point): boolean {
    return point.x < 0 || point.y < 0 || point.x >= BOARD_SIZE || point.y >= BOARD_SIZE;
  }

  private fail(reason: NonNullable<GameSnapshot['failureReason']>): void {
    this.failureReason = reason;
    this.phase = 'game-over';
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
