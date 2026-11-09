import { afterEach, describe, expect, it, vi } from 'vitest';

import { spawnFoodAhead } from '../test/spawnFoodAhead';
import { SnakeGame } from './snakeGame';

afterEach(() => vi.restoreAllMocks());

describe('SnakeGame levelScore', () => {
  it('counts only the points earned in the current level', () => {
    const game = new SnakeGame();
    spawnFoodAhead(game);
    game.start();
    expect(game.getSnapshot().levelScore).toBe(0);

    for (let fruit = 0; fruit < 5; fruit += 1) game.step();
    expect(game.getSnapshot()).toMatchObject({ phase: 'level-complete', score: 50, levelScore: 50 });

    game.nextLevel();
    expect(game.getSnapshot()).toMatchObject({ level: 2, score: 50, levelScore: 0 });

    game.step();
    expect(game.getSnapshot()).toMatchObject({ score: 70, levelScore: 20 });
  });

  it('resets to zero when the level is retried', () => {
    const game = new SnakeGame();
    spawnFoodAhead(game);
    game.start();
    game.step();
    game.forceGameOver();

    game.restartLevel();
    expect(game.getSnapshot()).toMatchObject({ phase: 'playing', score: 0, levelScore: 0 });
  });
});
