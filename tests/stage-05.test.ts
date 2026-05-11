import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Scheduler, nextFireAt } from "@runtime/scheduler/scheduler";
import { JobQueue } from "@runtime/queue/queue";
import { Store } from "@runtime/store/store";
import { FakeClock, makeWorkspace, type Workspace } from "@tests/mocks";

describe("Stage 5 — Scheduler", () => {
  let ws: Workspace;
  let clock: FakeClock;
  let store: Store;
  let queue: JobQueue;
  let sched: Scheduler;

  beforeEach(async () => {
    ws = makeWorkspace("sched");
    clock = new FakeClock(0);
    store = new Store({ workspace: ws.path });
    await store.open();
    queue = new JobQueue({
      store, clock,
      backoff: { baseMs: 100, factor: 2, maxMs: 10_000 },
      defaultMaxAttempts: 3,
    });
    queue.register("noop", async () => {});
    sched = new Scheduler({ store, queue, clock });
  });
  afterEach(async () => { await store.close(); ws.cleanup(); });

  describe("nextFireAt", () => {
    it("once: null lastFire → at", () => {
      expect(nextFireAt({ type: "once", at: 500 }, null, 100)).toBe(500);
    });
    it("once: after fire → null", () => {
      expect(nextFireAt({ type: "once", at: 500 }, 500, 600)).toBeNull();
    });
    it("interval: null lastFire → startAt ?? now", () => {
      expect(nextFireAt({ type: "interval", everyMs: 300 }, null, 100)).toBe(100);
      expect(nextFireAt({ type: "interval", everyMs: 300, startAt: 500 }, null, 100)).toBe(500);
    });
    it("interval: after fire → lastFire + everyMs", () => {
      expect(nextFireAt({ type: "interval", everyMs: 300 }, 700, 800)).toBe(1000);
    });
    it("cron */5 * * * *: smallest minute-aligned T >= now", () => {
      // now=0: 0 matches (minute=0).
      expect(nextFireAt({ type: "cron", expr: "*/5 * * * *" }, null, 0)).toBe(0);
      // now=120_000 (minute=2): next match is minute=5.
      expect(nextFireAt({ type: "cron", expr: "*/5 * * * *" }, null, 120_000))
        .toBe(5 * 60_000);
      // After fire at 0: smallest T > 0 minute-aligned matching = 5 min.
      expect(nextFireAt({ type: "cron", expr: "*/5 * * * *" }, 0, 0))
        .toBe(5 * 60_000);
    });
    it("cron: explicit minute", () => {
      // every hour at minute 30
      expect(nextFireAt({ type: "cron", expr: "30 * * * *" }, null, 0))
        .toBe(30 * 60_000);
    });
  });

  describe("schedule + tick", () => {
    it("fires a once schedule exactly when clock crosses at", async () => {
      const s = await sched.schedule({
        schedule: { type: "once", at: 1000 },
        jobKind: "noop", jobPayload: {},
      });
      expect(s.nextFireAt).toBe(1000);

      // Tick at now=0: not due.
      expect((await sched.tick()).fired).toBe(0);
      await clock.advanceTo(999);
      expect((await sched.tick()).fired).toBe(0);
      await clock.advanceTo(1000);
      expect((await sched.tick()).fired).toBe(1);

      // Once fires once.
      await clock.advanceTo(2000);
      expect((await sched.tick()).fired).toBe(0);

      // The job got enqueued.
      const jobs = await queue.listByStatus("pending");
      expect(jobs.length + (await queue.listByStatus("succeeded")).length).toBeGreaterThanOrEqual(1);
    });

    it("fires an interval schedule repeatedly", async () => {
      await sched.schedule({
        schedule: { type: "interval", everyMs: 300, startAt: 100 },
        jobKind: "noop", jobPayload: {},
      });

      const fireCounts: number[] = [];
      for (let t = 0; t <= 1000; t += 100) {
        await clock.advanceTo(t);
        fireCounts.push((await sched.tick()).fired);
      }
      // Fires at: 100, 400, 700, 1000.
      const total = fireCounts.reduce((a, b) => a + b, 0);
      expect(total).toBe(4);
    });

    it("respects maxFires", async () => {
      await sched.schedule({
        schedule: { type: "interval", everyMs: 100, startAt: 0 },
        jobKind: "noop", jobPayload: {},
        maxFires: 2,
      });
      await clock.advanceTo(0); await sched.tick();   // fire 1
      await clock.advanceTo(100); await sched.tick(); // fire 2
      await clock.advanceTo(200); await sched.tick(); // no fire
      await clock.advanceTo(10_000); await sched.tick(); // still no
      const pendingCount = (await queue.listByStatus("pending")).length;
      const succeededCount = (await queue.listByStatus("succeeded")).length;
      expect(pendingCount + succeededCount).toBe(2);
    });

    it("cancel removes a schedule", async () => {
      const s = await sched.schedule({
        schedule: { type: "interval", everyMs: 100, startAt: 0 },
        jobKind: "noop", jobPayload: {},
      });
      await clock.advanceTo(0); await sched.tick();
      expect((await sched.list()).length).toBe(1);
      const ok = await sched.cancel(s.id);
      expect(ok).toBe(true);
      await clock.advanceTo(1000); await sched.tick();
      expect(await sched.cancel(s.id)).toBe(false);
    });

    it("fires multiple due schedules in nextFireAt order", async () => {
      const a = await sched.schedule({
        schedule: { type: "once", at: 50 },
        jobKind: "noop", jobPayload: { which: "a" },
      });
      const b = await sched.schedule({
        schedule: { type: "once", at: 10 },
        jobKind: "noop", jobPayload: { which: "b" },
      });
      await clock.advanceTo(100);
      const r = await sched.tick();
      expect(r.fired).toBe(2);
      // Jobs are enqueued in order of nextFireAt — b before a.
      const jobs = await queue.listByStatus("succeeded");
      const order = jobs
        .sort((x, y) => x.enqueuedAt - y.enqueuedAt)
        .map((j) => (j.payload as any).which);
      expect(order).toEqual(["b", "a"]);
      void a; void b;
    });
  });
});
