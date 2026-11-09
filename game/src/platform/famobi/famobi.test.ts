import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameController } from '../../application/GameController';
import type { GameStorage, PlayerProfile } from '../../core/storage/GameStorage';
import { SnakeGame } from '../../game/snakeGame';
import { spawnFoodAhead } from '../../test/spawnFoodAhead';
import { connectFamobi } from './connectFamobi';
import type { FamobiGameInterface } from './FamobiGameInterface';
import { FamobiPlatform } from './FamobiPlatform';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Records every SDK call; awaited events resolve at once, and registered callbacks can be triggered. */
const fakeGameInterface = ({ paused = false, muted = false } = {}) => {
  const calls: unknown[][] = [];
  const callbacks: Record<string, (value?: unknown) => void> = {};
  const call =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const awaited =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve();
    };
  const register =
    <Value,>(name: string) =>
    (callback: (value: Value) => void) => {
      callbacks[name] = callback as (value?: unknown) => void;
    };
  const sdk: FamobiGameInterface = {
    sendPreloadProgress: call('sendPreloadProgress'),
    gameReady: call('gameReady'),
    gameStart: awaited('gameStart'),
    gameEnd: awaited('gameEnd'),
    gameFinished: awaited('gameFinished'),
    gamePause: awaited('gamePause'),
    gameResume: awaited('gameResume'),
    sendScore: call('sendScore'),
    sendProgress: call('sendProgress'),
    gameMuted: call('gameMuted'),
    isMuted: () => muted,
    onMuteStateChange: register('onMuteStateChange'),
    isPaused: () => paused,
    onPauseStateChange: register('onPauseStateChange'),
    onGoToHome: register('onGoToHome'),
    onGoToNextLevel: register('onGoToNextLevel'),
    onGoToLevel: register('onGoToLevel'),
    onRestartGame: register('onRestartGame'),
    onQuitGame: register('onQuitGame'),
    onGameOver: register('onGameOver'),
    storage: { getItem: () => null, setItem: () => undefined }
  };
  const named = (name: string) => calls.filter((entry) => entry[0] === name);
  return { sdk, calls, callbacks, named };
};

const summary = { level: 2, score: 120, levelScore: 70, progress: 0.4, durationMs: 1234 };

