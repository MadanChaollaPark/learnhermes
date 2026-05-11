/**
 * Stage 6 — Skill registry.
 *
 * Loads skills from one or more roots. Each skill is a directory
 * containing a SKILL.md with YAML frontmatter.
 *
 * Validation:
 *  - Directory name must match /^[a-z][a-z0-9-]{0,63}$/
 *  - Frontmatter must have `name` (matching dir) and `description`.
 *  - Optional `tools` must be string[]; `permissions` must be objects
 *    with `action` in the allowed set.
 *  - Resolved real path must sit inside an allowed root (no symlink
 *    escape).
 *
 * Reference solution: solutions/06-skills/registry.ts
 */

import type { Logger, Skill } from "../types";
import { notImplemented } from "../util/not-implemented";

export interface SkillRegistryOptions {
  /** Ordered list of roots. Later entries override earlier ones. */
  roots: { path: string; origin: "bundled" | "workspace" | "user" }[];
  logger?: Logger;
}

export interface ValidatedSkill {
  ok: true;
  skill: Omit<Skill, "origin">;
}
export interface SkillRejection {
  ok: false;
  reason: string;
}

/**
 * Validate a single skill directory. Reused by Stage 10's learning loop
 * to vet newly proposed skills before promoting them.
 *
 * Returns `{ ok: true, skill }` if every check passes, or
 * `{ ok: false, reason }` otherwise.
 */
export function validateSkillDirectory(
  dirPath: string,
  rootPath: string,
): ValidatedSkill | SkillRejection {
  void dirPath; void rootPath;
  return notImplemented("06-skills", "skills/registry", "implement validateSkillDirectory()");
}

export class SkillRegistry {
  constructor(_opts: SkillRegistryOptions) {}

  /** Scan all roots and load every valid skill. Invalid skills are
   *  logged and skipped (NOT thrown — the daemon should keep running). */
  async load(): Promise<void> {
    return notImplemented("06-skills", "skills/registry", "implement load()");
  }

  list(): Skill[] {
    return notImplemented("06-skills", "skills/registry", "implement list()");
  }

  get(id: string): Skill | null {
    void id;
    return notImplemented("06-skills", "skills/registry", "implement get()");
  }

  /** Reasons each skill on disk failed to load. Used in tests. */
  rejections(): { path: string; reason: string }[] {
    return notImplemented("06-skills", "skills/registry", "implement rejections()");
  }
}
