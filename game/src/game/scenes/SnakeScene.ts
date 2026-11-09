import Phaser from 'phaser';

import { GameController } from '../../application/GameController';
import { getSwipeDirection, mapKeyboardInput, type InputAction } from '../input';
import { BOARD_SIZE, getLevelConfig } from '../levels';
import type { Direction, GameSnapshot, Point } from '../types';

const palette = {
  board: 0x10182c,
  grid: 0x273552,
  snake: 0x99f725,
  snakeTail: 0x46d68c,
  fruit: 0xff5975,
  fruitStem: 0xffb35c,
  obstacle: 0x344263,
  obstacleEdge: 0x52648c,
  eyes: 0x09101f
};

export class SnakeScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private timer: Phaser.Time.TimerEvent | null = null;
  private unsubscribe: (() => void) | null = null;
  private pointerStart: Point | null = null;

  constructor(private readonly controller: GameController) {
    super({ key: 'SnakeScene' });
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.game.canvas.tabIndex = 0;
    this.game.canvas.setAttribute('aria-label', 'Neon Snake playfield');

    this.unsubscribe = this.controller.subscribe((snapshot) => {
      this.draw(snapshot);
      this.syncTimer(snapshot);
    });
    this.controller.markReady();

    this.input.keyboard?.on('keydown', this.handleKeyDown);
    this.input.on('pointerdown', this.handlePointerDown);
    this.input.on('pointerup', this.handlePointerUp);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const action = mapKeyboardInput(event);
    if (!action) return;
    event.preventDefault();
    this.handleAction(action);
  };

  private handleAction(action: InputAction): void {
    if (action.type === 'move') {
      this.controller.move(action.direction);
      return;
    }

    const snapshot = this.controller.getSnapshot();
    if (action.type === 'pause') {
      this.controller.togglePlayerPause();
      return;
    }

    if (snapshot.phase === 'menu' || snapshot.phase === 'finished') this.controller.startNewGame();
    else if (snapshot.phase === 'paused' && snapshot.pauseSource === 'player') this.controller.togglePlayerPause();
    else if (snapshot.phase === 'level-complete') this.controller.goToNextLevel();
    else if (snapshot.phase === 'game-over') this.controller.restartLevel();
  }

  private handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    this.game.canvas.focus({ preventScroll: true });
    this.pointerStart = { x: pointer.x, y: pointer.y };
  };

  private handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (!this.pointerStart) return;
    const direction = getSwipeDirection(pointer.x - this.pointerStart.x, pointer.y - this.pointerStart.y);
    this.pointerStart = null;
    if (direction) this.controller.move(direction);
  };

  private syncTimer(snapshot: GameSnapshot): void {
    if (snapshot.phase !== 'playing') {
      this.stopTimer();
      return;
    }

    if (this.timer) return;
    this.timer = this.time.delayedCall(getLevelConfig(snapshot.level).tickMs, () => {
      this.timer = null;
      this.controller.tick();
    });
  }

  private stopTimer(): void {
    this.timer?.remove(false);
    this.timer = null;
  }

  private draw(snapshot: GameSnapshot): void {
    const size = 600;
    const cell = size / BOARD_SIZE;
    this.graphics.clear();
    this.graphics.fillStyle(palette.board, 1);
    this.graphics.fillRect(0, 0, size, size);

    this.drawGrid(cell, size);
    snapshot.obstacles.forEach((obstacle) => this.drawObstacle(obstacle, cell));
    this.drawFood(snapshot.food, cell);
    this.drawSnake(snapshot, cell);
  }

  private drawGrid(cell: number, size: number): void {
    this.graphics.lineStyle(1, palette.grid, 0.42);
    for (let index = 1; index < BOARD_SIZE; index += 1) {
      const coordinate = Math.round(index * cell) + 0.5;
      this.graphics.lineBetween(coordinate, 0, coordinate, size);
      this.graphics.lineBetween(0, coordinate, size, coordinate);
    }
  }

  private drawObstacle(point: Point, cell: number): void {
    const padding = cell * 0.12;
    const x = point.x * cell + padding;
    const y = point.y * cell + padding;
    const size = cell - padding * 2;

    this.graphics.fillStyle(palette.obstacle, 1);
    this.graphics.fillRoundedRect(x, y, size, size, cell * 0.16);
    this.graphics.lineStyle(2, palette.obstacleEdge, 1);
    this.graphics.strokeRoundedRect(x, y, size, size, cell * 0.16);
  }

  private drawFood(point: Point, cell: number): void {
    const centerX = point.x * cell + cell / 2;
    const centerY = point.y * cell + cell / 2;
    const radius = cell * 0.28;

    this.graphics.fillStyle(palette.fruit, 0.16);
    this.graphics.fillCircle(centerX, centerY, radius * 1.75);
    this.graphics.fillStyle(palette.fruit, 1);
    this.graphics.fillCircle(centerX, centerY, radius);
    this.graphics.lineStyle(Math.max(2, cell * 0.08), palette.fruitStem, 1);
    this.graphics.lineBetween(centerX, centerY - radius * 0.75, centerX + radius * 0.28, centerY - radius * 1.35);
  }

  private drawSnake(snapshot: GameSnapshot, cell: number): void {
    snapshot.snake
      .slice()
      .reverse()
      .forEach((segment, reverseIndex) => {
        const index = snapshot.snake.length - reverseIndex - 1;
        const ratio = snapshot.snake.length <= 1 ? 0 : index / (snapshot.snake.length - 1);
        const padding = index === 0 ? cell * 0.08 : cell * 0.12;
        const x = segment.x * cell + padding;
        const y = segment.y * cell + padding;
        const size = cell - padding * 2;

        this.graphics.fillStyle(this.mixColor(palette.snake, palette.snakeTail, ratio), 1);
        this.graphics.fillRoundedRect(x, y, size, size, cell * 0.28);
        if (index === 0) this.drawEyes(segment, snapshot.direction, cell);
      });
  }

  private drawEyes(head: Point, direction: Direction, cell: number): void {
    const centerX = head.x * cell + cell / 2;
    const centerY = head.y * cell + cell / 2;
    const forward = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    }[direction];
    const side = { x: -forward.y, y: forward.x };

    this.graphics.fillStyle(palette.eyes, 1);
    [-1, 1].forEach((sideMultiplier) => {
      const x = centerX + forward.x * cell * 0.2 + side.x * sideMultiplier * cell * 0.16;
      const y = centerY + forward.y * cell * 0.2 + side.y * sideMultiplier * cell * 0.16;
      this.graphics.fillCircle(x, y, cell * 0.055);
    });
  }

  private mixColor(first: number, second: number, amount: number): number {
    const channel = (shift: number) => {
      const from = (first >> shift) & 255;
      const to = (second >> shift) & 255;
      return Math.round(from + (to - from) * amount);
    };

    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }

  private shutdown(): void {
    this.stopTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.input.keyboard?.off('keydown', this.handleKeyDown);
    this.input.off('pointerdown', this.handlePointerDown);
    this.input.off('pointerup', this.handlePointerUp);
  }
}
