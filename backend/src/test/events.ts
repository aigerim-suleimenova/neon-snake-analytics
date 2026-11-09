import type { AnalyticsEvent } from '@neon-snake/contract';
import { validateEvent } from '@neon-snake/contract/schemas';

/** Raw events as the game posts them, for tests. */
export function startEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: 'start-r1',
    type: 'run_started',
    sessionId: 's1',
    runId: 'r1',
    level: 1,
    occurredAt: '2026-10-01T11:59:00.000Z',
    ...overrides
  };
}

export function endEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: 'end-r1',
    type: 'run_ended',
    sessionId: 's1',
    runId: 'r1',
    level: 1,
    occurredAt: '2026-10-01T11:59:09.000Z',
    outcome: 'fail',
    failureReason: 'wall',
    score: 30,
    levelScore: 30,
    progress: 43,
    durationMs: 9000,
    ...overrides
  };
}

/** A raw fixture run through the contract, as the store receives it. */
export function validated(raw: unknown): AnalyticsEvent {
  const result = validateEvent(raw, new Date('2026-10-01T12:00:00.000Z'));
  if (!result.ok) throw new Error(`Invalid fixture: ${result.errors.join('; ')}`);
  return result.event;
}
