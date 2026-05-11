import type { Clock } from "../types";

/**
 * Real clock — uses Date.now() and setTimeout.
 *
 * Tests MUST NOT use this. The FakeClock in tests/mocks/clock.ts is
 * the only clock allowed in the test suite.
 */
export function realClock(): Clock {
  return {
    now: () => Date.now(),
    schedule(at, cb) {
      const delay = Math.max(0, at - Date.now());
      const t = setTimeout(cb, delay);
      return { cancel: () => clearTimeout(t) };
    },
    sleepUntil(at) {
      const delay = Math.max(0, at - Date.now());
      return new Promise((resolve) => setTimeout(resolve, delay));
    },
  };
}
