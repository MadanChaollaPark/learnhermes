import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { Policy } from "@runtime/permissions/policy";
import { Store } from "@runtime/store/store";
import { makeWorkspace, type Workspace } from "@tests/mocks";

describe("Stage 7 — Permissions policy", () => {
  let ws: Workspace;
  let store: Store;

  beforeEach(async () => {
    ws = makeWorkspace("perm");
    store = new Store({ workspace: ws.path });
    await store.open();
  });
  afterEach(async () => { await store.close(); ws.cleanup(); });

  describe("defaults", () => {
    it("allows fs.read inside workspace", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      const r = await p.evaluate("any", "fs.read", join(ws.path, "notes.txt"));
      expect(r.verdict).toBe("allow");
    });

    it("denies fs.read outside workspace", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      const r = await p.evaluate("any", "fs.read", "/etc/passwd");
      expect(r.verdict).toBe("deny");
    });

    it("denies fs.write outside workspace", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      const r = await p.evaluate("any", "fs.write", "/tmp/evil");
      expect(r.verdict).toBe("deny");
    });

    it("denies fs.read with no scope (unbounded)", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      const r = await p.evaluate("any", "fs.read");
      expect(r.verdict).toBe("deny");
    });

    it("denies shell by default", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      const r = await p.evaluate("any", "shell", "ls");
      expect(r.verdict).toBe("deny");
    });

    it("denies net.fetch by default", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      const r = await p.evaluate("any", "net.fetch", "https://example.com");
      expect(r.verdict).toBe("deny");
    });

    it("denies secrets.read by default", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      const r = await p.evaluate("any", "secrets.read", "OPENAI_API_KEY");
      expect(r.verdict).toBe("deny");
    });
  });

  describe("rule matching", () => {
    it("per-skill rule overrides default", async () => {
      const p = new Policy({
        workspace: ws.path,
        rules: [{ skill: "writer", action: "shell", verdict: "allow" }],
      });
      expect((await p.evaluate("writer", "shell", "ls")).verdict).toBe("allow");
      // Other skill still denied.
      expect((await p.evaluate("reader", "shell", "ls")).verdict).toBe("deny");
    });

    it("wildcard rule applies to every skill", async () => {
      const p = new Policy({
        workspace: ws.path,
        rules: [{ skill: "*", action: "net.fetch", verdict: "allow" }],
      });
      expect((await p.evaluate("a", "net.fetch", "https://x")).verdict).toBe("allow");
      expect((await p.evaluate("b", "net.fetch", "https://y")).verdict).toBe("allow");
    });

    it("skill-specific rule beats wildcard rule", async () => {
      const p = new Policy({
        workspace: ws.path,
        rules: [
          { skill: "*", action: "shell", verdict: "allow" },
          { skill: "untrusted", action: "shell", verdict: "deny" },
        ],
      });
      expect((await p.evaluate("trusted", "shell", "ls")).verdict).toBe("allow");
      expect((await p.evaluate("untrusted", "shell", "ls")).verdict).toBe("deny");
    });

    it("deny beats allow at equal precedence", async () => {
      const p = new Policy({
        workspace: ws.path,
        rules: [
          { skill: "writer", action: "shell", verdict: "allow" },
          { skill: "writer", action: "shell", verdict: "deny" },
        ],
      });
      expect((await p.evaluate("writer", "shell", "ls")).verdict).toBe("deny");
    });

    it("higher precedence wins", async () => {
      const p = new Policy({
        workspace: ws.path,
        rules: [
          { skill: "writer", action: "shell", verdict: "deny", precedence: 1 },
          { skill: "writer", action: "shell", verdict: "allow", precedence: 10 },
        ],
      });
      expect((await p.evaluate("writer", "shell", "ls")).verdict).toBe("allow");
    });

    it("scope prefix match (`prefix/*`)", async () => {
      const p = new Policy({
        workspace: ws.path,
        rules: [
          { skill: "fetcher", action: "net.fetch", scope: "https://api.example.com/*", verdict: "allow" },
        ],
      });
      expect((await p.evaluate("fetcher", "net.fetch", "https://api.example.com/users")).verdict)
        .toBe("allow");
      // Different host → falls through to default deny.
      expect((await p.evaluate("fetcher", "net.fetch", "https://other.com/x")).verdict)
        .toBe("deny");
    });
  });

  describe("approval gate", () => {
    it("prompt verdict calls approve() and caches the answer", async () => {
      let calls = 0;
      const p = new Policy({
        workspace: ws.path,
        store,
        rules: [{ skill: "fetcher", action: "net.fetch", verdict: "prompt" }],
        approve: async () => { calls++; return true; },
      });
      expect((await p.evaluate("fetcher", "net.fetch", "https://x")).verdict).toBe("allow");
      expect((await p.evaluate("fetcher", "net.fetch", "https://x")).verdict).toBe("allow");
      expect(calls).toBe(1);
    });

    it("prompt with no approver → deny", async () => {
      const p = new Policy({
        workspace: ws.path,
        rules: [{ skill: "fetcher", action: "net.fetch", verdict: "prompt" }],
      });
      const r = await p.evaluate("fetcher", "net.fetch", "https://x");
      expect(r.verdict).toBe("deny");
    });

    it("rejected approval is not cached", async () => {
      let calls = 0;
      const p = new Policy({
        workspace: ws.path,
        store,
        rules: [{ skill: "fetcher", action: "net.fetch", verdict: "prompt" }],
        approve: async () => { calls++; return false; },
      });
      expect((await p.evaluate("fetcher", "net.fetch", "https://x")).verdict).toBe("deny");
      expect((await p.evaluate("fetcher", "net.fetch", "https://x")).verdict).toBe("deny");
      expect(calls).toBe(2);
    });

    it("cached approval survives a fresh Policy instance", async () => {
      const approve = async () => true;
      const p1 = new Policy({
        workspace: ws.path,
        store,
        rules: [{ skill: "fetcher", action: "net.fetch", verdict: "prompt" }],
        approve,
      });
      expect((await p1.evaluate("fetcher", "net.fetch", "https://x")).verdict).toBe("allow");

      let calls = 0;
      const p2 = new Policy({
        workspace: ws.path,
        store,
        rules: [{ skill: "fetcher", action: "net.fetch", verdict: "prompt" }],
        approve: async () => { calls++; return false; },
      });
      expect((await p2.evaluate("fetcher", "net.fetch", "https://x")).verdict).toBe("allow");
      expect(calls).toBe(0);
    });
  });

  describe("require()", () => {
    it("resolves on allow", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      await expect(p.require("any", "fs.read", join(ws.path, "x"))).resolves.toBeUndefined();
    });

    it("throws on deny", async () => {
      const p = new Policy({ workspace: ws.path, rules: [] });
      await expect(p.require("any", "shell", "rm -rf /")).rejects.toThrow(/permission denied/i);
    });

    it("after approval, require resolves", async () => {
      const p = new Policy({
        workspace: ws.path,
        store,
        rules: [{ skill: "fetcher", action: "net.fetch", verdict: "prompt" }],
        approve: async () => true,
      });
      await expect(p.require("fetcher", "net.fetch", "https://x")).resolves.toBeUndefined();
    });
  });
});