beforeEach(() => vi.stubGlobal('window', {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FamobiPlatform', () => {
  it('waits for gameStart with the level number', async () => {
    const { sdk, calls } = fakeGameInterface();
    await new FamobiPlatform(sdk).startRun(3);
    expect(calls).toEqual([['gameStart', 3]]);
  });

  it('sends the level and total score, then gameEnd with metrics and progress in percent', async () => {
    const { sdk, calls } = fakeGameInterface();
    await new FamobiPlatform(sdk).endRun('complete', summary);
    expect(calls).toEqual([
      ['sendScore', 70, { type: 'level', level: 2 }],
      ['sendScore', 120, { type: 'total' }],
      ['gameEnd', 'complete', { metrics: { level: 2, score: 120, levelScore: 70, durationMs: 1234, progress: 40 } }]
    ]);
  });

  it('sends gameFinished only once per session', async () => {
    const { sdk, named } = fakeGameInterface();
    const platform = new FamobiPlatform(sdk);
    await platform.finishGame();
    await platform.finishGame();
    expect(named('gameFinished')).toHaveLength(1);
  });

  it('waits for gamePause and gameResume', async () => {
    const { sdk, calls } = fakeGameInterface();
    const platform = new FamobiPlatform(sdk);
    await platform.pauseRun();
    await platform.resumeRun();
    expect(calls).toEqual([['gamePause'], ['gameResume']]);
  });
});

describe('connectFamobi', () => {
  const setup = (options: { paused?: boolean; muted?: boolean; profile?: Partial<PlayerProfile> } = {}) => {
    const fake = fakeGameInterface(options);
    const simulation = new SnakeGame();
    spawnFoodAhead(simulation);
    const storage: GameStorage = {
      loadProfile: () => ({ bestScore: 0, highestUnlockedLevel: 1, totalRuns: 0, playerMuted: false, ...options.profile }),
      saveProfile: () => undefined
    };
    const controller = new GameController(simulation, storage, new FamobiPlatform(fake.sdk));
    connectFamobi(controller, fake.sdk);
    const start = async (begin: () => Promise<void> = () => controller.startNewGame()) => {
      await begin();
      await flush();
    };
    return { ...fake, controller, start, snapshot: () => controller.getSnapshot() };
  };

  it('reports preload progress, then gameReady when the title screen is ready', () => {
    const { controller, calls } = setup();
    expect(calls[0]).toEqual(['sendPreloadProgress', 0]);

    controller.markReady();
    expect(calls.slice(-2)).toEqual([['sendPreloadProgress', 100], ['gameReady']]);
  });

  it('reports the live score and integer progress without repeats', async () => {
    const { controller, named, start } = setup();
    await start();

    controller.tick();
    controller.tick();
    expect(named('sendScore')).toEqual([
      ['sendScore', 10, { level: 1 }],
      ['sendScore', 20, { level: 1 }]
    ]);
    expect(named('sendProgress')).toEqual([
      ['sendProgress', 20],
      ['sendProgress', 40]
    ]);
  });

  it('applies the platform pause at startup and on change', () => {
    const { callbacks, controller } = setup({ paused: true });
    expect(controller.isSystemPaused()).toBe(true);

    callbacks.onPauseStateChange(false);
    expect(controller.isSystemPaused()).toBe(false);
  });

  it('applies the master mute without touching the player choice, and reports only player changes', () => {
    const { callbacks, controller, named } = setup({ muted: true });
    expect(controller.getAudioState()).toMatchObject({ systemMuted: true, playerMuted: false });
    expect(named('gameMuted')).toEqual([['gameMuted', false]]);

    callbacks.onMuteStateChange(false);
    controller.togglePlayerMuted();
    expect(controller.getAudioState()).toMatchObject({ systemMuted: false, playerMuted: true });
    expect(named('gameMuted')).toEqual([
      ['gameMuted', false],
      ['gameMuted', true]
    ]);
  });

  it('goes home during a level with gameEnd("quit"), and ignores home and quit at the menu', async () => {
    const { callbacks, named, snapshot, start } = setup();
    callbacks.onGoToHome();
    callbacks.onQuitGame();
    expect(named('gameEnd')).toEqual([]);

    await start();
    callbacks.onGoToHome();
    await flush();
    expect(named('gameEnd').map((entry) => entry[1])).toEqual(['quit']);
    expect(snapshot().phase).toBe('menu');
  });

  it('starts a requested level if unlocked, otherwise the highest unlocked level', async () => {
    const unlocked = setup({ profile: { highestUnlockedLevel: 2 } });
    unlocked.callbacks.onGoToLevel(2);
    await flush();
    expect(unlocked.named('gameStart')).toEqual([['gameStart', 2]]);

    const locked = setup();
    locked.callbacks.onGoToLevel(3);
    await flush();
    expect(locked.named('gameStart')).toEqual([['gameStart', 1]]);
    expect(locked.snapshot().level).toBe(1);
  });

  it('restarts the current level, goes to the next level, and ends the level on game over', async () => {
    const { callbacks, controller, named, snapshot, start } = setup();
    await start();

    callbacks.onRestartGame();
    await flush();
    expect(named('gameEnd').map((entry) => entry[1])).toEqual(['quit']);
    expect(named('gameStart')).toEqual([
      ['gameStart', 1],
      ['gameStart', 1]
    ]);

    for (let fruit = 0; fruit < 5; fruit += 1) controller.tick();
    await flush();
    callbacks.onGoToNextLevel();
    await flush();
    expect(snapshot()).toMatchObject({ phase: 'playing', level: 2, score: 50 });

    callbacks.onGameOver();
    await flush();
    expect(named('gameEnd').map((entry) => entry[1])).toEqual(['quit', 'complete', 'fail']);
    expect(snapshot().phase).toBe('game-over');
  });
});
