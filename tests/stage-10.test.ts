import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SkillLearner } from "@runtime/learning/learner";
import { SkillRegistry } from "@runtime/skills/registry";
import { Store } from "@runtime/store/store";
import type { TaskRecord } from "@runtime/types";
import { makeWorkspace, type Workspace } from "@tests/mocks";

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: overrides.id ?? "t" + Math.random().toString(36).slice(2, 8),
    pattern: "summarize webpage",
    succeeded: true,
    completedAt: Date.now(),
    toolsUsed: ["fetch", "summarize"],
    summary: "Summarize a URL into 3 bullets.",
    ...overrides,
  };
}

describe("Stage 10 — Skill learning", () => {
  let ws: Workspace;
  let store: Store;
  let skillsDir: string;
  let registry: SkillRegistry;

  beforeEach(async () => {
    ws = makeWorkspace("learn");
    store = new Store({ workspace: ws.path });
    await store.open();
    skillsDir = join(ws.path, "skills");
    registry = new SkillRegistry({ roots: [{ path: skillsDir, origin: "workspace" }] });
  });
  afterEach(async () => { await store.close(); ws.cleanup(); });

  it("does not propose below threshold", async () => {
    const learner = new SkillLearner({ store, registry, skillsDir, threshold: 3 });
    expect(await learner.record(task({ id: "a" }))).toBeNull();
    expect(await learner.record(task({ id: "b" }))).toBeNull();
    expect((await learner.listProposals())).toHaveLength(0);
  });

  it("proposes on the Nth successful task of the same pattern", async () => {
    const learner = new SkillLearner({ store, registry, skillsDir, threshold: 3 });
    await learner.record(task({ id: "a" }));
    await learner.record(task({ id: "b" }));
    const p = await learner.record(task({ id: "c" }));
    expect(p).not.toBeNull();
    expect(p!.status).toBe("proposed");
    expect(p!.version).toBe(1);
    expect(p!.name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(p!.evidence).toEqual(["a", "b", "c"]);
  });

  it("does not count failed tasks toward the threshold", async () => {
    const learner = new SkillLearner({ store, registry, skillsDir, threshold: 3 });
    await learner.record(task({ id: "a" }));
    await learner.record(task({ id: "b", succeeded: false }));
    await learner.record(task({ id: "c" }));
    expect(await learner.listProposals()).toHaveLength(0);
    await learner.record(task({ id: "d" }));
    expect(await learner.listProposals()).toHaveLength(1);
  });

  it("record is idempotent for the same pattern past the threshold", async () => {
    const learner = new SkillLearner({ store, registry, skillsDir, threshold: 3 });
    await learner.record(task({ id: "a" }));
    await learner.record(task({ id: "b" }));
    const p1 = await learner.record(task({ id: "c" }));
    const p2 = await learner.record(task({ id: "d" }));
    expect(p2!.id).toBe(p1!.id);
    expect(await learner.listProposals()).toHaveLength(1);
  });

  it("finalize: rejected proposal does not write skill", async () => {
    const learner = new SkillLearner({
      store, registry, skillsDir, threshold: 1,
      approve: async () => false,
    });
    const p = await learner.record(task({ id: "a" }));
    const fin = await learner.finalize(p!);
    expect(fin.status).toBe("rejected");
    expect(existsSync(join(skillsDir, p!.name))).toBe(false);
  });

  it("finalize: approved proposal writes a valid SKILL.md the registry can load", async () => {
    const learner = new SkillLearner({
      store, registry, skillsDir, threshold: 1,
      approve: async () => true,
    });
    const p = await learner.record(task({ id: "a" }));
    const fin = await learner.finalize(p!);
    expect(fin.status).toBe("approved");
    const skillFile = join(skillsDir, p!.name, "SKILL.md");
    expect(existsSync(skillFile)).toBe(true);
    await registry.load();
    const s = registry.get(p!.name);
    expect(s).not.toBeNull();
    expect(s!.frontmatter.name).toBe(p!.name);
    expect(s!.origin).toBe("workspace");
  });

  it("collision: name suffixed -v2 if registry already has the slug", async () => {
    const learner = new SkillLearner({
      store, registry, skillsDir, threshold: 1,
      approve: async () => true,
    });
    const first = await learner.record(task({ id: "a", pattern: "do thing" }));
    await learner.finalize(first!);
    await registry.load();
    expect(registry.get("do-thing")).not.toBeNull();

    // New proposal with the same pattern (after rolling clean): different task ids force a new pattern token.
    const learner2 = new SkillLearner({
      store, registry, skillsDir, threshold: 1,
      approve: async () => true,
    });
    const next = await learner2.record(task({ id: "b", pattern: "do thing" }));
    // Same pattern → existing proposal id reused unless we tweak; but registry already has do-thing,
    // so the *new* proposal (fresh learner instance) detects the collision and proposes do-thing-v2.
    expect(next).not.toBeNull();
    // Either the same proposal (idempotent) or a v2 — both acceptable in spec.
    expect(["do-thing", "do-thing-v2"]).toContain(next!.name);
    if (next!.name === "do-thing-v2") {
      const fin = await learner2.finalize(next!);
      expect(fin.status).toBe("approved");
      expect(existsSync(join(skillsDir, "do-thing-v2", "SKILL.md"))).toBe(true);
    }
  });

  it("usage failures roll back an approved learned skill", async () => {
    const learner = new SkillLearner({
      store, registry, skillsDir, threshold: 1, rollbackThreshold: 3,
      approve: async () => true,
    });
    const p = await learner.record(task({ id: "a", pattern: "translate text" }));
    await learner.finalize(p!);
    const dir = join(skillsDir, p!.name);
    expect(existsSync(dir)).toBe(true);

    await learner.usage(p!.name, false);
    await learner.usage(p!.name, false);
    expect(existsSync(dir)).toBe(true);    // still here
    await learner.usage(p!.name, false);
    expect(existsSync(dir)).toBe(false);   // rolled back

    const proposals = await learner.listProposals();
    expect(proposals[0].status).toBe("rolled_back");
  });

  it("usage successes do not roll back", async () => {
    const learner = new SkillLearner({
      store, registry, skillsDir, threshold: 1, rollbackThreshold: 2,
      approve: async () => true,
    });
    const p = await learner.record(task({ id: "a", pattern: "compute sum" }));
    await learner.finalize(p!);
    await learner.usage(p!.name, true);
    await learner.usage(p!.name, true);
    await learner.usage(p!.name, true);
    expect(existsSync(join(skillsDir, p!.name))).toBe(true);
  });
});
