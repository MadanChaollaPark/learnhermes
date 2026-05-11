import type { Clock } from "@runtime/types";

/**
 * Deterministic clock. Tests advance time explicitly via `advance(ms)`.
 *
 * Behavior:
 *  - now() returns the internal `t`.
 *  - schedule(at, cb) registers a callback to fire when t >= at,
 *    in insertion order at equal times.
 *  - advance(ms) bumps t and fires all due callbacks in time order,
 *    THEN drains microtasks before returning, so awaited continuations
 *    of fired callbacks run before the next assertion.
 *  - sleepUntil(at) returns a promise that resolves when t >= at.
 *
 * Anti-determinism in tests usually shows up as one of:
 *  - using setTimeout/setInterval directly (don't)
 *  - using Date.now() directly (don't — pass the clock around)
 *  - calling advance() in fractional ms with floating point math (don't)
 */

interface Scheduled {
  at: number;
  cb: () => void;
  cancelled: boolean;
  seq: number;
}

export class FakeClock implements Clock {
  private t: number;
  private q: Scheduled[] = [];
  private seq = 0;
  private sleepers: { at: number; resolve: () => void }[] = [];

  constructor(startAt = 0) {
    this.t = startAt;
  }

  now(): number {
    return this.t;
  }

  schedule(at: number, cb: () => void): { cancel: () => void } {
    const entry: Scheduled = { at, cb, cancelled: false, seq: this.seq++ };
    this.q.push(entry);
    this.q.sort((a, b) => a.at - b.at || a.seq - b.seq);
    return { cancel: () => { entry.cancelled = true; } };
  }

  sleepUntil(at: number): Promise<void> {
    if (this.t >= at) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.sleepers.push({ at, resolve });
    });
  }

  /** Advance by `ms` and fire every callback whose `at` falls into [old, new]. */
  async advance(ms: number): Promise<void> {
    if (ms < 0) throw new Error("FakeClock.advance: ms must be non-negative");
    const target = this.t + ms;
    while (true) {
      const next = this.q.find((e) => !e.cancelled && e.at <= target);
      const nextSleeper = [...this.sleepers].sort((a, b) => a.at - b.at).find((s) => s.at <= target);
      // Pick whichever fires first.
      const nextAt = Math.min(
        next ? next.at : Infinity,
        nextSleeper ? nextSleeper.at : Infinity,
      );
      if (!Number.isFinite(nextAt)) break;
      this.t = nextAt;
      if (next && next.at === nextAt) {
        this.q = this.q.filter((e) => e !== next);
        try { next.cb(); } catch { /* tests catch their own errors */ }
      } else if (nextSleeper && nextSleeper.at === nextAt) {
        this.sleepers = this.sleepers.filter((s) => s !== nextSleeper);
        nextSleeper.resolve();
      }
      await Promise.resolve();
      await Promise.resolve();
    }
    this.t = target;
  }

  /** Convenience: jump to an absolute time. */
  async advanceTo(t: number): Promise<void> {
    if (t < this.t) throw new Error("FakeClock.advanceTo: cannot go backwards");
    await this.advance(t - this.t);
  }

  /** For tests that need to know how many callbacks are still queued. */
  pending(): number {
    return this.q.filter((e) => !e.cancelled).length;
  }
}
