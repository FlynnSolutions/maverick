---
owner: auto
mode: reference
---
# Status

> Owner `auto`: this slot is meant to be regenerated from git and the tracker rather than
> hand-written. **No generator exists yet**, so the numbers below were taken by hand on
> 2026-09-16 and will go stale. Writing that generator is itself an open item.

## Where the code is

- Branch `main`, 68 commits, last `fe14188` on 2026-09-16.
- ~9,100 lines across `server.ts`, 20 `src/` modules and `web/`.
- Runs with `node server.ts`; no build, no dependencies.

## What works

The workspace rack with strips grouped by urgency; formations (lead plus flight, phonetic
callsigns); the roadmap board over the project's markdown trackers with drag to sequence,
move and plan into a release; the calendar; releases computed from the changelog and merged
PRs; the ship wizard driving the project's own `SHIP_WORKFLOW.md` phase by phase with saved,
resumable state; embedded terminals; audit parents; per-project theming from `maverick.json`.

**Missions, added 2026-09-16.** Opened from the Missions rack at the top of the workspace. A
Strike Lead interviews in an embedded terminal and writes a plan;
nothing spawns until Cory approves it; approval writes the plan into the tracker as items and
dispatches one Wingman per task in its own worktree; a RIO judges each
finished Wingman and a fail hands the task back twice before it becomes Cory's; a passing
milestone merges into `mission/<id>`, never main. Verified end to end against a fixture project
with real agents on 2026-09-16: plan, dispatch, review verdict, merge, close and tick.

**Mission protocol v2, 2026-10-09** (M18, M19), built as five bricks each reviewed by an
independent RIO before the next; every brick failed its first review and was fixed. Dispatch
by `needs` and the contracts section followed. Not yet: the preflight, pause-not-end, the
shared-environment rules, the report sections.

## What does not

- **Agent readiness: Level 1, 60%** (`npx @kodus/agent-readiness . --ci --no-web`, 2026-10-07; 6% on
  2026-09-16). Still short of Level 2, which needs eight of ten named criteria: five pass (tests, a
  test script, CONTRIBUTING, `.nvmrc`, CI), and the cheapest of the five left are a linter, a
  formatter and a `.env.example`. The first two are a dev dependency, which is a decision (M2,
  M15), not a file. No type checker.
- **A known banding defect**: the client helper that decides a session is finished counts
  `blocked`, while the "Needs you" rack also claims `blocked`, so a blocked session renders in
  both. Visible in `web/command.js`; not reproducible live because the registry currently has no
  blocked sessions. Recorded in `HANDOFF.md`.
- **The CAG.** The project level of the model is still designed only; only the mission level is
  built. The Air Boss, which is now the readiness gate rather than a level, is not built either
  (M6, M9).
- **A mission is one repo.** It merges into the root repo's branch, so a multi-repo project
  gets a mission only on its root.
- **Single agent runtime.** Only Claude Code is read. `web/providers/` has the shape for more.
- No checkbox flips from the board; no ship-time `release: next+1` rewrite.
- **The Electron shell exists (2026-10-07, `app/`)** and has been run on one machine, an Apple
  silicon Mac. It is built unsigned, for arm64 only, by the Release workflow on a `v*` tag. No
  Windows or Linux build, no auto-update, no OS notification yet.

## What is next

[`../deliverables/CHECKLIST.md`](../deliverables/CHECKLIST.md) is the live list. Its Priority
lane is, in order: clear readiness Level 2, make the public repo read like one, the three-level
agent model, the Strike Lead, and scoring a project at import.
