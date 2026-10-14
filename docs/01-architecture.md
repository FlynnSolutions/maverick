---
owner: claude
mode: explanation
---
# Architecture

One Node process serving a static browser client, over data it reads from other people's
files. There is no database, no build step and no runtime dependency. The Electron shell under
`app/` is a window onto that same process: it imports `server.ts` as the main process and opens
on the port it listens on, and it is the one place in the repo that installs anything (M15).

```
  browser (web/)  ──HTTP──▶  server.ts  ──reads──▶  the project's git repo + markdown trackers
  or the app window (app/)
                                 │                   ~/.claude  (Claude Code's own state)
                                 │                   git / gh  (worktrees, PRs, tags)
                                 └──writes──▶        one line move, committed in the tracker's repo
                                                     ~/.claude/session-console, ~/.claude/console-sessions
```

## The three layers

**`server.ts`** is the whole HTTP surface: static files from `web/`, and every `/api/*`
endpoint dispatched from one router. It holds no business logic of its own; each route calls
into a `src/` module. Nothing in it assumes a browser tab, because it is also the Electron main
process (M3, M15).

**`src/*.ts`** is the model, one module per concern:

| Module | Concern |
|---|---|
| `config.ts` | every environment-specific value, overridable by `SESSION_CONSOLE_*` env |
| `project-config.ts` | what a project's `maverick.json` says about flying a mission in it |
| `projects.ts` | the project registry, tracker detection, the Finder import |
| `trackers.ts` | parse a markdown tracker into sections/groups/items, and apply a move |
| `releases.ts` | versions from the changelog plus merged PRs, and the two planned slots |
| `ships.ts` | a ship run: saved, resumable steps for one version |
| `missions.ts` | a mission: the Strike Lead's interview, the plan, the flight of Wingmen, their RIOs |
| `questions.ts` | what a mission is asking its person (`questionsOf`) and its one status word (`statusWord`); pure |
| `feed.ts` | the ledger's `## Log` read back as typed feed entries for the page (`feedOf`); pure |
| `notify.ts` | which questions are new since the last poll (`newQuestions`), for the app's notification; pure |
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

## The mission page and the inbox (M20)

`web/mission.js` is the shell of the mission page: the bar, the rail with the status word and
the four anchors (The ask, Plan, Progress, Result), the brakes, and The ask itself. Plan,
Progress and Result are modules under `web/mission/`, one file each with its own stylesheet, and
the shell loads them once the plan is approved. The contract, written out at the top of
`web/mission.js`:

```
web/mission/<name>.js exports
  mount(host: Element, view: MissionView, ctx): { update(view: MissionView): void }
web/mission/<name>.css is its stylesheet, linked from mission.html
```

- `host` is the module's own `<section>` (`#plan`, `#progress`, `#result`). The module owns
  everything inside it, its heading included; the shell never writes into it after the mount.
- `view` is the JSON of `GET /api/missions/:id`. `update(view)` is called on every stream event
  and patches in place, so an open session or a half-typed note survives it.
- `ctx` is `{ el, text, btn, lamp, api, post, act, projectId, missionId, openSession, fmtTime }`.
  `act(path, body, said)` posts to `/api/missions/<id>/<path>`, sets the status line and
  refreshes every module; `openSession(taskId, under)` mounts the task's session (its RIO's while
  reviewing, its Wingman's otherwise) as a terminal under `under`.

The page is fed by the stream route, `GET /api/missions/:id/stream`: it sends the whole view as
`data: <MissionView>` on connect and again whenever the mission record or its ledger changes (a
file watcher, with a one-second poll behind it), and `: ping` every 15 s. When the stream drops
twice in a row the page polls every 8 s until it can open it again.

What a mission asks is computed once, in `src/questions.ts`, and read by every surface: the
page's Progress pins it, `web/inbox.js` draws it as strips in the workspace's Needs you group,
and the Electron shell (`app/main.mjs`) polls `GET /api/workspace` for each project every 15 s
and passes each project's questions through `newQuestions` (`src/notify.ts`) to show a macOS
notification once per new question. The workspace in `web/command.js` is the inbox: four groups,
always in this order, Needs you, Working, Ready to review, Done.
It is where the app starts: with no project in the URL, `web/app.js` reopens the last project
it showed (kept in `localStorage`), on the workspace; `/?pick` asks for the picker by name.

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
