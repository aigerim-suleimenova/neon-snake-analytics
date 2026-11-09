import { SCHEMA_VERSION, type AnalyticsEvent, type FailureReason, type RunEndedEvent } from '@neon-snake/contract';

/** Returns a number in [0, 1), like Math.random. */
export type Random = () => number;

/** Same rules as game/src/game/levels.ts and snakeGame.ts: fruit target, tick speed, 10 × level points per fruit. */
interface DemoLevel {
  level: number;
  target: number;
  tickMs: number;
  /** Chance that one attempt clears the level. */
  clearChance: number;
  failureReasons: FailureReason[];
}

const DEMO_LEVELS: DemoLevel[] = [
  { level: 1, target: 5, tickMs: 150, clearChance: 0.7, failureReasons: ['wall', 'wall', 'snake'] },
  { level: 2, target: 7, tickMs: 125, clearChance: 0.45, failureReasons: ['wall', 'snake', 'obstacle', 'obstacle'] },
  { level: 3, target: 9, tickMs: 105, clearChance: 0.3, failureReasons: ['wall', 'snake', 'obstacle', 'obstacle', 'obstacle'] }
];

const QUIT_CHANCE = 0.08;
/** Chance that the page is closed during a run, which leaves it unfinished. */
const CLOSE_CHANCE = 0.03;
/** Chance to try the same level again after a fail or quit. */
const RETRY_CHANCE = 0.75;
/** Ticks the snake needs on average to reach the next fruit. */
const TICKS_PER_FRUIT = 18;
/** Keeps run IDs two digits long. */
const MAX_RUNS_PER_SESSION = 30;

export interface DemoOptions {
  sessions: number;
  /** Time of the first session's first event. */
  start: Date;
  /** Starts every session ID; `demo` by default. Another prefix gives events that never collide with the demo's. */
  idPrefix?: string;
}

/** Mulberry32: a small seeded generator, so the same seed always gives the same demo data. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)];
const pad = (value: number, width: number) => String(value).padStart(width, '0');

/**
 * Plays `sessions` made-up page sessions the way the game would record them: every session starts on
 * level 1, clears levels or retries them, and ends on a give-up, a closed page or after the last level.
 * IDs are derived from positions, so posting the same data twice only produces duplicates.
 */
export function generateDemoEvents(random: Random, options: DemoOptions): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  let time = options.start.getTime();

  for (let s = 1; s <= options.sessions; s += 1) {
    const sessionId = `${options.idPrefix ?? 'demo'}-s${pad(s, 3)}`;
    let levelIndex = 0;
    let scoreAtLevelStart = 0;
    let runNumber = 0;

    while (levelIndex < DEMO_LEVELS.length && runNumber < MAX_RUNS_PER_SESSION) {
      const level = DEMO_LEVELS[levelIndex];
      runNumber += 1;
      const runId = `${sessionId}-r${pad(runNumber, 2)}`;
      const common = { schemaVersion: SCHEMA_VERSION, sessionId, runId, level: level.level } as const;
      events.push({ ...common, eventId: `${runId}-start`, type: 'run_started', occurredAt: new Date(time).toISOString() });

      if (random() < CLOSE_CHANCE) break;

      const roll = random();
      const outcome: RunEndedEvent['outcome'] =
        roll < level.clearChance ? 'complete' : roll < level.clearChance + QUIT_CHANCE ? 'quit' : 'fail';
      // Failing players reach the early fruit more often than the late ones.
      const fruit = outcome === 'complete' ? level.target : Math.floor(random() ** 1.5 * level.target);
      const levelScore = fruit * level.level * 10;
      const durationMs = Math.round((fruit + random()) * TICKS_PER_FRUIT * level.tickMs * (0.8 + random() * 0.6));
      time += durationMs;

      events.push({
        ...common,
        eventId: `${runId}-end`,
        type: 'run_ended',
        occurredAt: new Date(time).toISOString(),
        outcome,
        failureReason: outcome === 'fail' ? pick(random, level.failureReasons) : null,
        score: scoreAtLevelStart + levelScore,
        levelScore,
        progress: Math.round((fruit / level.target) * 100),
        durationMs
      });
      time += 2_000 + Math.round(random() * 4_000);

      if (outcome === 'complete') {
        scoreAtLevelStart += levelScore;
        levelIndex += 1;
      } else if (random() >= RETRY_CHANCE) {
        break;
      }
    }

    time += 10 * 60_000 + Math.round(random() * 50 * 60_000);
  }

  return events;
}
