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
| `Mission` | `src/missions.ts` | `console-sessions/missions/<project>/<id>.json` | `status`, `plan`, `repos[]`, `land`, `formation`, `milestones[]`, `contracts[]`, `requirements[]` |
| `MissionRepo` | `src/missions.ts` | within the mission | `label`, `path`, `base`, `branch`, `integration`, `landed` |
| `Milestone` | `src/missions.ts` | within the mission | `n`, `title`, `done`, `tasks[]`, `merged`, `mergeShas`, `walkthrough` |
| `MilestoneWalkthrough` | `src/missions.ts` | within the milestone | `claudeId`, `doc`, `progress`, `failed`, `waived` |
| `MissionTask` | `src/missions.ts` | within the milestone | `repo`, `status`, `attempts`, `claudeId`, `worktree`, `branch`, `base`, `verdict`, `head`, `touches[]`, `needs[]`, `strayed[]`, `carried[]` |
| release labels | `src/releases.ts` | `session-console/releases.json` | the two planned slots' names and deploy dates only |
| `Breakdown` | `src/breakdowns.ts` | parsed from `deliverables/breakdowns/<brainstorm>.md`, never stored | `topic`, `items[]` (title, kind, size, call), `already[]`, `problems[]` |

`SessionRole` is `driver | develop | audit | plan`; `SessionStatus` is `open | closed |
handed-off`; `StepStatus` is `pending | running | finished | done | failed | skipped`.
`MissionStatus` is `interviewing | planned | flying | blocked | paused | review | closed | abandoned`;
`TaskStatus` is `pending | flying | built | reviewing | passed | handed-back`; a RIO's `Verdict`
is `pass | pass with notes | fail | mixed` (M19).

**A mission's plan is not in its record.** The milestones and tasks live in the tracker as items
carrying `mission` and `milestone`; the record holds the run, and the record's `milestones[]` is
what was parsed from the approved plan document plus what each task's sessions did. If the two
disagree the tracker wins, exactly as everywhere else ([`03-decisions.md`](./03-decisions.md) M7).

**The plan on the mission branch is the ledger** (M18): where every task stands is written under
it as fields, and a `## Log` ends it. The record keeps what markdown cannot hold: session ids,
worktrees, the revision.

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

**What a mission shows its person is derived from the record and the ledger on every read**
(M20), never stored, so the page, the inbox and the notification cannot disagree:

| Type | Defined in | Shape |
|---|---|---|
| `Question` | `src/questions.ts` | `id`, `kind` (`handed-back`, `collision`, `landing`, `proof`, `plan`, `paused`, `gate`), `title`, `body`, `at`, `taskId?`, `milestone?`, `answers[]` |
| `FeedEntry` | `src/feed.ts` | `at`, `kind` (`thought`, `action`, `question`, `response`, `error`), `who` (`you`, `Maverick`, `Wingman`, `RIO`, `Strike Lead`), `text`, `milestone?`, `taskId?` |
| `StatusWord` | `src/questions.ts` | `working`, `waiting for you`, `error`, `done` |
| `MissionView` | `src/missions.ts` | the `Mission` record plus `findings`, `diffstat`, `walk`, `word`, `questions`, `feed`: the JSON of `GET /api/missions/:id` and of each stream event |
| `WorkspaceMission` | `src/missions.ts` | the `Mission` record plus `word`, `questions` and `diffstat` (one `+N −M` line over its merged tasks), as `GET /api/workspace?project=` lists it |

A question's `id` is stable while the thing it asks about is open: `task:<task id>`,
`hold:<milestone>`, `escalation`, `paused`, `gate`. Each answer is
`{ label, method: "POST", path, body?, primary? }`, where `path` is relative to
`/api/missions/<id>/` and `body` names the keys the page must supply (a `note`, say); exactly one
answer is primary. Questions come out oldest first, and an ended mission asks none.

A feed entry is one line of the ledger's `## Log`, in the ledger's order. A line `src/feed.ts`
cannot read is still an entry, a `thought` carrying the raw line, never dropped.

`word` is `wordFor(mission, questions)`: `waiting for you` exactly when a question is open;
otherwise `statusWord`'s answer, read as `done` in review or closed and `working` elsewhere when
it would have said `waiting for you` with nothing to answer (Cory's call on m1-t1). `error` is
for what no answer settles: a report or ledger that could not be written, a proof runner killed
by a signal.

## Known limits

- PRs are read from the last 400 merged per repo, so old versions undercount
  (`src/releases.ts`).
- Session status is passed through from Claude Code, not computed here
  (`src/transcript.ts`, `backgroundAgents` in `src/git.ts`).
