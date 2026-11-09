import { describe, expect, it } from 'vitest';
import { endEvent, startEvent, validated } from '../test/events';
import { applyEvent, findConflict, isDuplicate } from './runRecord';

const start = validated(startEvent());
const end = validated(endEvent());

describe('isDuplicate', () => {
  it('is false for an event of a new run', () => {
    expect(isDuplicate(undefined, start)).toBe(false);
  });

  it('is true for an event the run already holds, whichever arrived first', () => {
    const started = applyEvent(undefined, start);
    const finished = applyEvent(started, end);

    expect(isDuplicate(started, start)).toBe(true);
    expect(isDuplicate(started, end)).toBe(false);
    expect(isDuplicate(finished, start)).toBe(true);
    expect(isDuplicate(finished, end)).toBe(true);
    expect(isDuplicate(applyEvent(undefined, end), end)).toBe(true);
  });

  it('is true for an ID the run holds under the other event type, so it is never stored twice', () => {
    const started = applyEvent(undefined, start);

    expect(isDuplicate(started, validated(endEvent({ eventId: 'start-r1' })))).toBe(true);
  });

  it('is false for a second start with a new ID, which is a conflict instead', () => {
    const started = applyEvent(undefined, start);
    const second = validated(startEvent({ eventId: 'start-again' }));

    expect(isDuplicate(started, second)).toBe(false);
    expect(findConflict(started, second)).toBe('type: run r1 already has a run_started event');
  });
});
