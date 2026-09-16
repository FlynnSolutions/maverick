# Maverick

The pilot. Maverick flies the work: it sits in the seat over every project, the sessions,
the releases, and the ship, and the name is the point, this application is the pilot.

Maverick is the one screen Cory manages work from, one project at a time: the roadmap columns
(Priority, In progress, Backlog, Shipped) read straight from that project's markdown
trackers, drag to sequence or move items, the Claude sessions running under the project
(interactive and background), our session records (driver / develop / audit / plan), and
the live signals those sessions own (dev servers, worktrees, open PRs).

Opening the console shows the project picker. Import a directory from Finder (a native
folder dialog) or paste a path; the console finds the tracker files it recognises
(`deliverables/CHECKLIST.md`, `CHECKLIST.md`, `PUNCHLIST.md`, `TODO.md`, `NEXT_STEPS.md`)
and remembers the project in `~/.claude/session-console/projects.json`.

**The markdown trackers stay the source of truth.** The console reads them and writes each
drag back as one line move, committed immediately in the tracker's repo so every other open
session sees it. It keeps no store of its own; if the console and the file disagree, the
file wins.

## Theme

Maverick wears the project it is flying. A `maverick.json` at the project root sets
`accent`, `accentHot`, `font` (a Google Fonts family for display text) and `callsign`
(shown next to the name in the top bar). Realtime's is its brand blue and Outfit. Projects
without one get Maverick's own colours: afterburner orange over carbon. Effects are jets,
not weather: a flyby with a contrail on big actions (a new session, a ship step, opening the
ship wizard), a missile from the card to the dock when a session is spawned, flares off a
card when a drop commits. The ambient contrail respects reduce-motion; the action effects do
not, they are the product.

## Run

```
node server.ts                               # http://localhost:8766
SESSION_CONSOLE_HOST=0.0.0.0 node server.ts  # also reachable from your phone, behind the access key
```

Node 22.18+ runs the TypeScript directly. No build step, no dependencies.

