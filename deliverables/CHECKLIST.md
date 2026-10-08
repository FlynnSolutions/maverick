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
  - status: on `feat/electron-shell` (2026-10-07): `.editorconfig`, `.nvmrc`, `lint`, CI, CONTRIBUTING, SECURITY; linter and formatter still open (M15)

- [ ] `[OSS]` `[S]` **The public repo reads like one**
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: chore
  `LICENSE` landed 2026-09-16. Still missing: `CONTRIBUTING.md`, `SECURITY.md`, issue and PR
  templates under `.github/`, a screenshot or GIF in the README, and a one-line description of who
  this is for. Do not post about it before this is done.
  - status: on `feat/electron-shell` (2026-10-07): all of it, pending the draft PR

### The level model

- [ ] `[ENG]` `[L]` **CAG, Strike Lead, Wingman: three levels of agent per project**
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
  The reframe, named 2026-09-16; the names settled the same day (decisions M9). **CAG (L1)**: one long-lived agent per project that holds
  the whole landscape, answers questions about it, and writes plan documents. Never builds a
  feature, never edits product code. It is the project's chat box. **Mission (L2), run by a
  Strike Lead**: a bounded multi-feature effort planned into milestones, dispatching and validating
  workers. **Wingman (L3)**: one item off the board, fresh context, a worktree, a diff, which is
  what Maverick spawns today. The levels are blast radius, not seniority.
  Open: where the CAG's tool boundary is enforced (allowed-tools list, not prompt) and where
  its plan documents are written.

- [~] `[ENG]` `[L]` **The Strike Lead: grow the audit from a validator into an orchestrator**
  - created: 2026-09-16
  - source: Cory, 2026-09-16, after reading Factory's Missions docs
  - kind: feature
  - status: built on `feat/rio`, not merged. `src/missions.ts`, `web/mission.*`, the first tests.
  - plan: docs/03-decisions.md M7 and M8
  Take from Factory's Missions, which are documented behaviour, not a format: a **clarifying
  interview** before any work (probe constraints, refuse to start on one prompt), a plan of
  **features grouped into milestones** that Cory blesses once, a **fresh worker session per
  feature** so no agent carries the whole project, **validation at every milestone** rather than
  inside the worker, and **human-style QA** driving the real UI (Playwright) instead of only unit
  tests. Parallelism stays narrow: within a feature and during validation. `src/audits.ts` and the
  audit-parent records are the seam this grows out of. Their published cost, median 12x the tokens
  of a normal session, is the reason the blessing gate is not optional.
  **The gap, named 2026-09-16:** what `audits.ts` does today is the *validator half only*, a verdict
  and findings on a session that already finished. The Strike Lead is the missing half in front of it: the
  interview, the milestone plan, the dispatch. Build that, then rename. Renaming first would be
  exactly the drift the positioning note warns about.
  **Built 2026-09-16 on `feat/rio`,** verified end to end against a fixture project with real
  agents: interview, gate, tracker write, dispatch into worktrees, a separate reviewer's verdict,
  the merge into `mission/<id>`, and the close that ticks the items. Left open: the CAG, a
  mission across more than one repo, and human-style QA driving the real UI (Playwright is a
  dependency, so it is a decision rather than a step).

- [ ] `[ENG]` `[L]` **Brainstorm, breakdown, plan: the phases before an item reaches the board**
  - created: 2026-10-06
  - source: Cory, 2026-10-06
  - kind: feature
  Three phases sit in front of the checklist today and only the last is formal. **Brainstorm**: one
  conversation, many ideas, no structure, written as one dated markdown doc per conversation at
  `deliverables/brainstorms/<date>-<topic>.md`. This is the CAG's first real job (decisions M5,
  M9), and the one level whose tool boundary is enforceable by the tool list: Read and Write under
  `deliverables/`, edit the tracker, no `Bash`. Session role `plan` already exists for the record.
  **Breakdown**: a step that reads one brainstorm doc and proposes items, each with a title, `kind`,
  `size`, and a call of *plan now* or *backlog*. On approval it writes them into the tracker with
  the insert-into-group path missions already use: planned items carry
  `plan: deliverables/plans/<slug>.md` and land in Priority; the rest land in Backlog under a `###`
  group named after the brainstorm. A feature that is mission-sized is handed to a Strike Lead
  interview rather than planned twice. **The rule**: Priority and In Progress require a `plan:`
  field that resolves to a real file; Backlog does not. *Planned* means the field is present and
  the file exists, not a `status:` word, because a path is verifiable and a word is a claim. The
  board shows an *unplanned* badge on any roadmap or in-progress item missing one, offers a
  *plan it* verb that opens a plan session, and the drawer refuses to spawn a Wingman on an
  unplanned item. Backlog stays free-form, organised by theme groups, which the parser already
  reads in any lane. This formalises what is already half there: the `plan` field, the *note
  only, not scoped* marker on six backlog items, and Realtime's `deliverables/plans/`. No new
  store; every artifact is markdown in the repo (M1).
  **Decided by Cory 2026-10-06:** one dated brainstorm file per conversation, not a rolling
  `IDEAS.md`, since a running file gets edited by agents and drifts; and *planned* is the
  presence of a resolving `plan:` field, not a new status value.

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

