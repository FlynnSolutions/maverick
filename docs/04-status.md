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

## What does not

- **Agent readiness: Level 1, 6%** (`npx @kodus/agent-readiness . --ci --no-web`, 2026-09-16).
  Eight criteria short of Level 2. No linter, formatter, type checker, tests, or CI.
- **A known banding defect**: the client helper that decides a session is finished counts
  `blocked`, while the "Needs you" rack also claims `blocked`, so a blocked session renders in
  both. Visible in `web/command.js`; not reproducible live because the registry currently has no
  blocked sessions. Recorded in `HANDOFF.md`.
- **Single agent runtime.** Only Claude Code is read. `web/providers/` has the shape for more.
- No checkbox flips from the board; no ship-time `release: next+1` rewrite; no Electron shell.

## What is next

[`../deliverables/CHECKLIST.md`](../deliverables/CHECKLIST.md) is the live list. Its Priority
lane is, in order: clear readiness Level 2, make the public repo read like one, the three-level
agent model, the RIO, and scoring a project at import.
