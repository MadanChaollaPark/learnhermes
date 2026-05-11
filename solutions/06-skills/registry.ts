/**
 * Reference implementation for Stage 6.
 *
 * The validator is exported separately so Stage 10 (learning loop) can
 * reuse it for agent-generated skills.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Logger, PermissionAction, Skill, SkillFrontmatter } from "@runtime/types";

const RESERVED = new Set(["system", "admin", "core", "memory", "daemon"]);
const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ALLOWED_PERMS: PermissionAction[] = [
  "fs.read", "fs.write", "shell", "net.fetch", "secrets.read",
];
const ALLOWED_PERM_SET = new Set(ALLOWED_PERMS);

export interface SkillRegistryOptions {
  roots: { path: string; origin: "bundled" | "workspace" | "user" }[];
  logger?: Logger;
}

export interface ValidatedSkill {
  ok: true;
  skill: Omit<Skill, "origin">;
}
export interface SkillRejection { ok: false; reason: string }

export function validateSkillDirectory(
  dirPath: string,
  rootPath: string,
): ValidatedSkill | SkillRejection {
  // 1. Slug from directory name.
  const slug = dirPath.split(/[\\/]/).pop()!;
  if (RESERVED.has(slug)) return { ok: false, reason: `Reserved name: ${slug}` };
  if (!SLUG_RE.test(slug)) return { ok: false, reason: `Invalid slug: ${slug}` };

  // 2. Real path containment.
  const skillFile = join(dirPath, "SKILL.md");
  if (!existsSync(skillFile)) return { ok: false, reason: `Missing SKILL.md in ${dirPath}` };
  let real: string;
  try { real = realpathSync(skillFile); } catch (e) {
    return { ok: false, reason: `Cannot resolve real path: ${(e as Error).message}` };
  }
  const realRoot = realpathSync(rootPath);
  if (!real.startsWith(realRoot + (realRoot.endsWith("/") ? "" : "/"))) {
    return { ok: false, reason: `Skill real path escapes root (symlink?): ${real}` };
  }

  // 3. Parse frontmatter.
  let raw: string;
  try { raw = readFileSync(real, "utf8"); } catch (e) {
    return { ok: false, reason: `Cannot read SKILL.md: ${(e as Error).message}` };
  }
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { ok: false, reason: "Missing YAML frontmatter" };
  const [, fmRaw, body] = m;
  let fm: any;
  try { fm = parseYaml(fmRaw); } catch (e) {
    return { ok: false, reason: `Malformed YAML: ${(e as Error).message}` };
  }
  if (!fm || typeof fm !== "object") return { ok: false, reason: "Frontmatter is not an object" };

  // 4. Required fields.
  if (typeof fm.name !== "string") return { ok: false, reason: "Missing or non-string `name`" };
  if (typeof fm.description !== "string" || fm.description.trim() === "") {
    return { ok: false, reason: "Missing or empty `description`" };
  }
  if (fm.name !== slug) return { ok: false, reason: `name (${fm.name}) does not match directory (${slug})` };

  // 5. Optional tools.
  if (fm.tools !== undefined) {
    if (!Array.isArray(fm.tools) || !fm.tools.every((t: any) => typeof t === "string")) {
      return { ok: false, reason: "`tools` must be string[]" };
    }
  }

  // 6. Optional permissions.
  if (fm.permissions !== undefined) {
    if (!Array.isArray(fm.permissions)) return { ok: false, reason: "`permissions` must be a list" };
    for (const p of fm.permissions) {
      if (!p || typeof p !== "object" || typeof p.action !== "string") {
        return { ok: false, reason: "`permissions` entry missing string `action`" };
      }
      if (!ALLOWED_PERM_SET.has(p.action)) {
        return { ok: false, reason: `Unknown permission action: ${p.action}` };
      }
      if (p.scope !== undefined && typeof p.scope !== "string") {
        return { ok: false, reason: "`permissions[].scope` must be string" };
      }
    }
  }

  // 7. Non-empty body.
  if (!body || body.trim() === "") return { ok: false, reason: "Empty skill body" };

  const frontmatter: SkillFrontmatter = {
    name: fm.name,
    description: fm.description,
    version: typeof fm.version === "string" ? fm.version : undefined,
    tools: fm.tools,
    permissions: fm.permissions,
    platforms: Array.isArray(fm.platforms) ? fm.platforms : undefined,
  };
  return {
    ok: true,
    skill: { id: slug, root: dirPath, frontmatter, body },
  };
}

export class SkillRegistry {
  private opts: SkillRegistryOptions;
  private bySlug = new Map<string, Skill>();
  private _rejections: { path: string; reason: string }[] = [];

  constructor(opts: SkillRegistryOptions) {
    this.opts = opts;
  }

  async load(): Promise<void> {
    this.bySlug.clear();
    this._rejections = [];
    for (const root of this.opts.roots) {
      if (!existsSync(root.path)) continue;
      let entries: string[];
      try { entries = readdirSync(root.path); } catch { continue; }
      for (const entry of entries) {
        const dirPath = resolve(root.path, entry);
        try {
          const st = statSync(dirPath);
          if (!st.isDirectory()) continue;
        } catch { continue; }
        const v = validateSkillDirectory(dirPath, root.path);
        if (!v.ok) {
          this._rejections.push({ path: dirPath, reason: v.reason });
          this.opts.logger?.warn("skill.rejected", { path: dirPath, reason: v.reason });
          continue;
        }
        if (this.bySlug.has(v.skill.id)) {
          this.opts.logger?.warn("skill.override", {
            id: v.skill.id,
            previous: this.bySlug.get(v.skill.id)!.root,
            next: v.skill.root,
          });
        }
        this.bySlug.set(v.skill.id, { ...v.skill, origin: root.origin });
      }
    }
  }

  list(): Skill[] {
    return [...this.bySlug.values()];
  }

  get(id: string): Skill | null {
    return this.bySlug.get(id) ?? null;
  }

  rejections(): { path: string; reason: string }[] {
    return [...this._rejections];
  }
}
