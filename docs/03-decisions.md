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

**Status:** designed, not built. `src/audits.ts` today implements only the validator half of what
a RIO is meant to be: a verdict on a session that already finished. See
[`POSITIONING.md`](./POSITIONING.md).

## M6 — Readiness gates an unattended launch ◐ design

Maverick should decline to launch an **unattended** session into a repo whose environment it
cannot verify, and name the missing signal.

**Why:** taken from Factory, whose Missions refuse to run below readiness Level 4. The
interesting part is not the score, it is that the score gates the expensive thing.

**Status:** designed, not built. Scoring at import is the first step.
