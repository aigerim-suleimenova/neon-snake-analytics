import type { LevelConfig, Point } from './types';

const verticalLine = (x: number, fromY: number, toY: number): Point[] =>
  Array.from({ length: toY - fromY + 1 }, (_, index) => ({ x, y: fromY + index }));

const horizontalLine = (y: number, fromX: number, toX: number): Point[] =>
  Array.from({ length: toX - fromX + 1 }, (_, index) => ({ x: fromX + index, y }));

export const BOARD_SIZE = 20;

export const LEVELS: LevelConfig[] = [
  {
    level: 1,
    target: 5,
    tickMs: 150,
    obstacles: []
  },
  {
    level: 2,
    target: 7,
    tickMs: 125,
    obstacles: [...verticalLine(6, 5, 10), ...verticalLine(13, 9, 14)]
  },
  {
    level: 3,
    target: 9,
    tickMs: 105,
    obstacles: [
      ...horizontalLine(5, 4, 8),
      ...horizontalLine(5, 11, 15),
      ...horizontalLine(14, 4, 8),
      ...horizontalLine(14, 11, 15)
    ]
  }
];

export const getLevelConfig = (level: number): LevelConfig => {
  const config = LEVELS.find((entry) => entry.level === level);
  if (!config) throw new Error(`Unknown level: ${level}`);
  return config;
};
