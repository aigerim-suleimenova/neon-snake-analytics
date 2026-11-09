import { describe, expect, it } from 'vitest';
import { MAX_FUTURE_SKEW_MS } from './events';
import { validateEvent } from './schemas';

const now = new Date('2026-10-01T12:00:00.000Z');

const started = {
  schemaVersion: 1,
  eventId: 'e1',
  type: 'run_started',
  sessionId: 's1',
  runId: 'r1',
  level: 1,
  occurredAt: '2026-10-01T11:59:00.000Z'
};

const ended = {
  ...started,
  eventId: 'e2',
  type: 'run_ended',
  outcome: 'fail',
  failureReason: 'obstacle',
  score: 20,
  levelScore: 20,
  progress: 29,
  durationMs: 4000
};

function errorsOf(input: unknown): string[] {
  const result = validateEvent(input, now);
  return result.ok ? [] : result.errors;
}

describe('validateEvent', () => {
  it('accepts a run_started event', () => {
    expect(validateEvent(started, now)).toEqual({ ok: true, event: started });
  });

  it('accepts a failed run_ended event', () => {
    expect(validateEvent(ended, now)).toEqual({ ok: true, event: ended });
  });

  it('accepts a complete and a quit run_ended event without a failure reason, stored as null', () => {
    const { failureReason: _, ...withoutReason } = ended;
    const complete = validateEvent({ ...withoutReason, outcome: 'complete', progress: 100 }, now);
    const quit = validateEvent({ ...ended, outcome: 'quit', failureReason: null }, now);

    expect(complete).toMatchObject({ ok: true, event: { outcome: 'complete', failureReason: null } });
    expect(quit).toMatchObject({ ok: true, event: { outcome: 'quit', failureReason: null } });
  });

  it('drops fields outside the contract', () => {
    const result = validateEvent({ ...started, playerName: 'Ada' }, now);

    expect(result).toEqual({ ok: true, event: started });
  });

  it('drops a null failure reason from run_started', () => {
    expect(validateEvent({ ...started, failureReason: null }, now)).toEqual({ ok: true, event: started });
  });

  it('rejects input that is not an object', () => {
    expect(errorsOf('hello')).toEqual(['event: must be an object']);
    expect(errorsOf(null)).toEqual(['event: must be an object']);
  });

  it('rejects an unsupported schema version', () => {
    expect(errorsOf({ ...started, schemaVersion: 2 })).toEqual(['schemaVersion: must be 1']);
  });

  it('rejects an unknown type', () => {
    expect(errorsOf({ ...started, type: 'level_up' })).toEqual([
      'type: must be one of run_started, run_ended'
    ]);
  });

  it.each([
    ['runs/r1', 'a slash'],
    ['', 'an empty ID'],
    ['r'.repeat(101), '101 characters'],
    ['run 1', 'a space']
  ])('rejects the run ID %j (%s)', (runId) => {
    expect(errorsOf({ ...started, runId })).toEqual(['runId: must be 1-100 letters, digits, "-" or "_"']);
  });

  it('accepts an ID of 100 letters, digits, "-" and "_"', () => {
    const eventId = `aZ09-_${'x'.repeat(94)}`;
    expect(validateEvent({ ...started, eventId }, now).ok).toBe(true);
  });

  it('rejects unsafe event and session IDs', () => {
    expect(errorsOf({ ...started, eventId: 'a.b', sessionId: 7 })).toEqual([
      'eventId: must be 1-100 letters, digits, "-" or "_"',
      'sessionId: must be a string'
    ]);
  });

  it.each([0, -1, 1.5, '1'])('rejects the level %j', (level) => {
    expect(errorsOf({ ...started, level })).toEqual(['level: must be a positive integer']);
  });

  it.each(['yesterday', '2026-10-01', '2026-10-01T12:00:00+02:00'])('rejects the time %j', (occurredAt) => {
    expect(errorsOf({ ...started, occurredAt })).toEqual(['occurredAt: must be an ISO 8601 UTC time']);
  });

  it('rejects a time one hour ahead of the server clock', () => {
    expect(errorsOf({ ...started, occurredAt: '2026-10-01T13:00:00.000Z' })).toEqual([
      'occurredAt: must not be more than 5 minutes in the future'
    ]);
  });

  it('accepts a time exactly MAX_FUTURE_SKEW_MS ahead and any past time', () => {
    const limit = new Date(now.getTime() + MAX_FUTURE_SKEW_MS).toISOString();

    expect(validateEvent({ ...started, occurredAt: limit }, now).ok).toBe(true);
    expect(validateEvent({ ...started, occurredAt: '2001-01-01T00:00:00Z' }, now).ok).toBe(true);
  });

  it('rejects an unknown outcome', () => {
    expect(errorsOf({ ...ended, outcome: 'won' })).toEqual(['outcome: must be one of complete, fail, quit']);
  });

  it('rejects a failed run without a failure reason', () => {
    expect(errorsOf({ ...ended, failureReason: undefined })).toEqual([
      'failureReason: is required when outcome is fail'
    ]);
    expect(errorsOf({ ...ended, failureReason: null })).toEqual([
      'failureReason: is required when outcome is fail'
    ]);
  });

  it('rejects an unknown failure reason', () => {
    expect(errorsOf({ ...ended, failureReason: 'lava' })).toEqual([
      'failureReason: must be one of wall, snake, obstacle, external or null'
    ]);
  });

  it('rejects a failure reason on a quit run and on run_started', () => {
    expect(errorsOf({ ...ended, outcome: 'quit' })).toEqual([
      'failureReason: must be absent or null unless outcome is fail'
    ]);
    expect(errorsOf({ ...started, failureReason: 'wall' })).toEqual([
      'failureReason: must be absent or null for run_started'
    ]);
  });

  it.each(['score', 'levelScore', 'durationMs'])('rejects a negative or fractional %s', (field) => {
    expect(errorsOf({ ...ended, [field]: -1 })).toEqual([`${field}: must be a non-negative integer`]);
    expect(errorsOf({ ...ended, [field]: 2.5 })).toEqual([`${field}: must be a non-negative integer`]);
  });

  it.each([-1, 101, 50.5])('rejects the progress %j', (progress) => {
    expect(errorsOf({ ...ended, progress })).toEqual(['progress: must be an integer from 0 to 100']);
  });

  it('rejects progress that does not match the outcome', () => {
    expect(errorsOf({ ...ended, outcome: 'complete', failureReason: null, progress: 80 })).toEqual([
      'progress: must be 100 when outcome is complete'
    ]);
    expect(errorsOf({ ...ended, progress: 100 })).toEqual(['progress: must be below 100 when outcome is fail']);
    expect(errorsOf({ ...ended, outcome: 'quit', failureReason: null, progress: 100 })).toEqual([
      'progress: must be below 100 when outcome is quit'
    ]);
  });

  it('rejects a run_ended without its outcome fields', () => {
    expect(errorsOf({ ...started, type: 'run_ended' })).toEqual([
      'outcome: must be one of complete, fail, quit',
      'score: must be a non-negative integer',
      'levelScore: must be a non-negative integer',
      'progress: must be an integer from 0 to 100',
      'durationMs: must be a non-negative integer'
    ]);
  });
});
