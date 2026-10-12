---
owner: claude
mode: explanation
---
# Decisions

An ADR log. Per the doc standard's D26, an entry earns a place here only if **reversing it
would touch more than one part of the system and a real alternative was rejected**, or it is
**safety-load-bearing**. Working practice goes to [`05-conventions.md`](./05-conventions.md);
product theses and scope refusals go to [`../RULEBOOK.md`](../RULEBOOK.md). Entries are
immutable: supersede, never rewrite.

---

## M1 — The markdown trackers are the source of truth; Maverick keeps no store ✅ built

Board state lives in the project's own tracker file. Maverick parses it, and writes each change
back as one line move, committed immediately in that tracker's repo. If the console and the file
disagree, the file wins.

**Rejected:** a database, or any local store of items. **Why:** a board whose state lives in an
app cannot be edited from a session, from a terminal, by another agent, or by hand. Every other
tool in this category owns its board and therefore fences it off from the agents doing the work.
Keeping it in git is what lets a session and a human edit the same list.

**Consequence:** no migrations and no sync, but also no field the markdown cannot carry. Two
named exceptions exist because markdown genuinely cannot hold them: `~/.claude/session-console/`
and `~/.claude/console-sessions/`. Anything new wanting to live there needs a reason beyond
convenience.

## M2 — No dependencies, no build step ✅ built

Node 22.18+ runs the TypeScript directly. `web/` is plain HTML, CSS and JS talking only to
`/api/*`.

**Rejected:** a bundler and a framework. **Why:** the whole app is ~9k lines and single-user; a
toolchain would be most of the maintenance burden for none of the benefit, and `git clone && node
server.ts` is a real feature for anyone who finds the public repo.

**Consequence:** a new dependency is a decision, not a convenience. This has a live cost: generic
agent-readiness scoring marks the repo down for having no linter, formatter or type checker,
since all three arrive as npm packages. Accepting a dev-only dependency for those is an open
question, not a settled refusal.

## M3 — `server.ts` may not assume a browser tab ✅ built

Every route is dispatched from one router in `server.ts`, and nothing there reaches for
browser-only assumptions.

**Why:** it becomes the Electron main process later. Writing it that way from the start costs
nothing; retrofitting it would touch every endpoint.

## M4 — Public and MIT licensed ✅ built

The repo is public at `github.com/FlynnSolutions/maverick` under MIT.

**Rejected:** keeping it private, and a source-available licence. **Why:** the goal is eyes and
use, not revenue. MIT matches the licence of the tools it sits beside, so it composes with them
without friction.

**Consequence:** no client data, no real project paths, and nothing from a `network/` directory
may enter this repo, ever. Screenshots and fixtures use invented projects. This constraint is
safety-load-bearing and is repeated in the rulebook.

## M5 — Three levels of agent, separated by blast radius ◐ design

**Air Boss** holds a whole project, answers questions and writes plan documents, and never edits
product code. **Mission**, run by a **RIO**, plans milestones and dispatches workers. **Wingman**
takes one item, in a worktree, and writes code.

**Safety-load-bearing:** the project level's boundary must be enforced by its allowed-tools list,
not by its prompt. An agent asked politely not to change something will change it the first time
the change looks small.

**Where that stands for a Wingman, 2026-09-16.** The tool list does not do this job at the level
that writes code, and saying it does would be the comfortable answer rather than the true one.
A Wingman must run the repo's tests and builds, so it needs `Bash`; `Bash` is also `git push`,
`git merge` and `gh pr create`. It is deliberately allowed subagents too, since a search across
a large repo is what they are for. So its boundary is **focus, and focus is prose**: own one
task, do not widen it, do not touch another repo, never push or merge, never grade your own
work. `missions.wingmanAgent` names an agent carrying those standing orders so every mission
prompt does not have to repeat them, and the approval gate says whether one is set.

The level where the tool list *is* the boundary is the **CAG**, which writes plan documents and
never needs `Bash` at all. That is the one to enforce properly when it is built.

