# Stage 6 — Skill registry

> Load skills from one or more roots, validate each, enforce load
> precedence. A malformed skill must not crash the daemon — log,
> reject, continue.

OpenClaw and Hermes both keep skills as a `SKILL.md` with YAML
frontmatter. We do the same. The validator you write here is reused
in Stage 10 to gate **agent-generated** skills.

---

## What you implement

`runtime/skills/registry.ts`.

### On-disk layout

A skill lives at `<root>/<slug>/SKILL.md`. Example:

```
skills/
├── hello/
│   └── SKILL.md
└── echo/
    └── SKILL.md
```

A `SKILL.md` looks like:

```markdown
---
name: hello
description: Say hello to a user by name.
version: 0.1.0
tools: [send_message]
permissions:
  - action: net.fetch
    scope: https://api.example.com
---

When asked to greet someone, send them a friendly hello via send_message.
```

### Validation rules (reject if any fails)

1. Directory name matches `^[a-z][a-z0-9-]{0,63}$`.
2. Directory name is not in the reserved set: `system`, `admin`,
   `core`, `memory`, `daemon`.
3. `SKILL.md` exists and YAML frontmatter parses.
4. Frontmatter has `name` (string) and `description` (string).
5. `frontmatter.name === directoryName`.
6. If `tools` is present it is `string[]`.
7. If `permissions` is present each entry has `action` in the allowed
   set: `fs.read`, `fs.write`, `shell`, `net.fetch`, `secrets.read`.
8. Body is non-empty after the frontmatter.
9. The resolved real path of `SKILL.md` must sit inside the configured
   root (no symlink escape).

For every rejection, record `{ path, reason }` in `rejections()`.

### Load precedence

`opts.roots` is an ordered list. Skills in **later** roots win when
two roots provide the same `name`. For each conflict, log a warning
(`skill.override`) including both source paths.

The standard ordering for this course (the order tests pass): `bundled` → `user` → `workspace`.

### Required surface

```ts
class SkillRegistry {
  async load(): Promise<void>
  list(): Skill[]
  get(id: string): Skill | null
  rejections(): { path: string; reason: string }[]
}
```

---

## Test invariants

- Valid skill loads and is `get`-able by `id`.
- Missing `description` → rejected.
- Mismatched name/dir → rejected.
- Reserved dir name → rejected.
- Malformed YAML → rejected; sibling skills still load.
- Skill in `workspace` root with the same name overrides skill in
  `bundled` root.
- A skill whose real path escapes the configured root → rejected.

---

## Hints

- Use the `yaml` package (already in `package.json`). Split frontmatter
  with a simple regex: `^---\n(.*?)\n---\n([\s\S]*)$/s`.
- For symlink escape detection, `fs.realpathSync(p)` resolves the
  link; compare it against `path.resolve(root)`.
- The validator is reused in Stage 10. Keep it in a function you
  can import — don't bury it inside `load()`.

---

## Run

```
bun run stage 6
```
