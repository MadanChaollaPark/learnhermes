import { describe, it, expect, beforeEach } from "vitest";
import { Gateway } from "@runtime/gateway/gateway";
import { CliChannel } from "@runtime/gateway/channels/cli";
import { MockChannel, FakeClock } from "@tests/mocks";
import type { RuntimeEvent } from "@runtime/types";

describe("Stage 3 — Message gateway", () => {
  let clock: FakeClock;
  let events: RuntimeEvent[];

  beforeEach(() => {
    clock = new FakeClock(1_000);
    events = [];
  });

  it("CliChannel conforms to the Channel interface", () => {
    const cli = new CliChannel();
    expect(cli.id).toBe("cli");
    expect(typeof cli.start).toBe("function");
    expect(typeof cli.stop).toBe("function");
    expect(typeof cli.send).toBe("function");
    expect(typeof cli.subscribe).toBe("function");
  });

  it("start() starts every channel; stop() stops every channel", async () => {
    const tg = new MockChannel("telegram", () => clock.now());
    const ds = new MockChannel("discord", () => clock.now());
    const g = new Gateway({
      channels: [tg, ds],
      onEvent: (e) => { events.push(e); },
    });

    // Outbound before start should throw (because channel is not started).
    await g.start();
    await g.send("telegram", { sender: "alice" }, "hello");
    expect(tg.outbox).toHaveLength(1);
    expect(ds.outbox).toHaveLength(0);
    await g.send("discord", { sender: "bob" }, "yo");
    expect(ds.outbox).toHaveLength(1);
    await g.stop();
  });

  it("normalizes inbound envelopes into RuntimeEvents", async () => {
    const tg = new MockChannel("telegram", () => clock.now());
    const g = new Gateway({ channels: [tg], onEvent: (e) => { events.push(e); } });
    await g.start();

    await tg.inject({ sender: "alice", body: "hi", id: "tg-1" });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("message");
    expect(events[0].source).toBe("telegram");
    expect(events[0].envelope?.id).toBe("tg-1");
    expect(events[0].envelope?.body).toBe("hi");
    expect(events[0].envelope?.sender).toBe("alice");
    await g.stop();
  });

  it("dedupes inbound by envelope id", async () => {
    const tg = new MockChannel("telegram", () => clock.now());
    const g = new Gateway({ channels: [tg], onEvent: (e) => { events.push(e); } });
    await g.start();

    await tg.inject({ sender: "alice", body: "hi", id: "dup-1" });
    await tg.inject({ sender: "alice", body: "hi (duplicate)", id: "dup-1" });
    await tg.inject({ sender: "alice", body: "hello again", id: "dup-2" });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.envelope?.id)).toEqual(["dup-1", "dup-2"]);
    await g.stop();
  });

  it("routes outbound to the right channel", async () => {
    const tg = new MockChannel("telegram", () => clock.now());
    const ds = new MockChannel("discord", () => clock.now());
    const g = new Gateway({
      channels: [tg, ds],
      onEvent: (e) => { events.push(e); },
    });
    await g.start();

    await g.send("telegram", { sender: "user-1" }, "from gateway");
    await g.send("discord", { sender: "user-2" }, "different");

    expect(tg.outbox.map((m) => m.body)).toEqual(["from gateway"]);
    expect(ds.outbox.map((m) => m.body)).toEqual(["different"]);
    await g.stop();
  });

  it("throws on send to an unknown channel", async () => {
    const tg = new MockChannel("telegram", () => clock.now());
    const g = new Gateway({ channels: [tg], onEvent: (e) => { events.push(e); } });
    await g.start();
    await expect(g.send("instagram", {}, "hi")).rejects.toThrow(/unknown channel|not registered/i);
    await g.stop();
  });

  it("does not deliver inbound that arrived before start()", async () => {
    const tg = new MockChannel("telegram", () => clock.now());
    const g = new Gateway({ channels: [tg], onEvent: (e) => { events.push(e); } });
    // MockChannel.inject() throws before start() — verifies the contract.
    await expect(tg.inject({ sender: "x", body: "y", id: "pre-1" })).rejects.toThrow();
    expect(events).toHaveLength(0);
  });

  it("envelopes from different channels are independent in dedup", async () => {
    const tg = new MockChannel("telegram", () => clock.now());
    const ds = new MockChannel("discord", () => clock.now());
    const g = new Gateway({
      channels: [tg, ds],
      onEvent: (e) => { events.push(e); },
    });
    await g.start();
    // Same id, different channels — should NOT dedupe across channels.
    await tg.inject({ sender: "alice", body: "tg side", id: "same-1" });
    await ds.inject({ sender: "alice", body: "ds side", id: "same-1" });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.source).sort()).toEqual(["discord", "telegram"]);
    await g.stop();
  });
});
