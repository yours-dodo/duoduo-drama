import type { Clock } from '../auth/credential-store.js';

export interface FakeClock extends Clock {
  advance(milliseconds: number): void;
  set(value: number): void;
}

export function createFakeClock(initialNow = 0): FakeClock {
  let current = initialNow;
  return {
    now: () => current,
    advance: (milliseconds) => {
      if (!Number.isFinite(milliseconds) || milliseconds < 0)
        throw new TypeError('clock advance must be a non-negative number');
      current += milliseconds;
    },
    set: (value) => {
      if (!Number.isFinite(value)) throw new TypeError('clock must be finite');
      current = value;
    },
  };
}
