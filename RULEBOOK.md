# Maverick Rulebook

Follows the global Workspace Standard at `~/.claude/WORKSPACE.md`. This file adds only what
is specific to Maverick.

**What this repo is:** the pilot. A single-user, local-first console over the projects on this
machine: the roadmap read from each project's markdown trackers, the Claude sessions running
under it, the releases, and the ship. Owned by Flynn Solutions. **Public and MIT-licensed** at
`github.com/FlynnSolutions/maverick`, which makes it the first repo here that strangers read.

## Rules

- **The markdown trackers are the source of truth.** The console reads them and writes each
  change back as one line move, committed immediately in the tracker's own repo. Maverick keeps
  no store of its own for anything a tracker can hold. If the console and the file disagree, the
  file wins. Do not add a database.
- **The exceptions are named and small**: `~/.claude/session-console/` (project registry, release
  labels, access key, usage cache) and `~/.claude/console-sessions/` (session and ship records).
  Anything new that wants to live there needs a reason that isn't "it was easier".
- **No dependencies, no build step.** Node 22.18+ runs the TypeScript directly; `web/` is plain
  HTML/CSS/JS talking only to `/api/*`. A new dependency is a decision, not a convenience.
- **Nothing machine-specific in the code.** Paths and ports resolve through `src/config.ts`
  (`SESSION_CONSOLE_*` env, then defaults). No literal `~/...` or account values.
- **`server.ts` becomes the Electron main process later.** Nothing in it may assume a browser tab.
- **Maverick is held to its own bar.** It is a project in its own picker: it has this rulebook and
  `deliverables/CHECKLIST.md`, and its agent-readiness score is expected to move, not sit.

## Public repo

- Issues and PRs come from outside. Keep `README.md` true; it is the only thing most readers see.
- Nothing in this repo may contain client data, real project paths, or anything from `network/`.
  Screenshots and fixtures use invented projects.
- Commits here are read by strangers. The existing voice (lowercase, plain, no ceremony) stands.
