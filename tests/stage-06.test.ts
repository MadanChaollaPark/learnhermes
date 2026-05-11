import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SkillRegistry } from "@runtime/skills/registry";
import { makeWorkspace, type Workspace } from "@tests/mocks";

function writeSkill(root: string, slug: string, frontmatter: string, body: string): void {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}\n`, "utf8");
}

describe("Stage 6 — Skill registry", () => {
  let ws: Workspace;
  beforeEach(() => { ws = makeWorkspace("skills"); });
  afterEach(() => { ws.cleanup(); });

  it("loads a valid skill", async () => {
    const root = join(ws.path, "bundled");
    writeSkill(root, "hello",
      "name: hello\ndescription: Say hello.",
      "When asked, greet the user.");
    const reg = new SkillRegistry({ roots: [{ path: root, origin: "bundled" }] });
    await reg.load();
    const skills = reg.list();
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("hello");
    expect(skills[0].frontmatter.name).toBe("hello");
    expect(skills[0].frontmatter.description).toBe("Say hello.");
    expect(skills[0].body).toMatch(/greet the user/);
    expect(reg.get("hello")?.id).toBe("hello");
  });

  it("rejects skill missing description", async () => {
    const root = join(ws.path, "bundled");
    writeSkill(root, "broken", "name: broken", "body");
    const reg = new SkillRegistry({ roots: [{ path: root, origin: "bundled" }] });
    await reg.load();
    expect(reg.list()).toHaveLength(0);
    const r = reg.rejections();
    expect(r).toHaveLength(1);
    expect(r[0].reason).toMatch(/description/i);
  });

  it("rejects mismatched name and directory", async () => {
    const root = join(ws.path, "bundled");
    writeSkill(root, "dir-name",
      "name: different-name\ndescription: x",
      "body");
    const reg = new SkillRegistry({ roots: [{ path: root, origin: "bundled" }] });
    await reg.load();
    expect(reg.list()).toHaveLength(0);
    expect(reg.rejections()[0].reason).toMatch(/name.*directory|mismatch/i);
  });

  it("rejects reserved directory names", async () => {
    const root = join(ws.path, "bundled");
    for (const name of ["system", "admin", "core", "memory", "daemon"]) {
      writeSkill(root, name, `name: ${name}\ndescription: x`, "body");
    }
    const reg = new SkillRegistry({ roots: [{ path: root, origin: "bundled" }] });
    await reg.load();
    expect(reg.list()).toHaveLength(0);
    expect(reg.rejections().length).toBe(5);
  });

  it("rejects invalid slugs", async () => {
    const root = join(ws.path, "bundled");
    writeSkill(root, "Bad-Caps", "name: bad-caps\ndescription: x", "body");
    writeSkill(root, "with space", "name: x\ndescription: x", "body");
    const reg = new SkillRegistry({ roots: [{ path: root, origin: "bundled" }] });
    await reg.load();
    expect(reg.list()).toHaveLength(0);
    expect(reg.rejections().length).toBe(2);
  });

  it("rejects malformed YAML but keeps loading siblings", async () => {
    const root = join(ws.path, "bundled");
    writeSkill(root, "ok", "name: ok\ndescription: ok", "body");
    // Malformed: missing value
    writeSkill(root, "broken", "name: broken\ndescription:\n  - oops: [unbalanced", "body");
    const reg = new SkillRegistry({ roots: [{ path: root, origin: "bundled" }] });
    await reg.load();
    expect(reg.list().map((s) => s.id)).toEqual(["ok"]);
    expect(reg.rejections().length).toBe(1);
  });

  it("workspace override beats bundled", async () => {
    const bundled = join(ws.path, "bundled");
    const workspace = join(ws.path, "workspace");
    writeSkill(bundled, "hello", "name: hello\ndescription: bundled", "body");
    writeSkill(workspace, "hello", "name: hello\ndescription: workspace", "body");
    const reg = new SkillRegistry({
      roots: [
        { path: bundled, origin: "bundled" },
        { path: workspace, origin: "workspace" },
      ],
    });
    await reg.load();
    const s = reg.get("hello")!;
    expect(s.frontmatter.description).toBe("workspace");
    expect(s.origin).toBe("workspace");
  });

  it("rejects unknown permission actions", async () => {
    const root = join(ws.path, "bundled");
    writeSkill(root, "weird",
      "name: weird\ndescription: x\npermissions:\n  - action: nuke",
      "body");
    const reg = new SkillRegistry({ roots: [{ path: root, origin: "bundled" }] });
    await reg.load();
    expect(reg.list()).toHaveLength(0);
    expect(reg.rejections()[0].reason).toMatch(/permission|action/i);
  });

  it("rejects symlink escape", async () => {
    const root = join(ws.path, "bundled");
    const evilHome = join(ws.path, "evil");
    mkdirSync(evilHome, { recursive: true });
    writeFileSync(join(evilHome, "SKILL.md"), "---\nname: outside\ndescription: x\n---\nbody\n", "utf8");
    mkdirSync(root, { recursive: true });
    // Symlink inside root pointing outside root.
    try {
      symlinkSync(evilHome, join(root, "outside"), "dir");
    } catch {
      // CI without symlink permission — skip.
      return;
    }
    const reg = new SkillRegistry({ roots: [{ path: root, origin: "bundled" }] });
    await reg.load();
    expect(reg.list()).toHaveLength(0);
    const r = reg.rejections();
    expect(r.length).toBe(1);
    expect(r[0].reason).toMatch(/path|root|escape|symlink/i);
  });

  it("does not throw if a root does not exist yet (logs and continues)", async () => {
    const missing = join(ws.path, "does-not-exist");
    const reg = new SkillRegistry({ roots: [{ path: missing, origin: "bundled" }] });
    await reg.load();
    expect(reg.list()).toEqual([]);
    expect(existsSync(missing)).toBe(false);
  });
});
