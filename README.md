# Session console

The one screen Cory manages work from, one project at a time: the roadmap columns
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

## Run

```
node server.ts          # http://localhost:8766
```

Node 22.18+ runs the TypeScript directly. No build step, no dependencies.

Environment overrides (see `src/config.ts`):

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_CONSOLE_PORT` | `8766` | listen port |
| `SESSION_CONSOLE_HOME` | `~/.claude/session-console` | holds `projects.json` |
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
- **Calendar** (top bar toggle): a month grid of items with a `due` date and releases whose
  heading says `deploy YYYY-MM-DD`, plus the roadmap items that have no deadline yet. Click
  an event to open its drawer.
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
xterm.js loaded from jsdelivr (pinned 5.5.0 + fit addon 0.10.0), the one runtime
dependency, fetched by the browser, not installed. Fonts (Chakra Petch for display, IBM Plex Sans, JetBrains Mono)
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

## How a tracker is read

A `## ` heading is a section; its emoji picks the column (🔥 priority, 🚧 in progress,
📋 🧊 🧹 backlog, ✅ shipped; other sections are not shown). A `### ` heading inside a
section is a group. A top-level `- ` bullet is an item, together with every indented line
that follows it. A move relocates that whole block and touches nothing else.

## Not built yet

Checkbox flips from the UI, the archive-on-ship button, per-release deploy dates, audit parents and the manager agent, and the Electron shell (the server is already shaped as its main process).
