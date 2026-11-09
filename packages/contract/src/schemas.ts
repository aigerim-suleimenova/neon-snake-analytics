import { z } from 'zod';
import {
  FAILURE_REASONS,
  ID_PATTERN,
  MAX_FUTURE_SKEW_MS,
  OUTCOMES,
  SCHEMA_VERSION,
  type AnalyticsEvent
} from './events';
import { PROGRESS_RANGES, type LevelsResponse, type LevelStats, type LiveStats, type Overview } from './stats';

// The runtime checks of the contract: the backend checks incoming events with them, the dashboard the
// statistics it reads. `satisfies` keeps each schema in step with the type it checks.

export type ValidationResult = { ok: true; event: AnalyticsEvent } | { ok: false; errors: string[] };

const id = z.string({ error: 'must be a string' }).regex(ID_PATTERN, {
  error: 'must be 1-100 letters, digits, "-" or "_"'
});
const nonNegativeInt = z.int({ error: 'must be a non-negative integer' }).min(0, {
  error: 'must be a non-negative integer'
});

const base = {
  schemaVersion: z.literal(SCHEMA_VERSION, { error: `must be ${SCHEMA_VERSION}` }),
  eventId: id,
  sessionId: id,
  runId: id,
  level: z.int({ error: 'must be a positive integer' }).min(1, { error: 'must be a positive integer' }),
  occurredAt: z.iso.datetime({ error: 'must be an ISO 8601 UTC time' })
};

const runStarted = z.object({
  ...base,
  type: z.literal('run_started'),
  failureReason: z.null({ error: 'must be absent or null for run_started' }).optional()
});

const runEnded = z
  .object({
    ...base,
    type: z.literal('run_ended'),
    outcome: z.enum(OUTCOMES, { error: `must be one of ${OUTCOMES.join(', ')}` }),
    failureReason: z
      .enum(FAILURE_REASONS, { error: `must be one of ${FAILURE_REASONS.join(', ')} or null` })
      .nullable()
      .optional(),
    score: nonNegativeInt,
    levelScore: nonNegativeInt,
    progress: z.int({ error: 'must be an integer from 0 to 100' }).min(0, {
      error: 'must be an integer from 0 to 100'
    }).max(100, { error: 'must be an integer from 0 to 100' }),
    durationMs: nonNegativeInt
  })
  .superRefine((event, ctx) => {
    if (event.outcome === 'fail' && event.failureReason == null) {
      ctx.addIssue({ code: 'custom', path: ['failureReason'], message: 'is required when outcome is fail' });
    }
    if (event.outcome !== 'fail' && event.failureReason != null) {
      ctx.addIssue({ code: 'custom', path: ['failureReason'], message: 'must be absent or null unless outcome is fail' });
    }
    if (event.outcome === 'complete' && event.progress !== 100) {
      ctx.addIssue({ code: 'custom', path: ['progress'], message: 'must be 100 when outcome is complete' });
    }
    if (event.outcome !== 'complete' && event.progress === 100) {
      ctx.addIssue({ code: 'custom', path: ['progress'], message: `must be below 100 when outcome is ${event.outcome}` });
    }
  });

const eventSchema = z.discriminatedUnion('type', [runStarted, runEnded], {
  error: (issue) =>
    typeof issue.input === 'object' && issue.input !== null
      ? 'must be one of run_started, run_ended'
      : 'must be an object'
});

function toEvent(parsed: z.infer<typeof eventSchema>): AnalyticsEvent {
  const { schemaVersion, eventId, sessionId, runId, level, occurredAt } = parsed;
  const common = { schemaVersion, eventId, sessionId, runId, level, occurredAt };
  if (parsed.type === 'run_started') return { ...common, type: 'run_started' };
  const { outcome, failureReason, score, levelScore, progress, durationMs } = parsed;
  return {
    ...common,
    type: 'run_ended',
    outcome,
    failureReason: failureReason ?? null,
    score,
    levelScore,
    progress,
    durationMs
  };
}

/**
 * Checks one incoming event against the contract. Unknown fields are dropped; each error
 * names the field it is about, e.g. `level: must be a positive integer`.
 */
export function validateEvent(input: unknown, now: Date): ValidationResult {
  const result = eventSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'event'}: ${issue.message}`)
    };
  }
  if (Date.parse(result.data.occurredAt) - now.getTime() > MAX_FUTURE_SKEW_MS) {
    return { ok: false, errors: ['occurredAt: must not be more than 5 minutes in the future'] };
  }
  return { ok: true, event: toEvent(result.data) };
}

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();
const countsOf = <const Keys extends readonly [string, ...string[]]>(keys: Keys) =>
  z.object(Object.fromEntries(keys.map((key) => [key, count])) as { [Key in Keys[number]]: typeof count });

export const OverviewSchema = z.object({
  sessions: count,
  runs: count,
  finished: count,
  unfinished: count,
  completionRate: rate,
  runsPerSession: z.number().nonnegative().nullable()
}) satisfies z.ZodType<Overview>;

export const LevelStatsSchema = z.object({
  level: z.number().int().positive(),
  outcomes: countsOf(['complete', 'fail', 'quit', 'unfinished']),
  completionRate: rate,
  averageDurationMs: count.nullable(),
  failedByProgress: countsOf(PROGRESS_RANGES),
  failedByReason: countsOf(FAILURE_REASONS)
}) satisfies z.ZodType<LevelStats>;

export const LevelsResponseSchema = z.object({ levels: z.array(LevelStatsSchema) }) satisfies z.ZodType<LevelsResponse>;

export const LiveStatsSchema = z.object({ overview: OverviewSchema, levels: z.array(LevelStatsSchema) }) satisfies z.ZodType<LiveStats>;
