---
owner: claude
mode: explanation
---
# Overview

Maverick is the pilot. It is the one screen its user manages work from, one project at a
time: the roadmap read from that project's markdown trackers, the Claude Code sessions
running under it, the releases, and the ship.

It does **not** provide the agent. Claude Code does. Maverick is an observability, steering
and workflow layer over an agent runtime it does not own.

## Who it is for

One person at a keyboard, running many Claude Code sessions against their own repos, who
wants a single surface over the work rather than a screenful of terminals. Local-first and
single-user by design: no account, no cloud, no multi-tenant anything.

It is public and MIT licensed, so the second audience is anyone else in that position. See
[`../LICENSE`](../LICENSE) and [`../RULEBOOK.md`](../RULEBOOK.md).

## What makes it different

Session observation is no longer the differentiator: Claude Code shipped its own Agent View
(`claude agents`) in May 2026. What Maverick has that the category does not is that **the
roadmap, the release and the ship are the same object as the session.** An item becomes a
release slot, becomes a version computed from its contents, becomes a ship run that drives the
project's own `SHIP_WORKFLOW.md` phase by phase, and gets audited before any of it is believed.

The full argument, including who else is in this space, is in
[`POSITIONING.md`](./POSITIONING.md).

## Status at a glance

Working today: the workspace rack, formations, the roadmap board over markdown trackers, the
calendar, releases from changelog + GitHub, the ship wizard, embedded terminals, audit parents.
See [`04-status.md`](./04-status.md) for where it actually stands and
[`../deliverables/CHECKLIST.md`](../deliverables/CHECKLIST.md) for what is next.
