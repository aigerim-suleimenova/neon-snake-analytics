/** Source of the current time, injected so tests can fix it. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
