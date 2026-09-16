# Positioning — what Maverick is, and what it is not

_Written 2026-09-16, after a competitive pass over Factory.ai, Vibe Kanban, Conductor,
Nimbalyst, Claude Squad, Backlog.md, and Claude Code's own Agent View. Dated on purpose: the
landscape moved twice in 2026 and will move again. Re-argue this, don't inherit it._

## The claim that stopped being true

Maverick was built on the idea that it watches **every** agent session on the machine,
including ones it did not launch, and that this is what separates it from a vendor's own
console. That was true in the summer.

In May 2026 Anthropic shipped **Agent View** (`claude agents`): one screen over all background
sessions, grouped by needs-input / working / ready-for-review / completed, with peek-and-reply
without attaching, dispatch, rename, pin, stop, and filters. It is free, in the terminal, and
already installed on any machine running Claude Code.

One seam survives: Agent View does not list interactive sessions open in other terminals until
they are backgrounded. Maverick reads the session registry and sees them. That is a real
difference and a thin one. **It is not a position. Do not build the pitch on it.**

## The claim that is true

**The roadmap, the release, and the ship are the same object as the session.**

Every tool in the category stops at "a task became a diff":

| Tool | Where it stops |
|---|---|
| Claude Code Agent View | sessions, in the terminal |
| Vibe Kanban, Conductor, Nimbalyst | a card, a worktree, a diff to review |
| Claude Squad, dmux | panes and worktrees |
| Backlog.md | markdown tasks an agent can edit |
| Factory | a delegated task and a merge |

Maverick goes further down the same line and does not stop: item → release slot → a version
computed from its contents → the PRs assigned to it by tag date → a ship wizard that drives the
project's own `SHIP_WORKFLOW.md` phase by phase, resumable, each phase a real session → an audit
verdict before any of it is believed.

That is a **workflow management tool that happens to run agents**, not an agent runner that
happens to have a board. It is the harder half to copy, because it encodes an opinion about how
software ships rather than about how agents are launched.

The second true thing: **the markdown trackers are the source of truth and Maverick owns no
store.** Backlog.md is the only other project that takes this seriously, and it has no release
or ship layer. A board whose state lives in an app's database is a board you cannot edit from a
session, from a terminal, or by hand on a tablet. Maverick's state is in the repo, in git, in
files a human and an agent both read.

## Three levels of agent, per project

The reframe this document exists for. Maverick is **project-scoped**, so agents are too, and
they come in three levels that differ in what they are allowed to touch.

| Level | Name | Holds | May write |
|---|---|---|---|
| 1 | **Air Boss** | the whole project | plan documents |
| 2 | **Mission**, run by a **RIO** | one bounded effort | the plan, and the workers |
| 3 | **Wingman** | one item | code, in a worktree |

**Air Boss** runs the flight deck and does not fly. One long-lived agent per project that has
read everything: ask it where things stand, what a decision was, what is blocked. It writes plan
documents. It does **not** build features and does not edit product code, and that boundary is
enforced by its tool list, not by its prompt. An agent asked politely not to fix something will
fix it the first time the fix looks small.

**Mission** is a bounded multi-feature effort, and the **RIO** is the agent that runs it. In a
two-seat fighter the RIO works the radar and calls the intercept while the pilot flies: it holds
the tactical picture and directs, which is exactly the orchestrator role. A RIO opens with a
clarifying interview, builds features grouped into milestones, gets blessed once, then dispatches
Wingmen and validates at every milestone gate.

**Wingman** is one item off the board: fresh context, a worktree, a diff. This is what Maverick
spawns today.

The levels are not seniority. They are **blast radius**: Air Boss writes documents, the RIO writes
plans and spawns, Wingmen write code.

### Where the current audit fits

`src/audits.ts` and the audit-parent records implement the **validator half only**: a verdict and
findings on a task session that has already finished. That is one output of a RIO, not a RIO. The
work is to grow the missing half in front of it, the interview and the milestone plan and the
dispatch, rather than to rename what is there. Naming it RIO before it orchestrates anything would
be the kind of drift this document exists to prevent.

## What we take from Factory, and what we leave

Factory's Missions is documented behaviour, not a file format, and the behaviour is worth taking:

- **Refuse to start on one prompt.** Interview first, probe constraints, present a plan for
  approval. Factory says this scoping phase is where most of the value is, and that matches what
  goes wrong here when a session starts under-specified.
- **Fresh context per unit of work.** The orchestrator holds the plan; no worker holds the
  project. This is the actual answer to context exhaustion, and it is cheap to adopt.
- **Validation is a milestone gate, not a step inside the worker.** An agent checking its own
  work is the failure mode the audit already exists to catch. The RIO validates; the Wingman does
  not grade itself.
- **Human-style QA.** Drive the real UI, not only the unit tests. Playwright is the seam.
- **Narrow parallelism.** Within a feature and during validation. Sequential elsewhere, because
  coordination overhead beats the speed gain.

What we leave: the cost. Factory's own numbers put a mission at a median of ~2 hours and **12x
the tokens** of a normal session, with 14% running past 24 hours. That is the argument for the
blessing gate and against ever making missions the default path.

## Agent readiness as a gate, not a dashboard

Factory scores a repo across nine pillars onto a five-level ladder, 80% of a level's criteria to
unlock the next. The interesting part is not the score. It is that **Missions refuse to run below
Level 4.** The score gates the expensive product.

Maverick takes the same shape, with the MIT implementation (`@kodus/agent-readiness`) rather than
a home-grown one, and applies it at **import**: score the project, show the level and the failing
pillars on its card, and offer the remediation we actually own (scaffold the docs, add the tracker,
install the drift gate). Then use it as a gate: Maverick should decline to launch an **unattended**
session into a repo it cannot verify, and say which signal is missing.

Baseline taken 2026-09-16 across this workspace: **every repo measured scored Level 1**, from 3%
to 49%. Maverick itself was the worst at 3%. A tool that grades repos and fails its own grade is
not shippable, which is why clearing Level 2 is on the checklist above the features.

## Open source

MIT, public, and not monetised. The point is eyes and use, not revenue. Two things follow:

- Open source is not distribution. Vibe Kanban has 28.1k stars and its company still shut down in
  April 2026. The repo being public produces nothing without a post and a demo.
- Therefore the README, a screenshot, and a working `npx`-grade first run matter more than the next
  feature. Nobody evaluates the ship wizard if they cannot get the board on screen.

## What we are deliberately not doing

- **Not competing on session observation.** The vendor ships that for free.
- **Not building a cloud runtime.** Local-first, single-user, no account. That is a feature.
- **Not adding a database.** The trackers are the store. This constraint is load-bearing.
- **Not writing our own readiness scorer** while an MIT one exists and works.