Environment overrides (see `src/config.ts`):

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_CONSOLE_PORT` | `8766` | listen port |
| `SESSION_CONSOLE_HOST` | `127.0.0.1` | `0.0.0.0` opens it to the LAN; non-loopback clients need the key in `~/.claude/session-console/access-key` once (`?key=`), then a cookie |
| `SESSION_CONSOLE_HOME` | `~/.claude/session-console` | holds `projects.json`, `releases.json`, the access key, the usage cache |
| `SESSION_CONSOLE_SESSIONS` | `~/.claude/console-sessions` | session record directory |

## Layout

- `server.ts` local HTTP server: static files from `web/` and the `/api/*` endpoints.
  Becomes the Electron main process later; nothing in it assumes a browser tab.
- `web/` the UI, plain HTML/CSS/JS, talks only to `/api/*`.
- `src/trackers.ts` parses a tracker into sections, groups and items, and applies a move.
- `src/projects.ts` the project registry, tracker detection, the Finder picker.
- `src/git.ts` commit one file; repo discovery, worktree, PR and `claude agents` reads.
- `src/live.ts`, `src/sessions.ts` the side rail data.
- `bin/session-open`, `bin/session-close` write the per-session JSON record
  (`~/.claude/console-sessions/<id>.json`) that the session tree is drawn from.

## Session records

```
bin/session-open --role driver --loop "v1.9 ship" --exit "develop promoted to production" --project Realtime
bin/session-close --id <id> --status handed-off --handoff "deliverables/plans/dialed-batch-2026-09-14.md section 8"
```

`CLAUDE_SESSION_ID` in the environment is used as the id when present.

## The board is a roadmap, not a kanban

- **Roadmap** (the Priority section). Its `###` groups are releases, top to bottom in
  deployment order; the numbered order inside a release is that deployment's runway.
  "+ release" adds a `### name` heading to the section; drag a card into a release to plan
  it. Items above the first release are "unassigned".
- **In progress** and **Backlog** are the matching sections; each lane folds away (the
  fold is remembered per browser).
- **Done, awaiting deploy** gathers the "recently shipped, pending release" section plus
  every checked-off item from the other sections: merged or finished, not yet in
  production. Nothing in it is draggable. At ship time the ship workflow archives it.
- Checked items never show in the other lanes, so nothing is struck through on the board.
- Lanes run Backlog, Roadmap, In progress, Done: pull from the left, ship to the right.
- **Fields.** An item may carry `  - key: value` lines under its bullet (`source`, `due`,
  `release`, `size`, `kind`, `status`, `owner`, `plan`, `pr`, `links`, `blocked-by`). The
  drawer shows them as a grid above the prose; a card shows its `due` as a chip (blue within
  a week, red overdue); the deadline picker in the drawer writes or clears the `due` line and
  commits. Older one-line items still parse: the italic after the title is read as the
  source. The `/save-followup` skill writes new items in the fielded shape.
- **Calendar** (top bar toggle): the releases strip, a month grid of items with a `due` date
  and releases with a deploy date, and the roadmap items that have no deadline yet. Drag an
  item onto a day to set its `due` (one commit per drop).
- **Releases are real, and two are planned.** The strip reads the project's changelog
  (`contracts/CHANGELOG.md` or `CHANGELOG.md`, Keep-a-Changelog shape) and GitHub. **Next**
  is the `[Unreleased]` block plus every PR merged since the last version tag plus the items
  planned for it; **the one after** holds the items planned beyond that. Each slot's version
  is computed from its contents (a feature anywhere bumps the minor, only fixes bump the
  patch, the second slot builds on the first) and can be overridden by name in its drawer,
  along with a deploy date; those two labels live in `~/.claude/session-console/releases.json`,
  everything else is the tracker. Plan an item into a slot by dragging its card onto the slot
  (from the board or the calendar) or with the release select in its drawer; it writes
  `- release: next` or `- release: next+1` under the bullet. Shipped versions show added /
  fixed / PR counts; click any card for the PR list (linked, feat / fix by title prefix), the
  GitHub compare link per repo, the changelog bullets, and the planned items. At ship time the
  ship workflow should rewrite `release: next+1` to `next` (manual today). PRs are assigned to
  a version by tag date from the last 400 merged PRs per repo, so old versions undercount.
- **Roadmap groups.** `###` headings under Priority are groups on the board (a review batch,
  a theme). "+ group" adds one; an empty group shows × to delete it. They are not releases.
- **Ship wizard.** "Ship v1.9.0" on the next-release card opens a saved run of steps: audit
  every task session in the release, build the staging test walkthrough
  (`/ship-test-walkthrough`), build the architecture doc (`/ship-architecture-doc`), then every
  phase of the project's own `claude/SHIP_WORKFLOW.md` (parsed live), each phase driving the
  `/ship` skill for that phase only. Each step runs as a background Claude session you can
  open in the dock (the ship skill pauses for your confirmation inside it); when the session
  finishes, the step becomes done if it wrote its summary, otherwise "finished" for you to
  mark; documents written under `deliverables/testing` and `deliverables/architecture` while
  the step ran are linked and served read-only by the console. Notes per step, skip, reopen.
  Progress lives in `~/.claude/console-sessions/ships/<project>/<version>.json`, so you can
  close the wizard and come back; `#ship-1.9.0` deep-links it and the card shows "continue
  shipping · 3/12". The wizard never merges or deploys on its own: those are confirmations
  inside the ship session.
- **Audit parents.** In an item's drawer, pick an audit parent (or create one) before
  spawning; the task session's record points at the parent. When a supervised task finishes
  (its background session reaches done), the console runs the `auditor` agent on it in a new
  background session, once a minute sweep or "audit now". The auditor writes
  `~/.claude/console-sessions/audits/<session>.md` with `verdict: pass|fail|mixed` on the
  first line; the rail shows the verdict under the parent, "findings" opens them, and accept /
  reject records your decision on the task's record. The auditor never edits or commits.
- **Created.** An item's `created` field, else the first date in its source text, shows on
  the card and in the drawer. Items with neither show the date their entry was last changed
  (from `git blame`, one call per file, cached by mtime), labelled as such.
- **Click a card** to read the whole entry; **edit** turns it into the raw markdown, and
  save writes the block back and commits (the first line must stay a bullet).

## Working in a session from the console

Every session row has **open**: a background agent is attached (`claude attach <id>`), an
interactive session is resumed (`claude --resume <sessionId>`), a worktree gets a fresh
`claude`. **New session** starts one in the project root. **spawn** on a card starts a
headless agent on that item (`claude --bg`, auto permission mode, the item text as its
prompt, a session record written for it) and attaches it. Each opens in the terminal dock
at the bottom; closing a tab leaves the session running, **stop** on a background agent
ends it (`claude stop`, conversation kept).

The terminal is a real pty: `bin/ptybridge.py` (Python standard library, no native
module) wraps the `claude` process; the server streams its bytes to the page over
Server-Sent Events and posts keystrokes and resizes back. The page renders it with
xterm.js (5.5.0 + fit addon 0.10.0) vendored under `web/vendor/`, so the app boots with
no network; it is the one runtime dependency. Fonts (Chakra Petch for display, IBM Plex Sans, JetBrains Mono)
come from Google Fonts with local fallbacks.

**Development focus.** The board hides items tagged administrative (`[BIZ]`,
`[STRATEGY]`, `[NOTE]`, `[IDEA]`, `[DECISION]`) unless "show non-dev items" is on. Items
with engineering tags or no tag at all always show. The tag vocabulary is the checklist's
own; change the two sets at the top of `web/app.js` to retune it.

## Two kinds of session data

- **Running sessions** come from Claude Code's own registry, `~/.claude/sessions/<pid>.json`
  (name, cwd, status, what it is waiting for), explained with the process's home (the app
  and tty it lives in, uptime, from `ps`) and a glance at its transcript
  (`~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`: the AI title, your last prompt, the
  last reply). Read-only; the CLI owns those files and the console never writes there.
  **close** sends the process SIGTERM; the conversation stays on disk and can be resumed.
- **Session records** (role, loop, parent, handoff) are ours, under
  `~/.claude/console-sessions/`, written by the two helpers above. Linking the two by
  session id is a later brick.

## The workspace is the command center

The Workspace view shows every Claude session on the machine as a panel: interactive ones
from the registry, background ones from `claude agents`, grouped by project and ordered by
what needs the pilot: a **Needs you** band first (sessions waiting on input), then the
formations (a lead session and the task sessions it watches, hung off a hairline, with the
audit verdict on each), then Working, Idle and Finished, with closed formations folded to
one line. A panel carries the status lamp, where the session lives, and the last exchange;
`dock` is its one action. Click it and the session opens full screen as a conversation
read from its transcript (`/api/transcript`, polled incrementally): your prompts as
panels, Claude's replies as rendered markdown, runs of tool calls folded into one line of
chips, harness injections (task notifications, reminders) folded as system events.
A background session gets a composer at the bottom (Enter sends, over a headless attach;
drop a file to attach its path) and **Take the stick** for the real terminal; a session
that lives in another terminal says so, since Maverick cannot type into it yet (Claude
Code's per-session socket would allow it and needs a permission decision). **close** /
**stop** end a process from the full-screen head, and stale idle panels (a day or more)
carry a close button. Files dropped on any dock terminal are saved under the console's
home (`drops/`) and their paths typed. Design decisions for this surface are recorded in
`.ui-design/system.md`.

Terminals start `claude` with every `CLAUDE*` variable stripped and
`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`: Maverick is often launched from inside a Claude
session, and a claude that inherits those markers stops saving its transcript.

**Usage is a provider widget.** `web/providers/claude.js` owns everything Claude-specific
about limits, so another provider can sit beside it with the same `mount(root, ctx)`
shape. The baby pill shows the open 5-hour window (all models and Fable) with when it
resets, and the rolling week; open it for per-family rows, load per hour for the last 24
and per week for the last 8, and a Calibrate tab. The 5-hour window is reconstructed from
the transcripts: it opens at the first message after the previous window lapsed, so the
reset is known to within the hour. Claude Code does not store the plan's quota, so the
widget shows load (output × 4 + input + cache writes + cache reads ÷ 10) until you press
"this is the limit" the moment Claude reports a window used up; from then on that window
reads as a percentage (limits saved to `usage-limits.json`).

## How a tracker is read

A `## ` heading is a section; its emoji picks the column (🔥 priority, 🚧 in progress,
📋 🧊 🧹 backlog, ✅ shipped; other sections are not shown). A `### ` heading inside a
section is a group. A top-level `- ` bullet is an item, together with every indented line
that follows it. A move relocates that whole block and touches nothing else.

## Not built yet

Checkbox flips from the UI, the archive-on-ship button, the manager agent, rewriting `release: next+1` to `next` at ship time, and the Electron shell (the server is already shaped as its main process). The data directories still carry the old name (`~/.claude/session-console`, `~/.claude/console-sessions`) so nothing recorded so far is lost.
