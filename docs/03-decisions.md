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
*Amended by [M28](#m28-a-milestone-is-a-foundation-and-it-is-walked-before-anything-builds-on-it--built):
the walkthrough now blocks the next milestone too.*

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

## M20: The mission page has four anchors, and the workspace is the inbox ✅ built

**The mission page has four fixed anchors** in a left rail, the same before, during and after
the flight: The ask, Plan, Progress, Result. Above them the mission's status is one of four
words: `working`, `waiting for you`, `error`, `done`. The page updates from a server stream and
each section patches itself in place, so an open session or a half-typed note survives an
update; it never rebuilds itself.

**A question is a feed entry, answered in place.** Everything waiting on a person (a handed-back
task, a held milestone, an escalation, a pause, the plan at the gate) is a `Question` with its
answers as buttons and a note field where an answer needs one. It is pinned at the top of
Progress, repeated as a strip in the workspace, and pushed as a macOS notification by the app.
Both surfaces post the same routes and offer only the answers the server will take. There is no
browser prompt anywhere.

**The workspace is the inbox**, and the page the app opens on. Four groups, top to bottom,
always in this order: Needs you, Working, Ready to review, Done. A row is a session, a task or a
mission, with a lamp and its diff stats.

**A reply box to the Strike Lead** sits at the bottom of Progress: one line, to pause and say
what you see. It lands in the ledger as a `decision:` line (M18), and is typed into the Strike
Lead's terminal when that terminal is still open.

**The word follows the questions** (Cory's call on m1-t1). A mission with an open question is
`waiting for you`; one with none never is, whatever escalation it once had, and reads `done` in
review or closed and `working` otherwise. `error` is kept for what no answer settles: a report
or ledger that could not be written, or a proof runner that was killed.

**Prior art.** Every shipping agent product has converged on this page, read on 2026-10-13:
Devin's four anchors (Task, Plan, PR, Summary), Jules's plan as steps then an activity feed,
Linear's typed feed (thought, action, elicitation, response, error) and its four statuses,
Superset's and Conductor's diff-first review and In progress / Ready for review grouping,
Factory Missions' pause-and-tell-the-orchestrator, and Claude Code on the web keeping a question
answerable after the agent goes idle. The record, with links, is
`deliverables/plans/mission-ui-2026-10-13.md`; the mockups are in `.ui-design/mockups/`.

**Why:** flying the first fixture mission, Cory could not tell what a milestone was, what a
task was for, what was running, or where a question from an agent was waiting. The page was
separate, polled every eight seconds and rebuilt itself; every question was a `window.prompt`;
the workspace knew a mission only as a row.

**Rejected: Factory's three-pane Mission Control as a page, and the thread as the whole page.**
Four layouts were drawn on one invented mission (`.ui-design/mockups/options.html`); the inbox
in front of the four anchors, with the thread's reply box, was chosen. If Mission Control is ever
wanted, it is what Progress looks like while a mission flies.

**The app's poll sweeps** (Cory's call, 2026-10-14). The notification polls
`GET /api/workspace?project=` every 15 s, and that route sweeps the project's missions before it
answers, so while the app is open missions move every 15 s rather than every 60 s. It stands.

**Not decided here:** the palette (a variants round of its own) and the map view.

## M21: A finding carries its structure, the Result is triage, and the summary only reads ✅ built

**A finding says what it is at the source.** The RIO writes every finding as one line,
`KIND(area, severity): headline. detail`: KIND is `BLOCKER`, `NOTE` or `UNVERIFIED`; the area is
a path or a plain name; the severity is `fix` (must change before merge), `ship` (fine to merge as
is) or `check` (a claim nobody could verify); the headline is one sentence a person who will not
open the code can act on, and the detail is the evidence. `rioBrief` says so in one line with an
example. `findingsOf` still only sorts by kind (M19); `parseFinding` (`src/findings.ts`) turns a
line into a `Finding`. The old `KIND: prose` and bare prose are still read, in area `general`,
with the kind's severity (a blocker is `fix`, an unverified claim `check`, a note `ship`) and the
first sentence as the headline, so a mission flown before this reads the same way. A finding's key
is its task id and the first 8 hex of the sha1 of its line, stable across views.

**The Result section is triage, not a list.** Three buckets in a fixed order, Fix before merge,
Unverified, Fine to ship, each with its count, only the first open; inside each, findings are
grouped by area, a chip and the headline on the row, the detail folded. A finding whose area is
a path also puts its chip beside that file's row in the merged diff, linking back to it. The rail's Result badge
counts what is left to fix, `<n> to fix`, not how many notes there are. The view derives the
readings from the carried lines and the findings files on every read (`MissionView.readings`);
nothing about a finding is stored but the mark a person put on it.

**Read and later are a person's marks, and later writes the checklist.** Each finding has a
`read` checkbox and a `later` button, posted to the readings route and kept on the task
(`MissionTask.readings`, by key). `later` also appends one backlog line to the project's first
tracker, committed the way the board commits, and says so in the ledger; a second click never
writes the line twice. A mark is final: the route takes no unmark.

**The summary is a read-only pass over the record.** `summarize` spawns one session under the RIO
agent and its tool list, with no Edit or Write, briefed with the mission's report and its
readings in triage order. It writes three bullets to `<record dir>/<id>-summary.md` and nothing
else; the sweep reads the file into `Mission.summary` once the session is over, or records why it
failed. The page shows the bullets under `What I must read`, first in Result. It is refused
before anything has merged and while one is already running.

**Why:** what a mission left for Cory to read was a wall of prose, every RIO note and unverified
claim printed verbatim under its task, and he does not usually open the code. Cory's call on
2026-10-14 was six changes, all of them: structure at the source, triage, grouping by area,
marks that mean something, the note beside the files it is about, and a pass that asks the record.

**Rejected: the page guessing structure from prose.** A page that infers severity from wording
reads the same note two ways on two days; the RIO knows what it meant, so it writes it down.
**Rejected: keeping a list of later items in Maverick.** That is a second store (M1); the
tracker already is the list.

**Not decided here:** how a RIO judges (unchanged from M19), the palette, and the map.

## M22: The ledger says how many, Progress is one card per task, and the page is one column ✅ built

**The ledger says how many, and the record keeps the notes.** A task that passes with notes
writes `<stamp> <taskId> <title>: reviewing to passed (RIO: <verdict>) with <N> notes carried`,
then `, <M> unverified` when any carried line is an unverified claim, and never the notes
themselves. They stay on `MissionTask.carried` and in the findings file, where the report and
the Result already read them (M21). A decision line keeps the person's full note, because it is
their words. `feedOf` puts the numbers on the entry as `FeedEntry.counts`, and a hand-back by the
review rule gives its `blockers` from the `N blocker(s) open` phrase. An older ledger's trailing
`[carried: ...]` block is still read: it is cut from the entry's text and counted, from the
record's `task.carried` when it has them, so a mission flown before this reads the same way.

**Progress is one card per task, with its attempts.** `MissionView.moves` is one `Move` per task
per attempt, read off the feed: the stamps of its launch, hand-off, review and end, how it ended
(`passed`, `handed-back`, or `retry` when the next launch took over), and the verdict and counts
of the line that ended it. Progress draws the open questions pinned at the top, then one card per
task in plan order under its milestone, whose head row carries the lamp, the title and the chips
of its last move, and whose body is one line per attempt. A person's decisions are their own
cards, in time order beside the task they concern.

**Automatic moves fold, and verdicts are chips.** Every move nobody decided is folded under one
`show every move (N)` toggle at the foot of each milestone, which opens the raw feed rows. A
verdict is a chip, `10 notes`, `1 unverified`, `blocker`, that links `#rd-<taskId>` and lands
on that task's first triage card in Result, whose `rd-<key>` id the card component keeps.

**Terse by brief and by code.** The RIO brief asks for a headline under fifteen words and a
detail under three sentences; the summary brief asks for exactly three bullets, each under twenty
words, and nothing before or after them. The server holds the summary to it whatever the session
sent: `threeBullets` keeps the first three top-level list items, each cut at its first line, and
`Mission.summary.text` is that, while `summary.raw` keeps the session's full text.

**One card component.** `web/card.js` draws a task, a question, a finding and a summary bullet
the same way: a 40 px head row (lamp or kind glyph, title, chips, one optional verb) over a body
whose headline always shows and whose detail folds under `why`. `update(spec)` patches in place,
so a fold someone opened stays open. Its styles are `web/card.css`.

**One column, no boxes.** After approval The ask, Plan, Progress and Result are set apart by
space, not panels; the ask's sentence spans its column (`66ch`) rather than stopping at 34
characters. Before approval the gate keeps its lifted panel, the one loud thing on the page, and
`mission.html` no longer links `ship.css`.

**Why:** after the second mission landed, Progress printed the ledger raw: one row per
transition, six rows for a task's two attempts, and every `passed` line dragging its whole
`[carried: ...]` blob behind it, so a flight read as a wall, and the same blob filled the plan on
the branch and the report. Cory's calls on 2026-10-14 were these six and the page's shape, all of
them; the ask's width and the boxes are his own words.

**Rejected: one row per move.** A row per transition is the ledger, which already exists; a
person reads a task, so the task is the card and the moves are on demand. **Rejected: trusting
the brief alone for length.** A session that adds a heading or a fourth bullet would still reach
the page, so the code cuts what the brief asked for. **Rejected: keeping the notes in the ledger
and hiding them on the page.** The ledger is read raw on the branch and in the report too, and
the notes already have a home on the task.

**Not decided here:** the palette, the map, and the inbox, all unchanged.

## M23: The Strike Lead is a chat, from the interview to the flight ✅ built

**One session, resumed per turn.** The Strike Lead is one headless Claude session per mission
(`mission.lead.sessionId`). Each turn is `claude -p --resume` with `--json-schema`, so every reply
comes back as `{ message, questions, planReady }` and the page never has to find the question in
prose. The conversation is `mission.chat` on the record; a turn runs after the request returns,
answers everything said since its last reply, and is picked up again by the next page read if a
restart cut it off. A turn that fails is said in the chat by Maverick, never retried in a loop.

**Questions are cards; answers are buttons.** A round is two to five questions, each one sentence
with two to four options (recommendation first), a box for your own words, and the reasoning
folded under `more context`. The round is sent as one numbered message (`answersText`).

**The plan ends in a button.** When the Strike Lead says the plan is written, Maverick parses it
first: a plan that cannot fly goes back to the Strike Lead with the reasons, twice at most, and
only a plan that can shows **Fire mission** under its message. The gate below keeps the cost,
the preflight and its own approve, which is how a plan written by hand is still flown.

**The same chat answers in flight.** After approval every message carries Maverick's snapshot of
the mission (every task, what it needs, its agent, the open questions, the last of the ledger) and
the flight's rules (a milestone starts when the one before it merges), and the Strike Lead may
read anything but change nothing; it names the control that does. The message still goes into
the ledger as a decision.

**Why:** Cory, 2026-10-27, mid-interview: "I'm trying to start the mission, but it's saying you
can't start it from here. I need to approve it in Maverick. Well I'm in Maverick." And after
approval the reply box wrote to the ledger and nothing answered: "I'm not passing notes."

**Rejected: parsing questions out of the terminal.** A terminal's screen is not a contract; a
schema is. **Rejected: one session per turn.** The interview's value is that it remembers what
it read and what he said. **Kept: the terminal, behind a link.** `open its session in a terminal`
resumes the same session for anyone who would rather type to it there.

**Not decided here:** Maverick posting its own updates into the thread, and saying on the plan
why a milestone or task is waiting (PR 3 of the same audit).

## M24: Every task that has not started says why, and the chat carries the flight ✅ built

**Why it waits, by the rule that starts it.** One function, `gates`, decides for every pending
task either that it goes or what holds it: a need not yet passed, a need whose milestone is held
or still being proved, its milestone not sent, a task in the air that owns the same paths
(`clashOn`, which names them), or a pause. `startable` keeps the ones that go; `waitingOn` says
the rest in words (needs by name, or by id past two), and the milestones say when they will be
sent, by `undoneBefore`, which the dispatch and `mergeable` now share. So what the plan says and
what starts cannot drift: a first version written beside `startable` already had, calling two
tasks on the same path both "starts on the next sweep" when one sweep starts only one. The plan
draws the reason under the task, and the Strike Lead's snapshot carries the same words.

**The chat carries the flight.** `updatesOf` reads the moves worth a text off the feed (a task
out or sent back out, passed, back for you; a milestone on the mission branch, a hold, a failure)
and the thread draws them in time order among the messages. Nothing is stored twice: the ledger
is the record and the chat reads it. A merge is now a ledger line of its own (`merged: milestone
N (title) is on the mission branch`, once, stamped when it merged), because it used to leave none.

**Smaller:** a merged milestone held on its proof or its landing reads `waiting for you`, not
`done`; one whose proof is still running reads `being proved`, from the view's `proved` list
rather than the page working out `done()` again. `open the session` shows only when
there is an agent to open.

**Why:** Cory, 2026-10-27, with four milestones planned and one task running: "it says only one
of them has started... I have no idea what is going on... I asked twice what's going on, why is
this one thing running?" Every task was waiting on that one, directly or through another, and the
page said `waiting`.

**Rejected: Maverick writing its updates into `chat`.** A second copy of the ledger that can drift
from it. **Known limit:** ledger stamps are to the minute, so a Maverick line can sort a few
seconds early among messages sent in the same minute.

## M25: An agent whose process died is ended, whatever its last word was ✅ built

**The listing's pid is the test of life, read once where the listing is read.** `claude agents
--json` carries a `pid` exactly while the process is up. A session that dies mid-turn (a lost
connection) stays listed under its last state word, `blocked` or `working`, for good, with no pid.
`listedAgents` now says such a session `down`, and `down` is one of the `FINISHED` words, so the
mission sweep, the ship sweep and the audits read it as ended without each learning the rule. A
Wingman that ended is read for its commits; a RIO that ended without a verdict is handed back,
which is a question with its answers; a ship step is collected; the racks say `down`.

**And a RIO waiting on a prompt says so.** The sweep already said when a Wingman was waiting on
you in its own session; a RIO in the same state now says so too.

**Why:** 2026-10-27, Concept Build. m2-t2's RIO lost its connection after its tests passed and
sat listed as `blocked` for two hours while the page said `in review` and nothing asked anyone
anything, because "blocked" is not "finished". The ship sweep had the same hole.

**Rejected: a grace period for a listed session with no pid.** It would only matter if a session
could be listed before its process had a pid. The one observation (a Wingman relaunched the same
evening was listed with its pid moments after the spawn returned) says it is not, so this rests on
that; if it turns out otherwise, a launch would be handed back at once, loudly, not left silent.

## M26: Landing says why it failed, checks for a remote first, and follows the project ✅ built

**A failed landing says git's reason.** `whyFailed` reads the line of a command's stderr that
says why (a `fatal:` or `error:` line first, else the last) for a landing as for a launch, so a
held milestone reads `fatal: 'origin' does not appear to be a git repository`, not the push
command that failed.

**Preflight checks that a repo landing remotely has somewhere to go.** A repo set to land by a
pull request or a push with no git remote refuses approval, with the fix in the line: add a
remote, or set its land to merge in `maverick.json`. It used to fail at the very end, after every
milestone had flown.

**`try landing again` follows the project's landing for a repo not landed yet**, and writes each
change to the ledger (`root now lands by merge, not pr, as the project's maverick.json says`). A
landing fixed in the project's own config is fixed for the mission in flight, by a person asking.
The sweep does not follow: an edit to `maverick.json` mid-flight would otherwise start pushing a
base nobody approved. A repo that has landed keeps the way it did.

**Why:** 2026-10-28, Concept Build. Every task passed and every milestone merged, then the
landing held on `root`: a local-only umbrella repo with no remote, set to land as a pull request
by the project's default. The hold said only `Command failed: git -C ... push`, preflight had not
asked, and changing `maverick.json` would not have reached the mission already flying.

## M27: Every link out of Maverick lands in one browser tab ✅ built

**Outside links leave the app, from every window and frame.** The app's link rules were set on
its first window only. A walkthrough opened with `open in its own tab` became a Maverick window
with no rules, so each dev link in it opened as another Maverick window, where the dev app has
none of the browser's sign-in and failed to load. The rules now go on every web contents the app
makes (`web-contents-created`), and a link followed inside a frame (`will-frame-navigate`) is
caught as well: anything not on Maverick's own origin goes to the browser.

**One tab, replaced on every click.** On macOS a web link goes to `config.browser`, Google Chrome unless `MAVERICK_BROWSER` names
another Chromium browser, through AppleScript, into the tab this app opened last, found again
by its id; once it is closed, the next link opens a new window. So a walkthrough is stepped
through with the tab left open in a window of its own. The URL is an argument to the script, never
part of it. If the browser cannot be driven (not installed, or Automation not allowed), the link
goes to the default browser and the reason is logged. A `mailto:` and a non-mac host use the
system's own handler.

**Why:** Cory, 2026-10-29, walking Concept Build's walkthrough: the dev links "opening in the
Maverick application... it's failing to load"; "open those links in a Chrome browser... uses the
same tab, same exact window... so I can just leave that open on another window, click it, and
quickly step through each of these walkthrough steps."

## M28: A milestone is a foundation, and it is walked before anything builds on it ✅ built

**A milestone is a foundation**: work that what comes after it builds on. Everything that can be
built at the same time is one milestone: the contract first, then the backend and the frontend in
parallel against it. It is never cut by layer or by repo, and the walkthrough is never a
milestone. Most missions are one milestone. A milestone is not a feature either; features are the
cases its walkthrough tests.

**The walkthrough blocks the next milestone.** One walkthrough per milestone stays (M12 holds),
but this amends M12's "does not block the next milestone": `done` now needs the milestone walked
or waived as well as merged and proved, so nothing builds on, merges after, or is sent past one
that has not been walked. A waiver still counts, with its reason. A milestone that changed
nothing has nothing to walk. Review, landing and the commissioning of the walkthrough itself
still follow the merge and the proof (`proved`), so the last walk is asked at review.

**Every walkthrough is something Cory can see.** Each milestone carries a `_walk: <case>; ..._`
line in the plan beside its `_done when_`, and a plan without one cannot fly. Work with no screen
(a migration, a backfill) shows its dry run on the preview, before and after, as part of building it.

**The plan is briefed before it is fired**: per milestone what it builds, the cases Cory walks at
its end, what it builds on, a rough time, and that he walks it; then the totals. Maverick computes
the times: the longest `needs` chain inside the milestone times the measured minutes per task
(build plus review, last attempt), plus the measured retry rate times those minutes, read from the
mission records. With no history, 15 minutes per chain link, said to be a default. Minutes are
rounded to the nearest 5.

**The gate refuses** a milestone whose tasks all work in one repo while another milestone works
in a different one, and a milestone none of whose tasks touches product code (judged from
`touches`: only `deliverables/` or `docs/` at a repo's root, and test code anywhere, by folder (`test`, `tests`, `__tests__`, `e2e`, `cypress`, `playwright`) or by name (`*.test.ts`, `*.spec.tsx`)). It **warns** on a milestone of four
or more tasks whose longest `needs` chain is more than half of them, and names the chain.

**Why:** a review of five missions (51 tasks), 2026-10-29. Missions came to Cory slice by slice
and ran about one session at a time, because the only milestone guidance the Strike Lead had was
"keep milestones small enough that a failure costs one milestone". It cut by layer (contract,
backend, frontend, then a walkthrough milestone) and chained the tasks inside each. Concept Build
was four milestones, none a foundation the others waited for; its backend walkthrough was waived
as "no user-facing screen", and the files redesign's backend walkthrough asked Cory to run
`vitest`. 19 of 51 tasks needed a second build and review.

| Mission | Tasks | Wall clock | Agent build | RIO review | Avg running | Peak | Retried |
|---|---|---|---|---|---|---|---|
| Mission page and inbox | 12 | 760 m | 58 m | 57 m | 0.2 | 3 | 7 |
| The result reads itself | 8 | 68 m | 39 m | 32 m | 1.0 | 2 | 2 |
| Progress reads itself | 8 | 61 m | 48 m | 38 m | 1.4 | 3 | 2 |
| Concept Build | 9 | 385 m | 57 m | 26 m | 0.2 | 2 | 4 |
| A files redesign | 14 | 145 m | 125 m | 54 m | 1.2 | 2 | 4 |

Wall clock is approval to last review; build and review count the final attempt only. Decided by
Cory 2026-10-29.

## M29: A walk runs to its last case, and what it failed is fixed in one task ✅ built

**A walk is answered in full before anything is fixed.** Nothing is filed while cases are still
unanswered, so one walk finds everything it is going to find before a single fix starts.

**Everything the walk failed goes to one fix task on that milestone.** The verdicts `fail`,
`partial` and `blocked` are failures; `defer` is a person putting a case off, not one. When the
last case is answered and any failed, Maverick adds `m<n>-fix<round>` to the milestone with every
failed case in its intent (the case id, the verdict, and the note the person wrote), owning the
paths the milestone's tasks owned. The milestone is no longer merged: the task flies, its RIO
reviews it once, the milestone merges and its proof runs again, as for any task. A mission at
review is flying again until then.

**Only the failed cases are walked again.** Once the fix has merged and been proved, those cases
lose their answers on the record and in the document, and the walk asks for them and nothing
else. The milestone is walked when every case is answered and none failed; a walk that fails again
files the next round. A save from a page that has not yet dropped a round's answers is not taken,
so it cannot put the old failures back. A person can still waive the walk, with a reason.

**A walk with failed cases is not walked.** Before this, answering every case counted, whatever
the answers were, so a failed walk let the next milestone start.

**Why:** Concept Build, 2026-10-30. Its rehearsal walk passed 16 of 17 cards, and every bug any
walk found was driven by hand as its own build and its own review. Nothing in the protocol said
what a failed walk does, so each bug fell into the default unit of one task, one Wingman, one
RIO, and the turnaround multiplied. Decided by Cory 2026-10-30: batch, and do it in Maverick
rather than leave it to the Strike Lead's judgment.

## M30: What the mockups drew is what ships, component by component ✅ built

**The reuse-or-new call is made per component, by Cory, before the plan is written.** For every
element a mockup draws, the Strike Lead names the existing component it resembles (or none,
found in the code) and asks him one of three: **reuse** it as it is, so the mockup is drawn
with its real look; **restyle** the shared component, so the new look replaces the old one
everywhere and the other screens it changes are named; or build a **new** one, with the old one
staying elsewhere. A pick already made in a `variants` round (whose inventory now asks the same
question) is not asked again. A blanket "reuse existing components" is never written.

**The plan carries it.** `## Components` holds a `mockups: <path>` line and one line per element:
`**<component>** (owner: <task>): reuse | restyle | new; cells <n, n>; <one line>`. A task that
builds cells says so on a `cells:` line. The gate refuses a task whose cells no component line
decides, cells cited with no `mockups:` line, a decision that is not one of the three words, and
an owner that is not a task.

**The look is checked, not assumed.** A task with cells is told the decisions over its cells and
is not done until it commits the built screen at 390 and 1280 beside each cell, under
`deliverables/screenshots/<mission>/<task>/`, a folder it owns. Its RIO opens the screenshots and
the cells; an element that differs from its decision is a blocker, and the RIO runs `ui-audit`,
whose matches-the-brief check takes the cells. A milestone that built cells gets one "Looks like
cell N" case per screen in its walkthrough, with the cell beside the link.

**Why:** Realtime's item-files redesign, 2026-10-29/30. Cory approved mockups drawn in a fresh
stylesheet; the plan said "reuse app components as they are"; fifteen tasks passed review and
the walkthrough pre-screen passed 22 of 22, all on behaviour, and the screens looked nothing like
what he approved. The opposite failure came first (2026-10-02, one-off controls that matched a
mockup and nothing else in the app). Both had one root: the decision was never made explicitly.
Decided by Cory 2026-10-30.