- [~] `[ENG]` `[L]` **Electron shell, and Maverick posted as a free, open-source download** —
  `server.ts` becomes the main process. **Cory, 2026-10-07:** make it an app people can download
  from GitHub, open source and free, with one completely honest statement on the front about
  why it was built and who built it; the reality of it is the marketing of it. The brief and
  his statement are in the plan.
  **Built 2026-10-07 on `feat/electron-shell`:** `app/` (Electron 44, its own `package.json`,
  one `main.mjs` that imports `server.ts`), the Release workflow on a `v*` tag, the README with
  the statement up front, and the public-repo files. Decisions M15. Packaged app run on this Mac;
  not yet downloaded from a Release.
  - created: 2026-09-14
  - plan: plans/maverick-public-release-2026-10-07.md
  - status: draft PR #5 open, not merged
  - pr: https://github.com/FlynnSolutions/maverick/pull/5

## 📋 Backlog

- [ ] `[ENG]` `[M]` **Checkbox flips from the board** — tick an item in the UI, write `- [x]` back.
  - created: 2026-09-14
- [ ] `[ENG]` `[M]` **Ship-time `release: next+1` → `next` rewrite**, today a manual edit.
  - created: 2026-09-15
- [ ] `[ENG]` `[L]` **The manager agent** — one agent whose only tools are the console API (boards,
  sessions, spawn, assign, handoffs) and which never touches code. Merges and promotions stay
  Cory's buttons.
  - created: 2026-09-14
- [ ] `[ENG]` `[M]` **"Who is behind" on the project picker** — a fix to the flow, a skill, or a
  UI-testing pattern in one repo should not leave the others behind. Decided 2026-09-16: do **not**
  build a propagation engine. Skills already propagate (one versioned `flynn-kit` plugin at user
  scope), standards already propagate (one `WORKSPACE.md`, one `check.py`). What is missing is
  visibility. Show per project: doc-standard governed or not, `RULEBOOK.md` present and newer than
  the last workspace change, readiness level, installed plugin version vs. latest. The picker
  already enumerates the repos and already has somewhere to put a badge.
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
- [ ] `[ENG]` `[M]` **Highlights in the ship / session review walkthrough** — _note only, not
  scoped._ The walkthrough already deep-links to the exact page under test and fills it with
  realistic data. Next step is showing the reviewer **where to look**: a highlight that flashes on
  the element and fades, the same device the Realtime tutorial uses. Lift the pattern from
  Realtime's tutorial rather than inventing one. Open: how a walkthrough step names its target
  (selector, test id, or a coordinate the QA pass captured), and whether the highlight is driven by
  the walkthrough document or by the session that wrote it.
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
- [ ] `[ENG]` `[M]` **Support agents other than Claude Code.** `web/providers/` already has the
  shape. Every competitor runs Codex alongside Claude; Maverick reading only one runtime is a
  ceiling, not a position.
  - created: 2026-09-16

