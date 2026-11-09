/** Current time, injected so time-based rules are testable. */
export interface Clock {
  now(): Date;
}