**Status:** the orchestrator is built; see [M7](#m7--a-missions-plan-is-tracker-items-and-membership-is-a-field--built).
The project level is still designed only. **The names in this entry were superseded on
2026-09-16 by [M9](#m9--the-levels-take-the-carriers-own-names--decided):** the orchestrator is
the **Strike Lead**, the project level is the **CAG**, and **RIO** now means what
`src/audits.ts` has always been. The decision itself, three levels separated by blast radius,
is unchanged. See [`POSITIONING.md`](./POSITIONING.md).

## M6 — Readiness gates an unattended launch ◐ design

Maverick should decline to launch an **unattended** session into a repo whose environment it
cannot verify, and name the missing signal.

**Why:** taken from Factory, whose Missions refuse to run below readiness Level 4. The
interesting part is not the score, it is that the score gates the expensive thing.

**Status:** designed, not built. Scoring at import is the first step.

## M7 — A mission's plan is tracker items, and membership is a field ✅ built

A mission's milestones and tasks are written into the project's tracker as ordinary items, each
carrying `mission: <id>` and `milestone: <n>` (`src/trackers.ts`). Maverick stores only the run —
which background session is on which task, what the reviewer said, which gates opened — at
`~/.claude/console-sessions/missions/<project>/<id>.json`, the shape `ships/` already uses. The
approved plan is also frozen as a document at `deliverables/missions/<id>.md`; that copy is the
artifact of the gate and is never read back as state.

**Rejected: a `###` group, the way a release is a group under Priority.** An item's group is lost
the moment it moves lane, because `applyMove` relocates the block into a target section and its
group there. A mission's tasks move lane constantly while it flies, so a group would silently
shed its members. This is the same reason a release *slot* is a field and not only a group, and
it is covered by a test.

**Rejected: a private store for the plan.** That is [M1](#m1--the-markdown-trackers-are-the-source-of-truth-maverick-keeps-no-store--built)
directly: a plan a session cannot read or edit in the repo is a plan fenced off from the agents
doing the work.

**Consequence:** a mission is visible on the board without the board knowing what a mission is,
survives being hand-edited, and can be dismantled by deleting two field lines. The cost is that a
mission is scattered across lanes once it flies, so gathering it needs the `mission` field rather
than one place to look.

This completes the orchestrator half of [M5](#m5--three-levels-of-agent-separated-by-blast-radius--design).

## M8 — Maverick merges a mission into its own branch, never into main ✅ built

Each Wingman works in a worktree on `mission/<id>-<task>`; a milestone whose tasks all pass is
merged into `mission/<id>` in an integration worktree. A conflict aborts the merge and is
reported as the paths that collided.

**Safety-load-bearing:** the console spawns unattended agents, so the furthest their work can
reach without a person is a branch nothing is built from. Handing that branch to the ship, which
already has Cory in it phase by phase, is what puts it on main.

**Consequence:** a finished mission is a branch to check out and test, not a claim to believe,
which is the whole point of the second gate.

## M9 — The levels take the carrier's own names ✅ decided

Renamed 2026-09-16, before the vocabulary hardened anywhere outside this branch.

| Level | Name | What that person actually is |
|---|---|---|
| project | **CAG** | Commander, Air Group: one per carrier, commands every squadron aboard |
| mission | **Strike Lead** | designated to plan, brief, send and debrief one strike package |
| milestone | *(vacant)* | a division or section lead takes 4 or 2 aircraft; no agent holds one here |
| task | **Wingman** | flies his own jet off the lead |
| review | **RIO** | the back seat of that one jet, calling what he sees |

**Rejected: keeping RIO for the orchestrator** ([M5](#m5--three-levels-of-agent-separated-by-blast-radius--design)).
**Why:** a RIO sits in one back seat, behind one pilot, watching one aircraft. That is a reviewer
of a single Wingman, which is exactly what `src/audits.ts` does and has always done. Using the
name for the thing that plans a whole mission put a per-aircraft role in a package-level seat.

**Rejected: Air Boss for the project level.** **Why:** an Air Boss does not plan anything. He runs
the deck from Pri-Fly and decides what launches and whether the deck is fit. That is
[M6](#m6--readiness-gates-an-unattended-launch--design), the readiness gate, so the name moves
there rather than being retired.

**Rejected: Skipper, and Mission Commander.** Skipper is a squadron CO, a standing command that
overlaps the CAG rather than sitting below it; Mission Commander is the right role but reads as
a job title rather than a callsign. Strike Lead is the per-mission designation and it lands on a
word the model already uses: a formation is one **lead** plus its flight, and a mission makes one.

**Consequence:** the milestone rung is deliberately empty. In the real chain a division lead takes
the four aircraft that launch together, which is what a milestone is; here the Strike Lead
dispatches every task itself. That is either the next agent to build or over-structure, and this
entry does not decide which.

## M10 — A mission bends to the project's git conventions, not the reverse ✅ built

A mission reads `maverick.json` for where worktrees go, what branches are called, what each
repo's work is cut from, and whether it ends in a merge or a pull request
([`06-runbook.md`](./06-runbook.md)). A task names its repo with a `repo:` field, so one mission
can span several and the order they land in is carried by the milestones.

**Rejected: Maverick's own layout everywhere.** **Why:** A project on this machine carries a `worktree.sh` whose own
header says it exists because two contradictory worktree conventions collided there once and
the docs lost to the commands. A tool that reads other people's systems
(`01-architecture.md`) does not get to add a third naming scheme to a repo that has settled on
one. The same argument covers the branch prefix and the base branch.

**Rejected: one branch per mission across all repos.** **Why:** a multi-repo project rarely
shares a base. A contract package may sit on `main` while the services consuming it sit on
`develop`, so a single base would cut half the work from the wrong commit.

**Safety-load-bearing: landing is per repo, and `push` is opt-in by name.** A project here says never self-merge, absolutely and without
exception, so its services end at a pull request and stop. Its contract package is the opposite
case: it is the one source of truth between those services and is meant to be on `main` before
either starts. So `land` is resolved per repo, `push` exists for that case, and a repo
only gets it by being named in the project's own `maverick.json`.

`push` is deliberately the narrowest thing that works: it fast-forwards only, refuses when the
base has moved rather than reconciling it, and never passes `--force` or `--force-with-lease`,
so the remote's own protections decide. The gate draws it as a caution and names the repo and
branch before Cory approves, because it is the only path here that reaches a shared branch
without a second pair of eyes.

`merge` stays the default, and even it only ever merges onto the mission's own branch, never
onto a base ([M8](#m8--maverick-merges-a-mission-into-its-own-branch-never-into-main--built)).

**Consequence:** a repo the plan does not name gets no branch, which matters when a project holds
eleven of them and a mission touches three.

## M11 — The sweep yields to the person, and a collision is the Strike Lead's to answer ✅ built

**Every write carries the revision it was read at.** The sweep holds its copy of a mission
across minutes of `git merge` and `claude --bg`; a write whose revision no longer matches disk
is refused. A person's action retries against the fresh record, because they asked for it. The
sweep drops its pass, because everything it does is idempotent and the next pass sixty seconds
later sees the truth.

**Safety-load-bearing:** without this, pressing *stop this mission* during a sweep lost. The
sweep would finish and write its stale copy back: agents dead, console insisting the mission was
flying, and ninety seconds later a RIO spawned onto a half-written branch. A brake that does not
hold is worse than no brake, because it is believed. There is a test that reproduces it.

**Rejected: holding a lock for the whole pass.** A sweep's pass is minutes long, so the brake
would block behind the thing it is meant to stop.

**A merge conflict goes to the Strike Lead, once.** A conflict is a fact about the plan — two
tasks the lead put in one milestone touched the same lines — so the lead reconciles it in the
integration worktree, keeping both behaviours or aborting and saying why. It never resolves by
taking a side, never touches a base branch, and the sweep judges it by the branch rather than by
what it said about itself. One attempt per milestone: a second is no likelier to work, and a
loop of agents on a collision is nobody's idea of progress.

**Three collisions in one mission stops being a merge problem.** It is a plan putting
overlapping work into one milestone, which is a level above the mission. It is recorded as an
escalation on the record and drawn as such, for Cory now and for the **CAG** when that exists
([M9](#m9--the-levels-take-the-carriers-own-names--decided)): the level that owns the plan is
the one that can fix it.

## M12 — A milestone is walked by a person before the mission lands ✅ built

**The RIO's pass is not the end of a milestone.** The ship has had this from the start: the
test walkthrough is a document a session builds and a person goes through, and the step is done
when the person is through it, not when the agent wrote it. A mission is the same thing one
level down. When a milestone merges, a session is sent into the integration worktree to write
the milestone's walkthrough and commit it on the mission branch; the milestone page hosts the
document; and `closeMission` refuses until every milestone that changed anything is walked or
waived with a reason. Nothing lands and nothing is ticked before that.

**Per milestone, not per task.** Validation in this design happens at milestone boundaries
([M7](#m7--a-missions-plan-is-tracker-items-and-membership-is-a-field--built)): that is where the
work is merged together and where a person can see it as one thing. A walkthrough per task would
be a document per branch, most of them about a piece that only makes sense next to its
neighbours, and three times as many sessions.

**The walkthrough does not block the next milestone.** Wingmen keep flying while the person
sleeps; the gate is at the close, where the work would otherwise leave the mission branches.
What the walkthrough blocks is the landing, which is the only thing that needed blocking.

**Waiving is allowed and recorded.** A builder can fail, or a person can have tested the branch
by hand. The waiver carries its reason on the milestone so the review reads it later. Decided by
Cory 2026-10-06: the gate, the milestone granularity, and that the walkthrough reuses the ship's
hosted panel rather than growing a second one (`web/walkthrough.js`).

## M13 — Planned is a field that names a real file, and the CAG's boundary is its tool list ✅ built

**The rule at the door.** An item in Priority or In Progress carries a `plan:` field that
resolves to a real file; Backlog does not have to. *Planned* means the field is present and the
file exists, not a `status:` word, because a path is verifiable and a word is a claim. The board
badges a roadmap item without one as *unplanned*, the drawer offers *plan it*, and nothing is
spawned on an item that has no plan: a session building from a bullet is how a session builds
the wrong thing well. A mission's tasks are planned by the mission's plan.

**The CAG exists, and its boundary is enforced.** The project level
([M5](#m5--three-levels-of-agent-separated-by-blast-radius--design),
[M9](#m9--the-levels-take-the-carriers-own-names--decided)) now sits down in a terminal for two
jobs: a brainstorm, written as one dated document per conversation under
`deliverables/brainstorms/`, and a plan for one item, written under the tracker's `plans/`
folder with the field set beside the item. It runs as `claude --tools Read,Write,Edit,Grep,Glob`:
no shell, no subagents, no network. That is the CLI refusing, not the prompt asking, which is
what M5 wanted and the only level where it is fully possible.

**Rejected: a rolling IDEAS.md.** A running file gets edited by agents and drifts; one dated
document per conversation does not. Decided by Cory 2026-10-06.

**Not yet: the breakdown.** Reading one brainstorm document and proposing items, each with a
title, kind, size and a call of *plan now* or *backlog*, approved once and written with the
insert-into-group path missions use. It is the same gate shape as a mission plan and is the next
brick; the rule and the CAG had to exist first.

## M14 — Every launched session answers in one shape, and the stream reads as events ✅ built

**One reply format, appended by Maverick, not asked for per prompt.** Every session the console
launches (`claude --bg` through `spawnBackgroundAgent`, the Strike Lead's terminal) carries
`--append-system-prompt` with six sections: **Answer**, **What changed**, **Decisions**,
**Verified**, **Open**, **TL;DR** last. The transcript view parses a reply into those sections
and the pane shows them as labelled blocks, the TL;DR set apart at the bottom. A reply that is
not in the shape is still shown, as prose; the format is a request the page can read, not a
filter. Decided by Cory 2026-10-06: these six, applied to the sessions Maverick spawns.

**Rejected: putting the format into each prompt builder.** Six builders would drift six ways.
The system prompt is the one place every session passes through.

**The stream is a timeline, not a log.** A tool call is classified at read time (edit, test,
run, agent stand out; read, search, web are counted and folded), a fold of tool-only turns says
what it did and how long it took, a reply says how long after the prompt it came, and a session
still working carries a clock ticking since its last event. The classification lives in
`src/transcript-view.ts` beside the parser, so the page draws kinds rather than deciding them.

## M15 — The Electron shell is a wrapper with its own `package.json`; the server stays install-free ✅ decided

Maverick ships as a macOS app people download from a GitHub Release. Electron is the shell, as
the rulebook has said since 2026-09-14, and Electron plus its builder are dependencies and a
build step. [M2](#m2--no-dependencies-no-build-step--built) stands unchanged for everything
that is Maverick: `server.ts`, `src/` and `web/` take no dependency and `git clone && node
server.ts` keeps working with no install.

**The shape.** The shell is `app/`: its own `package.json` with `electron` and
`electron-builder` as dev dependencies, the only `npm install` in the repo, and one file,
`app/main.mjs`, that imports `../server.ts` and opens a window on the port it listens on. The
renderer is `web/` unchanged; nothing in it may start assuming Electron, and the browser tab
stays a first-class way to run it. The app is a window onto the same server: if something
already answers on the port, the window opens on that and starts nothing.

**Rejected: a dependency in the root `package.json`.** A root `node_modules` is what M2 refuses,
and it would make the Electron build a prerequisite of the server it wraps. **Rejected: moving
`server.ts` under `app/`.** The server is the product; the shell is packaging.

**Dev tooling follows the same line.** `lint` is `node --check` over every tracked file, which is
the strongest check the standard library gives and the only one that costs no dependency.
Accepting a linter or a type checker as a dev dependency is still the open question M2 named;
this entry does not close it.

**Consequence:** two lockfiles (the root one is empty by design, so a reader can see that),
`macOS only` on the front page until another platform has been run on, and the release is cut by
a tag, not by hand: a `v*` tag builds the app and attaches it to the Release.

## M16 — A brainstorm reaches the board through one gate, and a CAG proposes rather than writes ✅ built

**The breakdown is the mission's gate shape pointed at a brainstorm.** A CAG reads the
brainstorm document and the tracker and writes one proposal document in a fixed shape under
`deliverables/breakdowns/`; the server parses it into items plus the reasons it cannot be
written yet; the breakdown page shows both; one approve writes the tracker in one commit
through `addGroup` and `addItem`, the path missions already use. The approved document is
stamped and kept as the artifact of the gate, never read back as state.

**The proposer is a read, not a conversation, and it runs in one of Maverick's terminals.** The
brainstorm was the conversation. The proposer carries the CAG's tool list
(`--tools Read,Write,Edit,Grep,Glob`), so it can read two things and write one file, and it
cannot reach the console: the form-filling alternative would have widened the one boundary that
is fully enforced (M5, M13). It was first built as a `claude --bg` job and that failed on the
first real run (2026-10-07): a background job refuses to write into the checkout unless the
session enters a worktree, and a tool-fenced session has no worktree tool, so the proposal
landed in the job's own tmp folder. A terminal has no such guard, and it is the same thing the
brainstorm and the plan already use. The lesson is general: **a fenced CAG cannot be a
background job while it has to write into the checkout.**

**Where items land, decided by Cory 2026-10-06:** *now* to Priority, *backlog* to Backlog,
both under a `### Brainstorm: <topic>` group so the breakdown reads as one thing on the board
the day after; *mission* to a Strike Lead interview opened from the gate, never written twice.
Every item carries `source: brainstorm <file>, <date>` so it points back at the reasoning.

**A roadmap item arrives unplanned, on purpose.** The 2026-10-06 sketch said planned items
carry a `plan:` field, but the rule at the door (M13) is a field that names a real file, and no
plan file exists at breakdown time; a path to nothing is the claim the rule rejects. So a *now*
item lands with no field, wears the badge, and *plan it* is its next verb. The gate says so.

**A consequence to know:** the board treats every group under Priority as a release (ordering,
the deploy-date drawer), so a `Brainstorm:` group gets release verbs, exactly as a `Mission:`
group does today. Living with it until a third kind of Priority group appears.

**Rejected: per-item edits at the gate.** Whole-document approve, as missions have it; the fix
for a wrong proposal is to propose again. One fewer place the page and the file can disagree.
If dropping two bullets turns out to be a conversation too often, that is the next brick.

## M18 — The plan on the mission branch is the ledger ✅ built

Once a mission flies, Maverick writes each task's `status`, `attempt`, `verdict` and `commit`
under it in the plan document and appends every transition and every decision a person made
to a `## Log` section at the end, committed in the integration worktree after every change.
`parsePlan` reads the state back and refuses a state it does not know. The record under
`console-sessions/` keeps only what markdown cannot hold: session ids, worktrees, revisions. A
person, or a Strike Lead that has lost its context, resumes from the file.

**Supersedes** the clause in [M7](#m7--a-missions-plan-is-tracker-items-and-membership-is-a-field--built)
that the approved copy "is never read back as state". M7's rule stands otherwise: the tasks are
tracker items, and membership is a field.

**Why:** on the first overnight mission a subagent's cleanup deleted half the Lead's ledger,
which lived in a shared scratchpad, and recovery worked only because the Lead's context still
held it. State that lives in one agent's head or in a folder other agents clean is state that
is one compaction from gone.

**Safety-load-bearing: the ledger only ever lands on a mission branch.** The commit is guarded
on the checkout and the branch that take it, not on the path: the integration worktree must
exist, be the repo the file is in, and have the mission branch out, or nothing is written and
the record says so. A plan no mission repo holds goes on the first repo's mission branch. The
Lead's copy in the main checkout is never committed to (M8). Its RIO found the first version
committing to `main` twice; the guard and its test came from that.

**Rejected: a state file beside the record.** It would be a second store (M1) and invisible to
the agents working the branch.

**A log line says what it is.** After its stamp a line reads `decision:` (what a person did),
`auto:` (a transition the merge-with-notes rule settled without one), `held:` (a milestone held
for a person, with the time of the hold, written once), or nothing for a plain pass or retry.
The report reads those words, never the prose after them, so rewording a sentence cannot empty
a section.

## M19 — A finding is a blocker or a note, and notes ride ✅ built

A RIO's findings are lines that say what they are: `BLOCKER:` (the task does not pass until it
is fixed) or `NOTE:` (fix if cheap, else carried). Its verdict may be `pass with notes`. A pass,
with or without notes, passes with the notes carried on the task and shown on the result page.
A fail or a mixed goes back out while attempts remain, with the findings verbatim and the rule
that what passed must still pass. Out of retries, a task with no blocker open merges with its
notes carried; one with a blocker open stops, and with it its milestone and everything that
`needs` it. Findings a RIO did not sort are all blockers.

**Why:** on the first mission a task out of retries with one low-severity finding open was
merged by the Lead against the written rule, correctly, and three rounds were spent on
hypotheticals that no current code path reached. The judgement call is now the rule, and the
Wingman is given the RIO's checklist up front so the first review confirms rather than
discovers.

**Also decided here, as parts of the same protocol:** every brief comes from one template
(`src/briefs.ts`), so a lesson learned once reaches every later agent; a task declares what it
`touches` and what it `needs`, an overlap inside a milestone is named at the gate, and a
Wingman's strays outside its paths go to its RIO; the RIO is an installed agent whose tool
list has no Edit or Write (`.claude/agents/rio.md`); and `bin/maverick` gives a mission flown
by hand the same parser and the same briefs.

**Dispatch follows `needs`, not only the milestone boundary** (built the same day, after the
first five). A task with no `needs` starts with its milestone; a task with `needs` starts when
every task it names has passed, wherever that task is, a sibling or an earlier milestone that
has not merged. The milestone still merges as one once all its tasks pass. On the first mission
one straggler on its last retry idled eighteen tasks that did not need it.

**What tasks share is named before any of them starts.** A `## Contracts` section in the plan
lists each type, id, codec, env flag or function one task makes and another uses, with its
owner and its shape; a task that builds on another is warned at the gate when the plan names
nothing between them. The owner writes it first and exactly as declared; every other task is
told the shape, and one flying beside the owner before it exists stubs it in a file of its own,
never at the owner's path. On the first mission
parallel Wingmen invented the shared conventions apart and a reconcile task had to be added.

**Pause, do not end.** `blocked` means a person is needed somewhere, not that everything stops:
the milestone that holds the handed-back task or the unresolved collision waits, and every
other task keeps flying and starting; when nothing is left for a person the mission is simply
flying again. `paused` is a person's call, with a reason the ledger keeps: nothing new is
spawned, what is running finishes and is recorded, and resume picks up where the file says. On
the first mission an expired credential ended the mission at milestone 6 and cut the central
feature, whose own tasks needed none of it. Milestones still merge in order, once sent.

**A hold has a kind, and the kind says what release means.** A milestone is held for a
collision nobody reconciled, a landing that failed, or a proof that failed on the merged tree.
Releasing a collision merges again; releasing a proof runs the proof again on what the person
fixed, so a hand fix never goes in unproved; a landing is released by landing again, because it
pushes. Proofs, landings and walkthroughs are standing jobs of the sweep, not things done only
in the pass that merged, and the proof runs detached so a sweep is never held for it.

**Every spawn claims the record first** (M11 made mechanical): the task, the review, the
reconcile or the walkthrough is written to the record before the agent starts, and a record
that refuses the claim because a person moved the mission ends the pass before any agent is
spawned that nobody owns. One `settle` derives a mission's status and its trouble from the
record, for the sweep and for every button alike. A task that would deploy a stack or own a path
a task in the air already has waits its turn: one deployer per stack in the air, whatever the
milestones say.

**The gate checks the host before the person leaves.** The plan's `## Preflight` section says
what the mission needs: how long it runs, the tools and runtimes, the credentials and secrets
by name, and the steps only a person can do. Maverick checks what a machine can (the tools on
the path, the agents it will spawn, a repo's Node pin against the host, an AWS credential and
whether it outlives the mission, free disk) and shows the rest marked as the person's to
confirm; a missing tool or agent refuses approval, everything else is theirs to settle by
approving. `bin/maverick preflight` prints the same checks. On the first mission Node 22 met a
pin of 24, `timeout` was missing, a credential expired mid-mission and a real sign-in was never
verified, each found by an agent at the wrong hour.

**The report is generated, not written.** At close, and on the result page at any time, the
report comes from the record, the ledger and the RIOs' own findings, in fixed sections: the
decisions made without the person, theirs, what passed and what rode along with it, what is
handed back, what is unfinished, what no RIO could verify, the notes carried, the files changed
outside what a task owned, the held milestones, what Maverick does not record, and the findings
unedited. It is committed beside the ledger on the mission branch. On the first mission the
interim report missed three incidents and one line claimed an audit that had not run; a report
the flying agent writes about itself is a self-report, and the RIO rule applies to it too.

**Shared environments are the merged branch's, and a merge is proved.** A project names in
`maverick.json` the environments only the merged mission branch may deploy to (`shared`) and a
`proof` command; a task that says it deploys a shared environment is refused at the gate, two
tasks deploying one stack in one milestone are refused, each Wingman is told what it alone
deploys and that anything it makes for a test is named with its task id and deleted by that
test, and after every milestone merges the proof runs on the merged tree and a failure holds
the milestone. The Strike Lead sent in on a collision keeps both sides, including a rule or a
test one side added, and writes no product code. On the first mission the shared dev URL ran
an unmerged task branch twice, two deployers flipped one knob, a lint rule was dropped at a
merge, and the Lead's unreviewed wiring broke tests within minutes.
