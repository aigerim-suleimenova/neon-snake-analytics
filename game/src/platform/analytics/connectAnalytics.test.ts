import { describe, expect, it } from 'vitest';

import type { GameEventMap } from '../../application/gameEvents';
import { EventBus } from '../../core/events/EventBus';
import type { AnalyticsEvent } from './AnalyticsEvent';
import { connectAnalytics } from './connectAnalytics';
import { randomId } from './randomId';

const START = Date.parse('2026-10-01T12:00:00.000Z');

const setup = () => {
  const events = new EventBus<GameEventMap>();
  const sent: AnalyticsEvent[] = [];
  let counter = 0;
  const newId = () => `id${(counter += 1)}`;
  const disconnect = connectAnalytics(events, { send: (event) => sent.push(event) }, newId);

  const start = (level = 1, occurredAt = START) => events.emit('runStarted', { level, runNumber: 1, occurredAt });
  const end = (payload: Partial<GameEventMap['runEnded']> = {}) =>
    events.emit('runEnded', {
      level: 1,
      score: 50,
      levelScore: 50,
      progress: 1,
      reason: 'complete',
      failureReason: null,
      durationMs: 9000,
      occurredAt: START + 9000,
      ...payload
    });
  return { sent, start, end, disconnect };
};

describe('connectAnalytics', () => {
  it('records a cleared level as run_started and a complete run_ended for the same run', () => {
    const { sent, start, end } = setup();

    start();
    end();

    expect(sent).toEqual([
      {
        schemaVersion: 1,
        eventId: 'id3',
        type: 'run_started',
        sessionId: 'id1',
        runId: 'id2',
        level: 1,
        occurredAt: '2026-10-01T12:00:00.000Z'
      },
      {
        schemaVersion: 1,
        eventId: 'id4',
        type: 'run_ended',
        sessionId: 'id1',
        runId: 'id2',
        level: 1,
        occurredAt: '2026-10-01T12:00:09.000Z',
        outcome: 'complete',
        failureReason: null,
        score: 50,
        levelScore: 50,
        progress: 100,
        durationMs: 9000
      }
    ]);
  });

  it('records a failed level with its failure reason and progress as a percentage', () => {
    const { sent, start, end } = setup();

    start(2);
    end({ level: 2, reason: 'fail', failureReason: 'obstacle', progress: 2 / 7, score: 90, levelScore: 40 });

    expect(sent[1]).toMatchObject({ type: 'run_ended', level: 2, outcome: 'fail', failureReason: 'obstacle', progress: 29 });
  });

  it('records a platform game over as a fail with the reason external', () => {
    const { sent, start, end } = setup();

    start();
    end({ reason: 'fail', failureReason: 'external', progress: 0.4 });

    expect(sent[1]).toMatchObject({ outcome: 'fail', failureReason: 'external', progress: 40 });
  });

  it('records a quit without a failure reason', () => {
    const { sent, start, end } = setup();

    start();
    end({ reason: 'quit', failureReason: 'wall', progress: 0.2 });

    expect(sent[1]).toMatchObject({ outcome: 'quit', failureReason: null, progress: 20 });
  });

  it('keeps a failed or left run below 100 % when rounding would reach it', () => {
    const { sent, start, end } = setup();

    start();
    end({ reason: 'fail', failureReason: 'wall', progress: 0.996 });

    expect(sent[1]).toMatchObject({ progress: 99 });
  });

  it('records a restart as a quit followed by a new run in the same session', () => {
    const { sent, start, end } = setup();

    start();
    end({ reason: 'quit', progress: 0.4 });
    start(1, START + 20_000);

    expect(sent.map((event) => event.type)).toEqual(['run_started', 'run_ended', 'run_started']);
    expect(sent[1].runId).toBe(sent[0].runId);
    expect(sent[2].runId).not.toBe(sent[0].runId);
    expect(new Set(sent.map((event) => event.sessionId)).size).toBe(1);
  });

  it('keeps the start level for the end and ignores an end without a start', () => {
    const { sent, start, end } = setup();

    end();
    start(3);
    end({ level: 4 });

    expect(sent.map((event) => [event.type, event.level])).toEqual([
      ['run_started', 3],
      ['run_ended', 3]
    ]);
  });

  it('gives each event its own ID', () => {
    const { sent, start, end } = setup();

    start();
    end({ reason: 'fail', failureReason: 'snake', progress: 0.1 });
    start();
    end();

    expect(new Set(sent.map((event) => event.eventId)).size).toBe(4);
  });

  it('stops recording after disconnecting', () => {
    const { sent, start, disconnect } = setup();

    disconnect();
    start();

    expect(sent).toEqual([]);
  });
});

describe('randomId', () => {
  it('creates distinct IDs that match the backend ID pattern', () => {
    const ids = Array.from({ length: 200 }, randomId);

    ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
