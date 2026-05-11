/**
 * Reference implementation for Stage 10.
 *
 * Reuses validateSkillDirectory from Stage 6 so agent-generated
 * SKILL.md files go through the same gate as bundled ones.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type {
  Logger,
  SkillProposal,
  StoreRecord,
  TaskRecord,
} from "@runtime/types";
import type { Store } from "@runtime/store/store";
import { SkillRegistry, validateSkillDirectory } from "@runtime/skills/registry";
import { newId } from "@runtime/util/ids";

export interface SkillLearnerOptions {
  store: Store;
  registry: SkillRegistry;
  logger?: Logger;
  threshold?: number;
  skillsDir: string;
  approve?: (proposal: SkillProposal) => Promise<boolean>;
  rollbackThreshold?: number;
}

interface ProposalRecord extends SkillProposal {
  pattern: string;
  failureCount?: number;
  successCount?: number;
}

export class SkillLearner {
  private store: Store;
  private registry: SkillRegistry;
  private logger?: Logger;
  private threshold: number;
  private skillsDir: string;
  private approve: NonNullable<SkillLearnerOptions["approve"]>;
  private rollbackThreshold: number;

  constructor(opts: SkillLearnerOptions) {
    this.store = opts.store;
    this.registry = opts.registry;
    this.logger = opts.logger;
    this.threshold = opts.threshold ?? 3;
    this.skillsDir = opts.skillsDir;
    this.approve = opts.approve ?? (async () => false);
    this.rollbackThreshold = opts.rollbackThreshold ?? 3;
  }

  async record(task: TaskRecord): Promise<SkillProposal | null> {
    await this.store.put("tasks", task as TaskRecord & StoreRecord);

    if (!task.succeeded) return null;

    // Already proposed for this pattern? Return the existing record.
    const existing = await this.findProposalForPattern(task.pattern);
    if (existing && existing.status !== "rejected" && existing.status !== "rolled_back") {
      return existing;
    }

    // Count successful tasks with this pattern.
    const all = await this.store.list<TaskRecord & StoreRecord>("tasks");
    const successes = all.filter((t) => t.succeeded && t.pattern === task.pattern);
    if (successes.length < this.threshold) return null;

    const evidence = successes.map((t) => t.id);
    const first = successes[0];

    const baseName = slugify(task.pattern);
    const name = this.collisionSafeName(baseName);
    const toolsUsed = uniq(successes.flatMap((t) => t.toolsUsed));
    const description = first.summary || `Auto-learned skill for pattern ${task.pattern}`;
    const body = renderBody({ name, count: successes.length, pattern: task.pattern, toolsUsed });

    const proposal: ProposalRecord = {
      id: newId("prop"),
      name,
      description,
      body,
      evidence,
      status: "proposed",
      createdAt: Date.now(),
      version: 1,
      pattern: task.pattern,
    };
    await this.store.put("proposals", proposal as ProposalRecord & StoreRecord);
    this.logger?.info("skill.proposed", { name, evidence });
    return proposal;
  }

  async finalize(proposal: SkillProposal): Promise<SkillProposal> {
    const pr = (await this.store.get<ProposalRecord & StoreRecord>("proposals", proposal.id))
      ?? (proposal as ProposalRecord);

    const ok = await this.approve(pr);
    if (!ok) {
      const updated: ProposalRecord = { ...pr, status: "rejected" };
      await this.store.put("proposals", updated as ProposalRecord & StoreRecord);
      this.logger?.info("skill.rejected", { name: pr.name });
      return updated;
    }

    const skillFile = join(this.skillsDir, pr.name, "SKILL.md");
    const content = renderSkillFile(pr);
    mkdirSync(dirname(skillFile), { recursive: true });
    writeFileSync(skillFile, content, "utf8");

    const valid = validateSkillDirectory(join(this.skillsDir, pr.name), this.skillsDir);
    if (!valid.ok) {
      try { rmSync(join(this.skillsDir, pr.name), { recursive: true, force: true }); } catch { /* ignore */ }
      const updated: ProposalRecord = { ...pr, status: "rejected" };
      await this.store.put("proposals", updated as ProposalRecord & StoreRecord);
      this.logger?.warn("skill.invalid", { name: pr.name, reason: valid.reason });
      return updated;
    }

    const approved: ProposalRecord = { ...pr, status: "approved" };
    await this.store.put("proposals", approved as ProposalRecord & StoreRecord);
    this.logger?.info("skill.approved", { name: pr.name });
    return approved;
  }

  async usage(skillId: string, succeeded: boolean): Promise<void> {
    const proposals = await this.store.list<ProposalRecord & StoreRecord>("proposals");
    const target = proposals.find((p) => p.name === skillId && p.status === "approved");
    if (!target) return;

    if (succeeded) {
      const updated: ProposalRecord = { ...target, successCount: (target.successCount ?? 0) + 1 };
      await this.store.put("proposals", updated as ProposalRecord & StoreRecord);
      return;
    }

    const failureCount = (target.failureCount ?? 0) + 1;
    if (failureCount >= this.rollbackThreshold) {
      try { rmSync(join(this.skillsDir, target.name), { recursive: true, force: true }); } catch { /* ignore */ }
      const rolled: ProposalRecord = { ...target, failureCount, status: "rolled_back" };
      await this.store.put("proposals", rolled as ProposalRecord & StoreRecord);
      this.logger?.warn("skill.rolled_back", { name: target.name, failureCount });
      return;
    }
    const updated: ProposalRecord = { ...target, failureCount };
    await this.store.put("proposals", updated as ProposalRecord & StoreRecord);
  }

  async listProposals(): Promise<SkillProposal[]> {
    const all = await this.store.list<ProposalRecord & StoreRecord>("proposals");
    return [...all].sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── internals ────────────────────────────────────────────────────────

  private async findProposalForPattern(pattern: string): Promise<ProposalRecord | null> {
    const all = await this.store.list<ProposalRecord & StoreRecord>("proposals");
    return all.find((p) => p.pattern === pattern) ?? null;
  }

  private collisionSafeName(base: string): string {
    if (!this.registry.get(base)) return base;
    let n = 2;
    while (this.registry.get(`${base}-v${n}`)) n++;
    return `${base}-v${n}`;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function renderBody(args: { name: string; count: number; pattern: string; toolsUsed: string[] }): string {
  return [
    `# ${args.name}`,
    "",
    `Auto-learned from ${args.count} successful runs.`,
    "",
    `Pattern: ${args.pattern}`,
    "",
    `Tools used: ${args.toolsUsed.join(", ")}`,
    "",
  ].join("\n");
}

function renderSkillFile(p: ProposalRecord): string {
  const fm = [
    "---",
    `name: ${p.name}`,
    `description: ${oneLine(p.description)}`,
    `version: 0.${p.version}.0`,
    "---",
    "",
  ].join("\n");
  return fm + p.body;
}

function oneLine(s: string): string {
  // YAML scalar safety: collapse newlines and strip leading/trailing whitespace.
  return s.replace(/\s+/g, " ").trim();
}

// existsSync is imported only to surface a clear error if the test infra
// expects a directory that the learner is supposed to create.
void existsSync;
