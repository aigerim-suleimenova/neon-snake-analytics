import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import { generateDemoEvents, seededRandom } from '../seed/demoEvents';
import { endEvent, startEvent, validated } from '../test/events';
import { applyEvent } from './runRecord';
import { countChange, countRuns } from './statsCounts';

const receivedAt = new Date('2026-10-01T12:00:00.000Z');

describe('countChange', () => {
  it('counts a started run as unfinished and its session as new', () => {
    const started = applyEvent(undefined, validated(startEvent()));

    expect(countChange(undefined, started, true)).toEqual({ sessions: 1, levels: { 1: { outcomes: { unfinished: 1 } } } });
  });

  it('moves a run from unfinished to its outcome when it ends', () => {
    const started = applyEvent(undefined, validated(startEvent()));
    const ended = applyEvent(started, validated(endEvent()));

    expect(countChange(started, ended, false)).toEqual({
      levels: {
        1: {
          outcomes: { unfinished: -1, fail: 1 },
          durationTotalMs: 9000,
          failedByProgress: { '40-59': 1 },
          failedByReason: { wall: 1 }
        }
      }
    });
  });

  it('changes nothing when a late start event joins an ended run', () => {
    const ended = applyEvent(undefined, validated(endEvent()));
    const joined = applyEvent(ended, validated(startEvent()));

    expect(countChange(ended, joined, false)).toEqual({});
  });
});

describe('running counts', () => {
  it('match a recount of every run, whatever order the events arrive in', async () => {
    const events = generateDemoEvents(seededRandom(7), { sessions: 25, start: new Date('2026-10-01T09:00:00.000Z') });
    const shuffle = seededRandom(11);
    const shuffled = events
      .map((event) => ({ event, key: shuffle() }))
      .sort((a, b) => a.key - b.key)
      .map(({ event }) => event);
    const store = new InMemoryEventStore();

    for (const event of shuffled) await store.saveEvent(event, receivedAt);

    const counts = await store.readStats();
    expect(counts.sessions).toBe(25);
    expect(counts).toEqual(countRuns(await store.listRuns()));
  });

  it('are unchanged by duplicates and conflicts', async () => {
    const store = new InMemoryEventStore();
    await store.saveEvent(validated(startEvent()), receivedAt);
    const before = await store.readStats();

    await store.saveEvent(validated(startEvent()), receivedAt);
    await store.saveEvent(validated(endEvent({ level: 2 })), receivedAt);

    expect(await store.readStats()).toEqual(before);
  });
});
