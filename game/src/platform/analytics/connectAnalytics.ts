import type { GameEventMap, RunEndReason } from '../../application/gameEvents';
import type { EventBus } from '../../core/events/EventBus';
import { SCHEMA_VERSION, type EventSender } from './AnalyticsEvent';

type RunEvents = Pick<EventBus<GameEventMap>, 'on'>;

/** Progress 0-1 as an integer percentage; a failed or left run stays below 100 even when rounding would reach it. */
const toPercent = (progress: number, outcome: RunEndReason): number =>
  outcome === 'complete' ? 100 : Math.min(99, Math.round(progress * 100));

/**
 * Turns the controller's run events into analytics events: one session per call (page load),
 * one run per level attempt. Each event gets its ID here, once, so every resend keeps it.
 * Returns a function that stops listening.
 */
export const connectAnalytics = (events: RunEvents, sender: EventSender, newId: () => string): (() => void) => {
  const sessionId = newId();
  let activeRun: { runId: string; level: number } | null = null;

  const stopStarted = events.on('runStarted', ({ level, occurredAt }) => {
    activeRun = { runId: newId(), level };
    sender.send({
      schemaVersion: SCHEMA_VERSION,
      eventId: newId(),
      type: 'run_started',
      sessionId,
      runId: activeRun.runId,
      level,
      occurredAt: new Date(occurredAt).toISOString()
    });
  });

  const stopEnded = events.on('runEnded', (run) => {
    if (!activeRun) return;
    const { runId, level } = activeRun;
    activeRun = null;
    sender.send({
      schemaVersion: SCHEMA_VERSION,
      eventId: newId(),
      type: 'run_ended',
      sessionId,
      runId,
      level,
      occurredAt: new Date(run.occurredAt).toISOString(),
      outcome: run.reason,
      failureReason: run.reason === 'fail' ? run.failureReason : null,
      score: run.score,
      levelScore: run.levelScore,
      progress: toPercent(run.progress, run.reason),
      durationMs: Math.round(run.durationMs)
    });
  });

  return () => {
    stopStarted();
    stopEnded();
  };
};
