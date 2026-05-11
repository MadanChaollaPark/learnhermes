# Stage 10 — Self-improving skills (hard)

> The runtime watches what its skills do. When the same pattern of
> successful work shows up enough times, it proposes a new skill. A
> human approves or rejects. Approved skills are written to disk and
> picked up by the registry on next load. If a learned skill starts
> failing in production, it gets rolled back.

This is the loop that makes the agent compound. Stage 6 wrote the
validator; here we reuse it. Stage 11 (ledger) will track invocations
so we know what "failing in production" means.

---

## What you implement

`runtime/learning/learner.ts`.

```ts
class SkillLearner {
  constructor(opts: SkillLearnerOptions)
  async record(record: TaskRecord): Promise<SkillProposal | null>
  async finalize(proposal: SkillProposal): Promise<SkillProposal>
  async usage(skillId: string, succeeded: boolean): Promise<void>
  async listProposals(): Promise<SkillProposal[]>
}

interface SkillLearnerOptions {
  store: Store;
  registry: SkillRegistry;
  logger?: Logger;
  threshold?: number;          // default 3 successes
  skillsDir: string;           // where to write approved SKILL.md
  approve?: (p: SkillProposal) => Promise<boolean>;   // default deny
  rollbackThreshold?: number;  // default 3 failures
}
```

### `record(task)`

1. Persist the `TaskRecord` to the `ledger` collection.
2. If `task.succeeded === false`, return `null`.
3. Count the *successful* records sharing `task.pattern`. If less
   than `threshold`, return `null`.
4. Otherwise produce a `SkillProposal`:
   - `id = newId("prop")`
   - `name` = a slug derived from the pattern (lowercase,
     non-`[a-z0-9-]` → `-`, trimmed). If the proposed name collides
     with an existing registry skill, suffix `-v2`, `-v3`, etc.
   - `description` = first record's `summary`, or "Auto-learned
     skill for pattern X" if absent.
   - `body` = a deterministic template:

     ```
     # <name>

     Auto-learned from <N> successful runs.

     Pattern: <pattern>

     Tools used: <comma-separated unique toolsUsed>
     ```
   - `status = "proposed"`, `version = 1`, `evidence = [taskIds]`.
5. Persist the proposal to `proposals` collection. Return it.

A pattern that already produced a `proposed`/`approved` proposal
must NOT produce a duplicate; the same proposal can be returned again
(idempotent record() for the same pattern).

### `finalize(proposal)`

1. Call `approve(proposal)`. If it returns `false`:
   - Update proposal `status = "rejected"`, persist, return it.
2. Otherwise:
   - Construct the SKILL.md text (frontmatter + body).
   - Write it under `<skillsDir>/<name>/SKILL.md`.
   - Run `validateSkillDirectory(<skillsDir>/<name>, <skillsDir>)`
     (imported from `runtime/skills/registry`).
   - If validation fails → revert the write, set `status = "rejected"`,
     persist with a reason, return it.
   - If valid: set `status = "approved"`, persist, return it.

### `usage(skillId, succeeded)`

- For each approved proposal where `name === skillId`:
  - If `succeeded === false`, increment its `failureCount` counter
    (stored as `usageStats` keyed by skillId). When it crosses
    `rollbackThreshold`:
    - Delete the on-disk skill directory.
    - Set proposal `status = "rolled_back"`, persist.
    - Log a `skill.rolled_back` warning.

### `listProposals()`

Return all proposals from the store, newest first.

---

## Test invariants

- Recording 2 successes does not yet propose.
- Recording the 3rd success produces a proposal with `status:
  "proposed"`, version `1`, and a derived slug.
- A failed task does not contribute to the threshold.
- `record` is idempotent: the same pattern crossing the threshold
  again returns the existing proposal instead of creating a duplicate.
- `finalize` with `approve` returning `false` → `status: "rejected"`,
  nothing on disk.
- `finalize` with `approve: true` writes a valid SKILL.md and the
  registry can load it on the next `load()`.
- `finalize` with a body that fails validation (mocked by writing
  bad frontmatter manually) reverts and rejects.
- After 3 `usage(id, false)` calls, the learned skill is rolled
  back (directory removed; status changes).

---

## Hints

- `validateSkillDirectory` is a *named export* from
  `@runtime/skills/registry`. You wrote it in Stage 6 specifically so
  it could be reused here.
- "Pattern" is whatever string the caller chooses. Tests use plain
  strings like `"summarize webpage"`.
- For the slug: `name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/(^-|-$)/g, "")`.
- Storage layout:
  - `proposals` collection: SkillProposal records.
  - `ledger` collection: TaskRecord rows used to count successes.
  - `skills.usage` is its own pseudo-collection — but reuse
    `proposals` and store `failureCount` per proposal record to keep
    it simple.

---

## Run

```
bun run stage 10
```
