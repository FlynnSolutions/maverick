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
dependency, fetched by the browser, not installed. Fonts (IBM Plex Sans, JetBrains Mono)
come from Google Fonts with local fallbacks.

**Development focus.** The board hides items tagged administrative (`[BIZ]`,
`[STRATEGY]`, `[NOTE]`, `[IDEA]`, `[DECISION]`) unless "show non-dev items" is on. Items
with engineering tags or no tag at all always show. The tag vocabulary is the checklist's
own; change the two sets at the top of `web/app.js` to retune it.

## Two kinds of session data

- **Running sessions** come from Claude Code's own registry, `~/.claude/sessions/<pid>.json`
  (name, cwd, status, what it is waiting for). Read-only; the CLI owns that directory and
  the console must never write there.
- **Session records** (role, loop, parent, handoff) are ours, under
  `~/.claude/console-sessions/`, written by the two helpers above. Linking the two by
  session id is a later brick.

## How a tracker is read

A `## ` heading is a section; its emoji picks the column (🔥 priority, 🚧 in progress,
📋 🧊 🧹 backlog, ✅ shipped; other sections are not shown). A `### ` heading inside a
section is a group. A top-level `- ` bullet is an item, together with every indented line
that follows it. A move relocates that whole block and touches nothing else.

## Not built yet

Checkbox flips from the UI, the archive-on-ship button, audit parents and the manager agent, and the Electron shell (the server is already shaped as its main process).
