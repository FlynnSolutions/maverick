---
owner: claude
mode: reference
---
# Data model

Two kinds of data: what Maverick reads from markdown and git (the truth), and what it stores
itself (a small amount of state markdown cannot carry).

## The tracker (read and written, source of truth)

A project's tracker is a markdown file. `src/trackers.ts` parses it; the shape *is* the schema.

- A `## ` heading whose first character is an emoji is a **lane**: `🔥` priority, `🚧`
  in-progress, `📋` (also `🧊`, `🧹`) backlog, `✅` shipped. `## 🗑️ Removed` is hidden.
- A `### ` heading inside a lane is a **group**. Under Priority, a group is a **release**.
- A `- [ ]` bullet is an **item**. Markers: `[ ]` todo, `[~]` in progress, `[x]` done,
  `[!]` deferred, `[-]` dropped.
- Indented `  - key: value` lines under a bullet are **fields**: `source`, `due`, `release`,
  `size`, `kind`, `status`, `owner`, `plan`, `pr`, `links`, `blocked-by`, `mission`, `milestone`,
  `repo`.

Recognised filenames are in `src/projects.ts`: `deliverables/CHECKLIST.md`, `CHECKLIST.md`,
`PUNCHLIST.md`, `TODO.md`, `NEXT_STEPS.md`.

## Records Maverick stores

Types are defined in the named modules; this table is a map, not a duplicate.

| Record | Defined in | Stored at | Key fields |
|---|---|---|---|
| `Project` | `src/projects.ts` | `session-console/projects.json` | `id`, `name`, `path`, `trackers[]` |
| `SessionRecord` | `src/sessions.ts` | `console-sessions/<id>.json` | `role`, `loop`, `exit`, `parent`, `status`, `handoff`, `project`, `mission` |
| `Formation` | `src/formations.ts` | `session-console/` | `name` (phonetic callsign), `lead`, `members[]` |
| `ShipRun` | `src/ships.ts` | `console-sessions/ships/<project>/<version>.json` | `version`, `steps[]` |
| `ShipStep` | `src/ships.ts` | within the run | `prompt`, `status`, `claudeId`, `report`, `artifacts[]` |
| `Mission` | `src/missions.ts` | `console-sessions/missions/<project>/<id>.json` | `status`, `plan`, `repos[]`, `land`, `formation`, `milestones[]` |
| `MissionRepo` | `src/missions.ts` | within the mission | `label`, `path`, `base`, `branch`, `integration`, `landed` |
| `Milestone` | `src/missions.ts` | within the mission | `n`, `title`, `done`, `tasks[]`, `merged`, `mergeSha` |
| `MissionTask` | `src/missions.ts` | within the milestone | `repo`, `status`, `attempts`, `claudeId`, `worktree`, `branch`, `base`, `verdict` |
| release labels | `src/releases.ts` | `session-console/releases.json` | the two planned slots' names and deploy dates only |

`SessionRole` is `driver | develop | audit | plan`; `SessionStatus` is `open | closed |
handed-off`; `StepStatus` is `pending | running | finished | done | failed | skipped`.
`MissionStatus` is `interviewing | planned | flying | blocked | review | closed`; `TaskStatus` is
`pending | flying | built | reviewing | passed | handed-back`.

**A mission's plan is not in its record.** The milestones and tasks live in the tracker as items
carrying `mission` and `milestone`; the record holds the run, and the record's `milestones[]` is
what was parsed from the approved plan document plus what each task's sessions did. If the two
disagree the tracker wins, exactly as everywhere else ([`03-decisions.md`](./03-decisions.md) M7).

**A session record's `mission` names its owner, and that is what keeps it out of the ship's
audit step.** A mission reviews its own work, so `src/ships.ts` skips a develop record that has
one. It is set at dispatch rather than when a verdict exists, so there is no window in which a
Wingman looks like an unowned session.

**A formation is one lead and its flight.** The lead is the session that orchestrates;
`members` are the sessions under it, in the order they were put there.

## Derived, never stored

`Release` (`src/releases.ts`) is computed on every read from the project's changelog
(Keep-a-Changelog shape) plus merged PRs from GitHub, assigned to a version by tag date. Only
the two planned slots' labels are persisted. A version is computed from its contents: a feature
anywhere bumps the minor, fixes alone bump the patch.

## Known limits

- PRs are read from the last 400 merged per repo, so old versions undercount
  (`src/releases.ts`).
- Session status is passed through from Claude Code, not computed here
  (`src/transcript.ts`, `backgroundAgents` in `src/git.ts`).
