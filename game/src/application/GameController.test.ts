import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameStorage, PlayerProfile } from '../core/storage/GameStorage';
import { SnakeGame } from '../game/snakeGame';
import type { GamePhase } from '../game/types';
import { spawnFoodAhead } from '../test/spawnFoodAhead';
import { GameController } from './GameController';
import type { GameEventMap } from './gameEvents';
import type { GamePlatform, RunSummary } from './GamePlatform';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A platform whose promises stay pending until the test resolves them. */
const manualPlatform = () => {
  const calls: { name: string; args: unknown[] }[] = [];
  const pending: (() => void)[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      new Promise<void>((resolve) => {
        calls.push({ name, args });
        pending.push(resolve);
      });
  const platform: GamePlatform = {
    startRun: record('startRun'),
    endRun: record('endRun'),
    finishGame: record('finishGame'),
    pauseRun: record('pauseRun'),
    resumeRun: record('resumeRun')
  };
  const names = () =>
    calls.map(({ name, args }) => (name === 'startRun' || name === 'endRun' ? `${name}:${String(args[0])}` : name));
  const resolveNext = async () => {
    pending.shift()?.();
    await flush();
  };
  const resolveAll = async () => {
    while (pending.length > 0) await resolveNext();
  };
  return { platform, calls, names, resolveNext, resolveAll };
};

const setup = (profile: Partial<PlayerProfile> = {}) => {
  const simulation = new SnakeGame();
  spawnFoodAhead(simulation);
  const saved: PlayerProfile[] = [];
  const storage: GameStorage = {
    loadProfile: () => ({ bestScore: 0, highestUnlockedLevel: 1, totalRuns: 0, playerMuted: false, ...profile }),
    saveProfile: (value) => saved.push(value)
  };
  const fake = manualPlatform();
  const controller = new GameController(simulation, storage, fake.platform);
  const phases: GamePhase[] = [];
  controller.subscribe((snapshot) => phases.push(snapshot.phase));
  const record = <Name extends keyof GameEventMap>(name: Name) => {
    const payloads: GameEventMap[Name][] = [];
    controller.events.on(name, (payload) => payloads.push(payload));
    return payloads;
  };
  const snapshot = () => controller.getSnapshot();
  const ticks = (count: number) => {
    for (let tick = 0; tick < count; tick += 1) controller.tick();
  };
  const startLevel = async (start: () => Promise<void> = () => controller.startNewGame()) => {
    void start();
    await fake.resolveAll();
  };
  return { controller, fake, saved, phases, record, snapshot, ticks, startLevel };
};

beforeEach(() => vi.stubGlobal('window', {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GameController command queue', () => {
  it('ignores a second command while one is pending', async () => {
    const { controller, fake, snapshot } = setup();

    void controller.startNewGame();
    void controller.startNewGame();

    expect(fake.names()).toEqual(['startRun:1']);
    expect(controller.isBusy()).toBe(true);
    expect(snapshot().phase).toBe('menu');

    await fake.resolveAll();
    expect(controller.isBusy()).toBe(false);
    expect(snapshot().phase).toBe('playing');
  });

  it('freezes the snake while busy and replays the skipped tick afterwards', async () => {
    const { controller, fake, snapshot, record, startLevel } = setup();
    await startLevel();
    const busy = record('busyChanged');
    const head = snapshot().snake[0];

    void controller.restartLevel();
    controller.tick();
    expect(snapshot().snake[0]).toEqual(head);

    await fake.resolveAll();
    expect(busy.map((event) => event.busy)).toEqual([true, false]);
    expect(snapshot().snake[0].x).toBe(head.x + 1);
  });
});

describe('GameController level start', () => {
  it('restarts during play with gameEnd("quit") then gameStart, without passing through the menu', async () => {
    const { controller, fake, phases, record, saved, snapshot, ticks, startLevel } = setup();
    await startLevel();
    ticks(2);
    phases.length = 0;
    const ended = record('runEnded');
    const started = record('runStarted');

    void controller.restartLevel();
    expect(fake.names()).toEqual(['startRun:1', 'endRun:quit']);

    await fake.resolveNext();
    expect(fake.names()).toEqual(['startRun:1', 'endRun:quit', 'startRun:1']);
    expect(snapshot()).toMatchObject({ phase: 'playing', score: 20 });

    await fake.resolveAll();
    expect(snapshot()).toMatchObject({ phase: 'playing', score: 0 });
    expect(phases).not.toContain('menu');
    expect(ended).toMatchObject([{ reason: 'quit', level: 1, score: 20 }]);
    expect(started).toMatchObject([{ level: 1, runNumber: 2 }]);
    expect(saved.at(-1)?.totalRuns).toBe(2);
  });

  it('reports the next level number before it begins', async () => {
    const { controller, fake, snapshot, ticks, startLevel } = setup();
    await startLevel();
    ticks(5);
    await fake.resolveAll();

    void controller.goToNextLevel();
    expect(fake.names().at(-1)).toBe('startRun:2');
    expect(snapshot().phase).toBe('level-complete');

    await fake.resolveAll();
    expect(snapshot()).toMatchObject({ phase: 'playing', level: 2, score: 50 });
  });
});

describe('GameController level end', () => {
  it('waits for gameEnd("complete") when a level is cleared', async () => {
    const { controller, fake, snapshot, ticks, startLevel } = setup();
    await startLevel();

    ticks(5);
    expect(snapshot().phase).toBe('level-complete');
    expect(fake.names().at(-1)).toBe('endRun:complete');
    expect(controller.isBusy()).toBe(true);

    await fake.resolveAll();
    expect(controller.isBusy()).toBe(false);
  });

  it('waits for gameEnd("fail") when the player loses', async () => {
    const { controller, fake, startLevel } = setup();
    await startLevel();

    controller.forceGameOver();
    expect(fake.names().at(-1)).toBe('endRun:fail');
    expect(controller.isBusy()).toBe(true);
  });

  it('sends gameFinished after the last level, also when it was chosen from the level select', async () => {
    const { controller, fake, snapshot, ticks, startLevel } = setup({ highestUnlockedLevel: 3 });
    await startLevel(() => controller.startAtLevel(3));

    ticks(9);
    expect(snapshot().phase).toBe('finished');
    expect(fake.names().slice(-1)).toEqual(['endRun:complete']);

    await fake.resolveNext();
    expect(fake.names().slice(-2)).toEqual(['endRun:complete', 'finishGame']);
  });

  it('keeps the level on screen until gameEnd("quit") resolves when the player exits', async () => {
    const { controller, fake, snapshot, startLevel } = setup();
    await startLevel();

    void controller.quitToMenu();
    expect(fake.names().at(-1)).toBe('endRun:quit');
    expect(snapshot().phase).toBe('playing');

    await fake.resolveAll();
    expect(snapshot().phase).toBe('menu');
  });

  it('sends nothing when leaving a result screen', async () => {
    const { controller, fake, snapshot, startLevel } = setup();
    await startLevel();
    controller.forceGameOver();
    await fake.resolveAll();
    const callCount = fake.calls.length;

    await controller.quitToMenu();
    expect(fake.calls.length).toBe(callCount);
    expect(snapshot().phase).toBe('menu');
  });
});

describe('GameController run summary', () => {
  it('reports the level score and the run score when a level ends', async () => {
    const { controller, fake, saved, ticks, startLevel } = setup();
    await startLevel();
    ticks(5);
    await fake.resolveAll();
    await startLevel(() => controller.goToNextLevel());

    // Level 2 starts with 50 points; two fruit add 40 before the snake hits the barrier at x = 13.
    ticks(3);
    const endRun = fake.calls.at(-1);
    expect(endRun?.args[0]).toBe('fail');
    expect(endRun?.args[1]).toMatchObject<Partial<RunSummary>>({ level: 2, score: 90, levelScore: 40, progress: 2 / 7 });
    expect(saved.some((profile) => profile.bestScore === 70)).toBe(true);
  });
});

describe('GameController runEnded event', () => {
  it('reports the level score and no failure reason for a cleared level', async () => {
    const { record, ticks, startLevel } = setup();
    const ended = record('runEnded');
    await startLevel();

    ticks(5);
    expect(ended).toMatchObject([{ reason: 'complete', level: 1, score: 50, levelScore: 50, progress: 1, failureReason: null }]);
  });

  it('reports the failure reason and level score for a failed level', async () => {
    const { controller, fake, record, ticks, startLevel } = setup();
    await startLevel();
    ticks(5);
    await fake.resolveAll();
    await startLevel(() => controller.goToNextLevel());
    const ended = record('runEnded');

    ticks(3);
    expect(ended).toMatchObject([{ reason: 'fail', level: 2, score: 90, levelScore: 40, failureReason: 'obstacle' }]);
  });

  it('reports the failure reason external when the platform ends the level', async () => {
    const { controller, record, ticks, startLevel } = setup();
    const ended = record('runEnded');
    await startLevel();
    ticks(2);

    controller.forceGameOver();
    expect(ended).toMatchObject([{ reason: 'fail', levelScore: 20, failureReason: 'external' }]);
  });

  it('reports no failure reason when the player quits', async () => {
    const { controller, fake, record, ticks, startLevel } = setup();
    const ended = record('runEnded');
    await startLevel();
    ticks(2);

    void controller.quitToMenu();
    await fake.resolveAll();
    expect(ended).toMatchObject([{ reason: 'quit', score: 20, levelScore: 20, failureReason: null }]);
  });
});

describe('GameController pause', () => {
  it('pauses and resumes only after the platform resolves', async () => {
    const { controller, fake, snapshot, startLevel } = setup();
    await startLevel();

    void controller.togglePlayerPause();
    expect(fake.names().at(-1)).toBe('pauseRun');
    expect(snapshot().phase).toBe('playing');
    await fake.resolveAll();
    expect(snapshot()).toMatchObject({ phase: 'paused', pauseSource: 'player' });

    void controller.togglePlayerPause();
    expect(fake.names().at(-1)).toBe('resumeRun');
    await fake.resolveAll();
    expect(snapshot().phase).toBe('playing');
  });

  it('ignores the player pause during a platform pause', async () => {
    const { controller, fake, snapshot, startLevel } = setup();
    await startLevel();
    const callCount = fake.calls.length;

    controller.setSystemPaused(true);
    await controller.togglePlayerPause();

    expect(fake.calls.length).toBe(callCount);
    expect(snapshot()).toMatchObject({ phase: 'paused', pauseSource: 'system' });
  });

  it('restores the player pause after a platform pause', async () => {
    const { controller, fake, snapshot, startLevel } = setup();
    await startLevel();
    void controller.togglePlayerPause();
    await fake.resolveAll();

    controller.setSystemPaused(true);
    expect(snapshot().pauseSource).toBe('system');
    controller.setSystemPaused(false);
    expect(snapshot()).toMatchObject({ phase: 'paused', pauseSource: 'player' });
  });

  it('starts a level frozen when the platform pauses while gameStart is pending', async () => {
    const { controller, fake, snapshot } = setup();

    void controller.startNewGame();
    controller.setSystemPaused(true);
    await fake.resolveAll();

    expect(snapshot()).toMatchObject({ phase: 'paused', pauseSource: 'system' });
  });

  it('blocks Start and the level select at the menu during a platform pause', async () => {
    const { controller, fake, record, snapshot } = setup();
    const systemPause = record('systemPauseChanged');

    controller.setSystemPaused(true);
    await controller.startNewGame();
    await controller.startAtLevel(1);

    expect(systemPause).toEqual([{ paused: true }]);
    expect(controller.isSystemPaused()).toBe(true);
    expect(fake.calls).toEqual([]);
    expect(snapshot().phase).toBe('menu');
  });
});