- [~] `[ENG]` `[L]` **Planned and recurring ship days on the calendar.** The calendar today only
  plots item deadlines (`due:`) and releases already computed from the changelog. It cannot hold a
  *future* ship. Add a ship day as its own event: pick a date on the calendar, and set a recurrence
  (weekly, every other week, whatever cadence the operator picks) so the next ones are already
  there. Needs the interface (place one, set the cadence, move one, cancel one) and the backing
  record. **Decided by Cory 2026-09-17:** a schedule is the first thing the markdown trackers
  genuinely cannot hold, so it earns a new named exception, a ship dates tracker and schedule under
  `~/.claude/session-console/`. Still not a database. Notify on the morning of: "ship day". Other
  recurring notifications should hang off the same mechanism.
  **Why, from Cory 2026-09-17, mid-ship:** three weeks between ships and the pile of untested
  changes is the part that hurts. Testing is the tedious step and there is no removing it, but a
  weekly or biweekly cadence keeps each batch small enough to stomach. The cadence is the product
  feature; the calendar is where it becomes visible.
  **What it sets up (not now):** once a ship day is a scheduled event, work can fire *on* it.
  Auto-generate the session review for the batch when ship day arrives, and so on. Reason enough to
  model it as a real scheduled event rather than a reminder string.
  **Built 2026-09-18 on `feat/ship-schedule`:** `src/ship-schedule.ts` (the cadence, one-offs,
  skips, moves and shipped history, keyed to the day the cadence generated so a pushed-back day
  still knows where it was meant to be), three `/api/ship-schedule` routes, ship days on the
  calendar with drag-to-move and a drawer, the cadence control, and the ship-day banner above
  every view. Ten tests in `test/ship-schedule.test.ts`; verified in the browser against a seeded
  schedule. **Left open:** an OS-level notification, which a browser tab cannot do when it is
  closed, so it properly belongs to the Electron shell.
  - created: 2026-09-17
  - source: Cory, 2026-09-17, while shipping Realtime
  - kind: feature
  - status: merged to main 2026-10-07 (#1), pending release

- [ ] `[ENG]` `[S]` **Gamify the ship.** _Note only, not scoped._ Marking a ship complete should
  feel like something: "mission complete", with a plane getting up into the sky. Pushing a ship day
  back is the opposite: mission failed, the plane crashes and burns. Fits the callsign language the
  console already speaks (Maverick, Wingman, Strike Lead) and gives the cadence above teeth, since
  a slipped ship day should cost something visible. Open: what the animation actually is, and
  whether anything is tracked across ships (a streak) or it is purely per-event.
  - created: 2026-09-17
  - source: Cory, 2026-09-17
  - kind: feature

- [ ] `[ENG]` `[M]` **Fire an overnight build session from Maverick.** _Note only, not scoped._
  Tonight's run (2026-10-06) was set up by hand in a terminal: a queue of checklist items in
  priority order, a stop line (push and open draft PRs, never merge), and `caffeinate` to keep
  the machine awake. All of that is a form Maverick could show: pick the items, pick the stop
  line, press go, read the PRs in the morning. The Strike Lead already dispatches background
  agents; this is the same dispatch pointed at a queue instead of a plan, and the morning read is
  the session review that already exists.
  - created: 2026-10-06
  - source: Cory, 2026-10-06, going to bed
  - kind: feature

- [~] `[ENG]` `[M]` **A gated walkthrough on every mission task, the way the ship has one.** _Note
  only, not scoped._ The ship page already hosts a walkthrough document inside a step and marks the
  step done only when the human has been through it (`src/ships.ts`, the `walkthrough` step). The
  `/develop` skill now produces the same kind of walkthrough per feature. A mission is a pile of
  smaller PRs under one Strike Lead, and today a task goes `built → reviewing → passed` on the
  RIO's verdict alone; nobody walks it. Give each task (or each milestone, to be decided) the same
  hosted walkthrough and the same gate: the task is not `passed` until the walkthrough is answered,
  and the mission page shows where each one stands. Reuse the ship page's walkthrough panel and the
  `walkthrough` record on the step rather than inventing a second shape. Open: whether the Wingman
  writes the walkthrough as part of its task or the Strike Lead commissions it after the RIO passes;
  and per task vs. per milestone (per milestone matches "validation at every milestone" above).
  **Built 2026-10-06, merged 2026-10-07 (#2):** per milestone. At merge the sweep sends a session
  into the integration worktree to write the milestone's walkthrough on the mission branch; the
  milestone page hosts it through the panel lifted out of the ship page (`web/walkthrough.js`);
  `closeMission` refuses until every milestone that changed anything is walked or waived with a
  reason. The next milestone is not held; only the landing is. Decisions M12. Verified under test
  and with the page served, not yet against a live mission with real agents.
  - created: 2026-09-24
  - source: Cory, 2026-09-24
  - kind: feature
  - status: merged to main 2026-10-07 (#2), pending release

- [ ] `[ENG]` `[M]` **One response format from every agent, parsed and shown as sections.** _Note
  only, not scoped; the section list is still being decided._ Every reply Maverick reads back from
  an agent should arrive in one fixed, parseable shape, and the console should render it as
  labelled sections you can scan and skip rather than as a wall of prose. Sections named so far:
  **what changed**, **decisions** (the call, what it was chosen over, how it is set up, briefly),
  and a **TL;DR at the very bottom**. Candidates to settle: **verified** (what was actually run and
  what was not), **open** (questions, assumptions, blockers), **next**. Four to five short blocks,
  not an essay. Enforced where Maverick already writes the prompt (Wingman, RIO, Strike Lead, ship
  steps) and rendered by the transcript view, which already splits replies into events
  (`src/transcript-view.ts`). Sits underneath the event timeline item below: a structured reply is
  the last event of a turn.
  - created: 2026-09-24
  - source: Cory, 2026-09-24
  - kind: feature

- [ ] `[ENG]` `[M]` **The live stream as a timeline of events that stand out, with a running
  clock.** _Note only, not scoped._ Watching a session today is watching Claude Code's own stream:
  everything scrolls past at the same weight. Wanted: a broader, simplified view of the same
  transcript where the things that matter are distinct events you can spot at a glance, a decision,
  a change to a file, a test run and its result, a question waiting on you, and each running thing
  shows a live timer for how long it has been going. Quick to review after the fact for exactly
  what happened, without reading the whole transcript. `src/transcript-view.ts` already turns the
  jsonl into events; this is the classification and the UI on top. Pairs with the response format
  above.
  - created: 2026-09-24
  - source: Cory, 2026-09-24
  - kind: feature

## ✅ Recently shipped, pending release

- [x] `[OSS]` **MIT `LICENSE`** — the repo was public with no license, which made it legally
  unusable by anyone who found it. _2026-09-16._
- [x] `[DOC]` **`RULEBOOK.md`** — Maverick is held to the workspace standard it reads for everyone
  else. _2026-09-16._
- [x] `[DOC]` **This checklist** — Maverick now appears in its own project picker. _2026-09-16._
