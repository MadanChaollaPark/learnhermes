import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Daemon } from "@runtime/daemon/daemon";
import { makeWorkspace, type Workspace } from "@tests/mocks";

describe("Stage 1 — Daemon skeleton", () => {
  let ws: Workspace;
  beforeEach(() => { ws = makeWorkspace("daemon"); });
  afterEach(() => { ws.cleanup(); });

  const pidFileFor = (w: Workspace) => join(w.path, "runtime.pid");

  it("starts in 'stopped' state with no PID file", () => {
    const d = new Daemon({ workspace: ws.path });
    expect(d.state).toBe("stopped");
    expect(d.status().pid).toBeNull();
    expect(existsSync(pidFileFor(ws))).toBe(false);
  });

  it("transitions stopped → running on start(), writes PID file", async () => {
    const d = new Daemon({ workspace: ws.path });
    await d.start();
    expect(d.state).toBe("running");
    expect(existsSync(pidFileFor(ws))).toBe(true);
    expect(readFileSync(pidFileFor(ws), "utf8").trim()).toBe(String(process.pid));
    expect(d.status().pid).toBe(process.pid);
    expect(typeof d.status().startedAt).toBe("number");
    await d.stop();
  });

  it("transitions running → stopped on stop(), removes PID file", async () => {
    const d = new Daemon({ workspace: ws.path });
    await d.start();
    await d.stop();
    expect(d.state).toBe("stopped");
    expect(existsSync(pidFileFor(ws))).toBe(false);
    expect(d.status().pid).toBeNull();
  });

  it("is idempotent: start when running is a no-op", async () => {
    const d = new Daemon({ workspace: ws.path });
    await d.start();
    const stamp1 = d.status().startedAt;
    await d.start();
    expect(d.state).toBe("running");
    expect(d.status().startedAt).toBe(stamp1);
    await d.stop();
  });

  it("is idempotent: stop when stopped is a no-op", async () => {
    const d = new Daemon({ workspace: ws.path });
    await d.stop();
    expect(d.state).toBe("stopped");
  });

  it("runs onStart after the PID file is written", async () => {
    const events: string[] = [];
    const d = new Daemon({
      workspace: ws.path,
      onStart: () => {
        events.push(`pid-file-exists=${existsSync(pidFileFor(ws))}`);
        events.push(`state=running`);
      },
    });
    await d.start();
    expect(events).toEqual(["pid-file-exists=true", "state=running"]);
    await d.stop();
  });

  it("rolls back to stopped when onStart throws", async () => {
    const d = new Daemon({
      workspace: ws.path,
      onStart: () => { throw new Error("boom"); },
    });
    await expect(d.start()).rejects.toThrow(/boom/);
    expect(d.state).toBe("stopped");
    expect(existsSync(pidFileFor(ws))).toBe(false);
  });

  it("runs onStop before removing the PID file", async () => {
    const events: string[] = [];
    const d = new Daemon({
      workspace: ws.path,
      onStop: () => {
        events.push(`pid-file-exists=${existsSync(pidFileFor(ws))}`);
      },
    });
    await d.start();
    await d.stop();
    expect(events).toEqual(["pid-file-exists=true"]);
    expect(existsSync(pidFileFor(ws))).toBe(false);
  });

  it("refuses to start when an active PID file is present", async () => {
    const d1 = new Daemon({ workspace: ws.path });
    await d1.start();
    const d2 = new Daemon({ workspace: ws.path });
    await expect(d2.start()).rejects.toThrow(/already running|active|locked/i);
    await d1.stop();
  });

  it("cleans up a stale PID file and starts", async () => {
    // Write a PID that is almost certainly dead.
    const stalePid = 999999;
    require("node:fs").writeFileSync(pidFileFor(ws), String(stalePid));
    const d = new Daemon({ workspace: ws.path });
    await d.start();
    expect(d.state).toBe("running");
    expect(readFileSync(pidFileFor(ws), "utf8").trim()).toBe(String(process.pid));
    await d.stop();
  });

  it("rejects illegal transitions like stop during starting", async () => {
    // Use a slow onStart hook to catch the daemon mid-transition.
    let resolveStart: (() => void) | undefined;
    const startBlocked = new Promise<void>((r) => { resolveStart = r; });
    const d = new Daemon({
      workspace: ws.path,
      onStart: async () => { await startBlocked; },
    });
    const startP = d.start();
    // At this point state should be "starting".
    expect(d.state).toBe("starting");
    await expect(d.stop()).rejects.toThrow(/cannot stop while starting|illegal/i);
    resolveStart!();
    await startP;
    await d.stop();
  });
});
