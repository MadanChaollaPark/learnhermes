/**
 * Stage 10 — Self-improving skills.
 *
 * Watches TaskRecord events; after threshold (default 3) successful tasks
 * matching the same pattern, proposes a SKILL.md. Proposal goes through
 * validation (Stage 6 validator) and approval (callback). If approved,
 * the skill is written to disk under skills/proposed/<name>/SKILL.md
 * with a version field. If the skill later fails N times, it is rolled
 * back.
 *
 * Reference solution: solutions/10-learning/learner.ts
 */

import type { Logger, SkillProposal, TaskRecord } from "../types";
import { notImplemented } from "../util/not-implemented";
import type { Store } from "../store/store";
import type { SkillRegistry } from "../skills/registry";

export interface SkillLearnerOptions {
  store: Store;
  registry: SkillRegistry;
  logger?: Logger;
  /** How many successful matching tasks trigger a proposal. */
  threshold?: number;
  /** Where to write approved skills. Should be inside a registry root. */
  skillsDir: string;
  /** User approval callback. Mocked in tests. Default: auto-deny. */
  approve?: (proposal: SkillProposal) => Promise<boolean>;
  /** How many failures roll back a learned skill. Default 3. */
  rollbackThreshold?: number;
}

export class SkillLearner {
  constructor(_opts: SkillLearnerOptions) {}

  /** Record a task outcome. May trigger a proposal. */
  async record(record: TaskRecord): Promise<SkillProposal | null> {
    void record;
    return notImplemented("10-learning", "learning/learner", "implement record()");
  }

  /** Run the approval gate for a proposal. Writes the skill on approve. */
  async finalize(proposal: SkillProposal): Promise<SkillProposal> {
    void proposal;
    return notImplemented("10-learning", "learning/learner", "implement finalize()");
  }

  /** Mark a use of a learned skill. May trigger rollback. */
  async usage(skillId: string, succeeded: boolean): Promise<void> {
    void skillId; void succeeded;
    return notImplemented("10-learning", "learning/learner", "implement usage()");
  }

  async listProposals(): Promise<SkillProposal[]> {
    return notImplemented("10-learning", "learning/learner", "implement listProposals()");
  }
}
