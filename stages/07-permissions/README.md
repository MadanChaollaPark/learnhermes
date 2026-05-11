# Stage 7 — Permissions and sandbox policy

> Skills declare what they want. The policy decides what they get.
> Default-deny risky actions. Allow read-only ones inside the
> workspace. Surface ambiguous calls to a human via an approval gate
> and remember the answer.

The runtime evaluates `(skill, action, scope)` against a layered set
of rules. This is the only place that should ever decide "may this
skill run a shell command, fetch a URL, or read a secret?" — every
other module should call `policy.require(...)` and let it decide.

---

## What you implement

`runtime/permissions/policy.ts`.

```ts
class Policy {
  constructor(opts: PolicyOptions)
  async evaluate(skill: string, action: PermissionAction, scope?: string):
    Promise<{ verdict: PermissionVerdict; reason: string }>
  async require(skill: string, action: PermissionAction, scope?: string):
    Promise<void>
}

interface PolicyOptions {
  workspace: string;
  rules: PolicyRule[];
  store?: Store;          // approvals persisted to "approvals" collection
  logger?: Logger;
  approve?: (req: { skill: string; action: PermissionAction; scope?: string })
    => Promise<boolean>;
}
```

### Defaults (when no rule matches)

| Action          | Default                              |
| --------------- | ------------------------------------ |
| `fs.read`       | allow **if** scope inside workspace; else deny |
| `fs.write`      | allow **if** scope inside workspace; else deny |
| `shell`         | deny                                 |
| `net.fetch`     | deny                                 |
| `secrets.read`  | deny                                 |

"Inside workspace" means `path.resolve(scope)` begins with the
workspace root. An absent scope on an `fs.*` action means *unbounded*
filesystem access → deny.

### Rule matching

A `PolicyRule` matches when:

1. `rule.skill === skill || rule.skill === "*"`,
2. `rule.action === action`,
3. if `rule.scope` is set, the request `scope` must equal it, **or**
   `rule.scope` ends with `/*` and `scope` starts with the prefix.

Among matches, sort by `precedence` descending; ties broken by:

- specificity: skill-specific beats `"*"`, scoped beats scopeless;
- if still tied, `deny` wins over `allow`/`prompt`.

The winning rule is the verdict.

### `prompt` and the approval gate

If the winning verdict is `prompt`:

- If `store` is set and an approval for `(skill, action, scope)`
  already exists in the `approvals` collection → return `allow`.
- Otherwise call `approve(...)`. If it returns `true`:
  - Record `{ id, skill, action, scope, grantedAt }` in `approvals`.
  - Return `allow`.
- If `approve` returns `false` → return `deny`.

If verdict is `prompt` and no `approve` callback is configured → `deny`
with reason `"no approver configured"`. (Default-deny: be paranoid.)

### `require()`

Calls `evaluate` and:

- `allow` → resolves.
- `deny` → throws `Error("permission denied: ...reason...")`.
- `prompt` already resolves to allow/deny inside `evaluate`; it should
  never bubble out of `require`.

---

## Test invariants

- Default `fs.read` inside workspace → allow.
- Default `fs.read` outside workspace → deny.
- Default `shell` → deny.
- A `PolicyRule { skill: "writer", action: "shell", verdict: "allow" }`
  flips the default for that skill only.
- Deny beats allow at equal precedence.
- `prompt` calls `approve` exactly once; second identical request is
  silent (cached approval).
- Denied `require()` throws; allowed `require()` resolves with no
  return value.

---

## Hints

- Resolve `workspace` with `path.resolve` once in the constructor —
  every call to `evaluate` reuses it.
- Don't try to be clever about glob patterns. `prefix/*` is enough.
- Keep `evaluate` pure aside from the approval-persistence side
  effect; `require` is the only public method that throws.
- The `approvals` collection just stores `StoreRecord`s with `id =
  "${skill}::${action}::${scope ?? ''}"`. That gives you O(1) lookup
  without scanning.

---

## Run

```
bun run stage 7
```
