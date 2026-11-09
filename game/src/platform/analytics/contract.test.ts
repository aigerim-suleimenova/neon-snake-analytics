import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateEvent } from '@neon-snake/contract/schemas';

import { GameController } from '../../application/GameController';
import { offlinePlatform } from '../../application/GamePlatform';
import type { GameStorage } from '../../core/storage/GameStorage';
import { SnakeGame } from '../../game/snakeGame';
import { spawnFoodAhead } from '../../test/spawnFoodAhead';
import type { AnalyticsEvent } from './AnalyticsEvent';
import { connectAnalytics } from './connectAnalytics';

const START = Date.parse('2026-10-01T12:00:00.000Z');
const TICK_MS = 150;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The real controller and simulation with the offline platform; fruit always spawns in front of the snake. */
const setup = () => {
  const simulation = new SnakeGame();
  spawnFoodAhead(simulation);
  const storage: GameStorage = {
    loadProfile: () => ({ bestScore: 0, highestUnlockedLevel: 1, totalRuns: 0, playerMuted: false }),
    saveProfile: () => {}
  };
  const controller = new GameController(simulation, storage, offlinePlatform);
  const sent: AnalyticsEvent[] = [];
  let counter = 0;
  connectAnalytics(controller.events, { send: (event) => sent.push(event) }, () => `id-${(counter += 1)}`);

  /** Advances the game by up to `count` steps, stopping when the level ends. */
  const play = async (count: number) => {
    for (let step = 0; step < count && controller.getSnapshot().phase === 'playing'; step += 1) {
      vi.setSystemTime(Date.now() + TICK_MS);
      controller.tick();
    }
    await flush();
  };
  return { controller, sent, play };
};

beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.useFakeTimers({ toFake: ['Date'], now: START });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('analytics contract', () => {
  // The types already match the shared contract; this checks the rules only the backend's validation knows,
  // e.g. progress is 100 exactly when a run is complete, on the events real play produces.
  it('produces events the backend accepts, for every way a run can end', async () => {
    const { controller, sent, play } = setup();

    await controller.startNewGame();
    await play(10);
    expect(controller.getSnapshot().phase).toBe('level-complete');

    await controller.goToNextLevel();
    await play(10);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'game-over', failureReason: 'obstacle' });

    await controller.restartLevel();
    await play(1);
    await controller.quitToMenu();
    await flush();

    await controller.startAtLevel(1);
    await play(1);

    const now = new Date(Date.now());
    expect(sent.map((event) => validateEvent(event, now)).filter((result) => !result.ok)).toEqual([]);
    expect(sent.map((event) => [event.type, event.level, event.type === 'run_ended' ? event.outcome : null])).toEqual([
      ['run_started', 1, null],
      ['run_ended', 1, 'complete'],
      ['run_started', 2, null],
      ['run_ended', 2, 'fail'],
      ['run_started', 2, null],
      ['run_ended', 2, 'quit'],
      ['run_started', 1, null]
    ]);
  });
});
