import type { Clock } from '../ports/Clock';

export const systemClock: Clock = { now: () => new Date() };
