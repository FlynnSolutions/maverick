---
device: true
format: checklist
---
# 🛠️ Maverick — Checklist

> **Maverick's own work tracker**, in the shape Maverick parses: `## 🔥 Priority`,
> `## 🚧 In Progress`, `## 📋 Backlog`, `## ✅ Recently shipped, pending release`. `###` headings
> under Priority are releases. This is the canonical list; items commit to `hq/PUNCHLIST.md` get
> pulled *up* there, never duplicated. The repo rules are [`RULEBOOK.md`](../RULEBOOK.md).
>
> **Source tags:** `[ENG]` engineering / feature · `[DEBT]` tech debt · `[OSS]` open-source
> readiness · `[DOC]` docs and standards.

---

## 🔥 Priority

### Open source, for real

- [ ] `[OSS]` `[S]` **Clear agent-readiness Level 2 on Maverick itself**
  - created: 2026-09-16
  - source: Cory, 2026-09-16 (competitive research session)
  - kind: chore
  Baseline on 2026-09-16 was **Level 1, 3%**, the worst repo measured on this machine. Eight
  criteria short of Level 2. The cheap ones first: a linter and formatter config, `.editorconfig`,
  `.nvmrc`, a `test` script with at least one real test, `CONTRIBUTING.md`, `SECURITY.md`, a CI
  workflow that runs lint and test. Re-run `npx @kodus/agent-readiness . --ci --no-web` and put the
  number in the README. Maverick cannot ship a readiness score it fails.

- [ ] `[OSS]` `[S]` **The public repo reads like one**
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: chore
  `LICENSE` landed 2026-09-16. Still missing: `CONTRIBUTING.md`, `SECURITY.md`, issue and PR
  templates under `.github/`, a screenshot or GIF in the README, and a one-line description of who
  this is for. Do not post about it before this is done.

### The level model

- [ ] `[ENG]` `[L]` **Three levels of agent per project, not one pool of sessions**
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
  The reframe. **Level 1, the project overview agent**: one long-lived agent per project that
  holds the whole landscape, answers questions about it, and writes plan documents. It never
  builds a feature and never edits product code. It is the project's chat box. **Level 2, the
  mission**: a bounded, multi-feature effort planned into milestones, owning a set of Level 3
  workers. **Level 3, the task session**: what the board spawns today, one item, fresh context.
  Needs a decision on where the overview agent's tool boundary is enforced (allowed tools vs.
  prompt), and where its plan documents are written.

- [ ] `[ENG]` `[L]` **Missions: make the audit a planned, validated, multi-agent run**
  - created: 2026-09-16
  - source: Cory, 2026-09-16, after reading Factory's Missions docs
  - kind: feature
  Take from Factory's Missions, which are documented behaviour, not a format: a **clarifying
  interview** before any work (probe constraints, refuse to start on one prompt), a plan of
  **features grouped into milestones** that Cory blesses once, a **fresh worker session per
  feature** so no agent carries the whole project, **validation at every milestone** rather than
  inside the worker, and **human-style QA** driving the real UI (Playwright) instead of only unit
  tests. Parallelism stays narrow: within a feature and during validation. `src/audits.ts` and the
  audit-parent records are the seam this grows out of. Their published cost, median 12x the tokens
  of a normal session, is the reason the blessing gate is not optional.

### Readiness at the door

- [ ] `[ENG]` `[M]` **Score a project when it is imported, and offer to fix it**
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
  On import (Finder picker or pasted path), run `@kodus/agent-readiness` (MIT) and show the level,
  the percentage and the failing pillars on the project card. Then offer the remediation Maverick
  actually owns: run the `doc-standard` skill to scaffold and generate the docs, add the tracker
  file if it has none, install the drift gate. The score is not decoration; it is the gate on what
  Maverick will let you launch unattended into that repo.
  - blocked-by: agree the cache and re-score policy (scores go stale)

## 🚧 In Progress

_Nothing. Move an item here only when its session starts._

## 📋 Backlog

- [ ] `[ENG]` `[M]` **Checkbox flips from the board** — tick an item in the UI, write `- [x]` back.
  - created: 2026-09-14
- [ ] `[ENG]` `[M]` **Ship-time `release: next+1` → `next` rewrite**, today a manual edit.
  - created: 2026-09-15
- [ ] `[ENG]` `[L]` **The manager agent** — one agent whose only tools are the console API (boards,
  sessions, spawn, assign, handoffs) and which never touches code. Merges and promotions stay
  Cory's buttons.
  - created: 2026-09-14
- [ ] `[ENG]` `[L]` **Electron shell** — `server.ts` becomes the main process.
  - created: 2026-09-14
- [ ] `[DOC]` `[M]` **Carry-over between related projects** — a fix to the flow, a skill, or a UI
  testing pattern in one repo should not leave the others behind. Unresolved: whether that is a
  Maverick surface (show which repos are behind on a shared skill or standard), an Imbas
  responsibility, or just the plugin version already in `installed_plugins.json`. Decide before
  building anything.
  - created: 2026-09-16
  - source: Cory, 2026-09-16
- [ ] `[ENG]` `[M]` **Support agents other than Claude Code.** `web/providers/` already has the
  shape. Every competitor runs Codex alongside Claude; Maverick reading only one runtime is a
  ceiling, not a position.
  - created: 2026-09-16

## ✅ Recently shipped, pending release

- [x] `[OSS]` **MIT `LICENSE`** — the repo was public with no license, which made it legally
  unusable by anyone who found it. _2026-09-16._
- [x] `[DOC]` **`RULEBOOK.md`** — Maverick is held to the workspace standard it reads for everyone
  else. _2026-09-16._
- [x] `[DOC]` **This checklist** — Maverick now appears in its own project picker. _2026-09-16._
