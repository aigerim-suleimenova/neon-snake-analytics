import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import type { ReceivedEvent, Run } from '../ports/EventStore';
import { generateDemoEvents, seededRandom } from '../seed/demoEvents';
import { endEvent, startEvent, validated } from '../test/events';
import { applyBatch, candidateSessionsOf, runIdsOf } from './eventBatch';
import { applyEvent } from './runRecord';
import { countRuns } from './statsCounts';

const receivedAt = new Date('2026-10-01T12:00:00.000Z');
const later = new Date('2026-10-01T12:00:05.000Z');
const received = (raw: unknown, at = receivedAt): ReceivedEvent => ({ event: validated(raw), receivedAt: at });
const none = new Map<string, Run>();

describe('applyBatch', () => {
  it('merges a start and its end into one changed run, with when each arrived', () => {
    const outcome = applyBatch([received(startEvent()), received(endEvent(), later)], none, new Set());

    expect(outcome.results).toEqual(['stored', 'stored']);
    expect([...outcome.changedRuns.keys()]).toEqual(['r1']);
    expect(outcome.changedRuns.get('r1')).toEqual({
      run: expect.objectContaining({ status: 'fail', startEventId: 'start-r1', endEventId: 'end-r1' }),
      receivedAt: { run_started: receivedAt, run_ended: later }
    });
  });

  it('counts the run once, as finished, and its new session once', () => {
    const outcome = applyBatch(
      [received(startEvent()), received(endEvent()), received(startEvent({ eventId: 'start-r2', runId: 'r2' }))],
      none,
      new Set()
    );

    expect(outcome.newSessions).toEqual(new Map([['s1', receivedAt]]));
    expect(outcome.countChange).toEqual({
      sessions: 1,
      levels: {
        1: {
          outcomes: { fail: 1, unfinished: 1 },
          durationTotalMs: 9000,
          failedByProgress: { '40-59': 1 },
          failedByReason: { wall: 1 }
        }
      }
    });
  });

  it('reports an event repeated in the batch as a duplicate', () => {
    const outcome = applyBatch([received(startEvent()), received(startEvent())], none, new Set());

    expect(outcome.results).toEqual(['stored', 'duplicate']);
  });

  it('reports a conflict with an event earlier in the batch, and keeps the earlier one', () => {
    const outcome = applyBatch([received(startEvent()), received(endEvent({ level: 2 }))], none, new Set());

    expect(outcome.results).toEqual(['stored', { conflict: 'level: run r1 is on level 1' }]);
    expect(outcome.changedRuns.get('r1')?.run.status).toBe('unfinished');
  });

  it('changes nothing for a batch of stored events', () => {
    const stored = new Map([['r1', applyEvent(undefined, validated(startEvent()))]]);

    const outcome = applyBatch([received(startEvent())], stored, new Set(['s1']));

    expect(outcome).toEqual({ results: ['duplicate'], changedRuns: new Map(), newSessions: new Map(), countChange: {} });
  });

  it('does not count a stored session again for its new run', () => {
    const outcome = applyBatch([received(startEvent({ eventId: 'start-r2', runId: 'r2' }))], none, new Set(['s1']));

    expect(outcome.newSessions.size).toBe(0);
    expect(outcome.countChange).not.toHaveProperty('sessions');
  });

  it('gives the same results, runs and counts as saving the events one at a time', async () => {
    const events = generateDemoEvents(seededRandom(7), { sessions: 30, start: new Date('2026-10-01T09:00:00.000Z') });
    // Resent events and conflicts mixed in, as a queue redelivers and a broken client sends.
    const conflicting = validated(endEvent({ eventId: 'conflict', runId: events[0].runId, sessionId: events[0].sessionId, level: 99 }));
    const mixed = [...events, ...events.slice(0, 20), conflicting].map((event) => ({ event, receivedAt }));
    const oneByOne = new InMemoryEventStore();
    const batched = new InMemoryEventStore();

    const expected = [];
    for (const { event } of mixed) expected.push(await oneByOne.saveEvent(event, receivedAt));
    const results = [];
    for (let start = 0; start < mixed.length; start += 37) results.push(...(await batched.saveEvents(mixed.slice(start, start + 37), 'p')));

    expect(expected).toContain('duplicate');
    expect(expected).toContainEqual({ conflict: 'level: run ' + events[0].runId + ' is on level ' + events[0].level });
    expect(results).toEqual(expected);
    expect(await batched.listRuns()).toEqual(await oneByOne.listRuns());
    expect(await batched.readStats()).toEqual(await oneByOne.readStats());
    expect(await batched.readStats()).toEqual(countRuns(await batched.listRuns()));
  });
});

describe('what a store must read for a batch', () => {
  it('reads each run once, and the sessions of runs not stored yet', () => {
    const events = [
      received(startEvent()),
      received(endEvent()),
      received(startEvent({ eventId: 'start-r2', runId: 'r2', sessionId: 's2' }))
    ];
    const stored = new Map([['r1', applyEvent(undefined, validated(startEvent()))]]);

    expect(runIdsOf(events)).toEqual(['r1', 'r2']);
    expect(candidateSessionsOf(events, stored)).toEqual(['s2']);
    expect(candidateSessionsOf(events, none)).toEqual(['s1', 's2']);
  });
});
