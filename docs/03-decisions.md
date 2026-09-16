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

**Safety-load-bearing:** the Air Boss's boundary must be enforced by its allowed-tools list, not
by its prompt. An agent asked politely not to change something will change it the first time the
change looks small.

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
