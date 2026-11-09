import { vi } from 'vitest';

import { BOARD_SIZE } from '../game/levels';
import type { SnakeGame } from '../game/snakeGame';
import type { Point } from '../game/types';

const vectors = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const includesPoint = (points: Point[], point: Point) => points.some((entry) => entry.x === point.x && entry.y === point.y);

/**
 * Stubs Math.random so every fruit spawns on the cell in front of the snake's head.
 * Each step then eats a fruit, which makes clearing or failing a level deterministic.
 * The scan mirrors SnakeGame.placeFood: row by row, skipping the snake and obstacles.
 */
export const spawnFoodAhead = (simulation: SnakeGame) =>
  vi.spyOn(Math, 'random').mockImplementation(() => {
    const { snake, obstacles, direction } = simulation.getSnapshot();
    const target = { x: snake[0].x + vectors[direction].x, y: snake[0].y + vectors[direction].y };
    const available: Point[] = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const point = { x, y };
        if (!includesPoint(snake, point) && !includesPoint(obstacles, point)) available.push(point);
      }
    }
    const index = available.findIndex((point) => point.x === target.x && point.y === target.y);
    return index < 0 ? 0 : (index + 0.5) / available.length;
  });
