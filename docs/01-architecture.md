---
owner: claude
mode: explanation
---
# Architecture

One Node process serving a static browser client, over data it reads from other people's
files. There is no database, no build step and no runtime dependency.

```
  browser (web/)  ──HTTP──▶  server.ts  ──reads──▶  the project's git repo + markdown trackers
                                 │                   ~/.claude  (Claude Code's own state)
                                 │                   git / gh  (worktrees, PRs, tags)
                                 └──writes──▶        one line move, committed in the tracker's repo
                                                     ~/.claude/session-console, ~/.claude/console-sessions
```

## The three layers

**`server.ts`** is the whole HTTP surface: static files from `web/`, and every `/api/*`
endpoint dispatched from one router. It holds no business logic of its own; each route calls
into a `src/` module. It is written so that nothing in it assumes a browser tab, because it
becomes the Electron main process later (see [`03-decisions.md`](./03-decisions.md)).

**`src/*.ts`** is the model, one module per concern:

| Module | Concern |
|---|---|
| `config.ts` | every environment-specific value, overridable by `SESSION_CONSOLE_*` env |
| `projects.ts` | the project registry, tracker detection, the Finder import |
| `trackers.ts` | parse a markdown tracker into sections/groups/items, and apply a move |
| `releases.ts` | versions from the changelog plus merged PRs, and the two planned slots |
| `ships.ts` | a ship run: saved, resumable steps for one version |
| `missions.ts` | a mission: the Strike Lead's interview, the plan, the flight of Wingmen, their RIOs |
| `sessions.ts` | session records written by `bin/session-open` / `session-close` |
| `formations.ts` | a named group of sessions: one lead, its flight |
| `audits.ts` | audit parents: a record that owns a group of task sessions |
| `live.ts` | live signals a tracker cannot know (running sessions, worktrees, open PRs) |
| `processes.ts` | where a session process lives: tty, uptime, the app above it |
| `transcript.ts`, `transcript-view.ts` | what a session is doing, read from Claude Code's transcript |
| `terminal.ts` | embedded `claude` processes inside a pty (`bin/ptybridge.py`) |
| `peer.ts` | type into a running session over its messaging socket |
| `usage.ts`, `claude-usage.ts` | token spend from transcripts; plan windows from Claude's endpoint |
| `git.ts` | commit one file; repo discovery, worktrees, PRs, `claude agents` reads |
| `names.ts`, `theme.ts` | session naming, and the per-project `maverick.json` colours |

**`web/`** is plain HTML, CSS and JavaScript talking only to `/api/*`. `command.js` holds the
workspace (the rack, strips, formations, the full-screen session view); `app.js` holds the bar,
board, calendar, dialogs and theme; `lamp.js` draws the nozzles and reticles; `jet.js` is a
traced F-14 and is regenerated, never hand-edited. The design contract is
[`../.ui-design/system.md`](../.ui-design/system.md), which is binding, not descriptive.

## What it reads that it does not own

This is the load-bearing part. Maverick is a reader of other systems:

- **The project's markdown trackers** are the source of truth for all board state. Maverick
  parses them, and writes each change back as one line move committed immediately in the
  tracker's own repo, so every other open session sees it.
- **Claude Code's own state**: the session registry, the transcripts under
  `~/.claude/projects/<cwd-slug>/`, and `claude agents --json --all` for background agents.
  Maverick does not compute session status; it reports what the registry says.
- **git and `gh`**: worktrees, merged PRs, version tags, the changelog.

## What it does own

Two directories, deliberately small (`src/config.ts`):

- `~/.claude/session-console/` — the project registry, release slot labels, the access key,
  the usage cache.
- `~/.claude/console-sessions/` — one JSON record per session, and `ships/<project>/<version>.json`.

Anything that a tracker file could hold belongs in the tracker, not here.
