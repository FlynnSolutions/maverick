---
owner: claude
mode: how-to
---
# Runbook

## Run it

```bash
node server.ts                               # http://localhost:8766
SESSION_CONSOLE_HOST=0.0.0.0 node server.ts  # also reachable from a phone, behind the access key
```

Node 22.18+ runs the TypeScript directly. There is no install step and no dependencies, so a
clone runs immediately.

On first open you get the project picker. Import a directory (native folder dialog) or paste a
path; Maverick finds the tracker files it recognises and remembers the project in
`~/.claude/session-console/projects.json`.

## Run it as an app

```bash
cd app && npm install     # the only install in the repo: Electron and its builder
npm start                 # the same server, in a window
npm run build             # app/dist/Maverick-<version>-arm64.dmg and .zip
```

The app imports `server.ts` as its main process, so everything below about ports, env and data
applies to it unchanged. If a `node server.ts` is already listening on the port, the app opens a
window onto it and starts nothing. `--source <checkout>` (also `MAVERICK_SOURCE`, and the app
menu's "Open with a source checkout...") runs that checkout's `server.ts` instead of the packed
copy; whenever the window shows a server that is not packed, the bar wears a `development` badge
naming it, read off `GET /api/about` (`source`, `packed`). A release is cut by pushing a `v*` tag: the Release workflow
builds the macOS app (arm64, unsigned) and attaches it to the GitHub Release. Run by hand from
the Actions tab it uploads the build as an artifact without cutting a release.

## Configure it

Everything environment-specific is in `src/config.ts` and overridable by env:

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_CONSOLE_PORT` | `8766` | listen port |
| `SESSION_CONSOLE_HOST` | `127.0.0.1` | `0.0.0.0` opens it to the LAN; non-loopback clients need the key from `~/.claude/session-console/access-key` once (`?key=`), then a cookie |
| `SESSION_CONSOLE_HOME` | `~/.claude/session-console` | projects, release labels, access key, usage cache |
| `SESSION_CONSOLE_SESSIONS` | `~/.claude/console-sessions` | session records and ship runs |
| `MAVERICK_BROWSER` | `Google Chrome` | the Chromium browser the app sends outside links to, into one reused tab (macOS) |

## Session records

```bash
bin/session-open  --role driver --loop "v1.9 ship" --exit "develop promoted" --project Realtime
bin/session-close --id <id> --status handed-off --handoff "path/to/plan.md section 8"
```

`CLAUDE_SESSION_ID` from the environment is used as the id when present.

## Test it

```bash
npm test          # node --test "test/**/*.test.ts", no dependency, no build
npm run lint      # node --check over every file (tools/lint.mjs); CI runs both
```

That covers the mission plan parser and the tracker, including the claim the mission design
rests on. Everything else is still checked with the browser harness:

```bash
node tools/cdp.mjs http://localhost:8766/?view=workspace --shot out.png
node tools/cdp.mjs http://localhost:8766/ --eval check.js
```

It drives headless Chrome over the DevTools protocol. See [`../tools/README.md`](../tools/README.md).
Measure computed styles and element boxes; do not assert from the CSS. Allow 6 to 9 seconds for
a page to settle.

## Configure how a mission flies in a project

A mission uses Maverick's own conventions unless the project's `maverick.json` says otherwise.
A project with its own worktree tooling should say so, because a second convention beside the
first is what the tooling was usually written to stop.

```json
{
  "callsign": "Orbit",
  "missions": {
    "worktrees": "worktrees",
    "branchPrefix": "feature/",
    "land": "pr",
    "repos": {
      "contracts": { "base": "main" },
      "orbit-api": { "base": "develop" },
      "orbit-web": { "base": "develop" }
    }
  }
}
```

| Key | Default | Means |
|---|---|---|
| `wingmanAgent` | none | the Claude Code agent a Wingman runs as, carrying its standing orders: own one task, do not widen it, never push or merge, never grade its own work. It is focus rather than a fence — a Wingman needs `Bash` to run the repo's tests, and it may use subagents. Resolved from `~/.claude/agents/` or the project's own `.claude/agents/`. The gate says whether one is set; see [`03-decisions.md`](./03-decisions.md) M5 |
| `rioAgent` | `rio` | the agent a RIO runs as: `.claude/agents/rio.md`, which reads, runs and judges, and has no Edit or Write (install it beside the Wingman, see the README) |
| `worktrees` | `.claude/worktrees` | where task and integration worktrees go, relative to the project |
| `branchPrefix` | `mission/` | a task's branch is `<prefix><mission>-<task>` |
| `land` | `merge` | the default for every repo: `merge` leaves the work on that repo's mission branch, `pr` pushes and opens a pull request against its base, `push` fast-forwards the base to it |
| `shared` | none | environments only the merged mission branch may deploy to; a task that claims one is refused at the gate, and every brief names them |
| `proof` | none | a command run detached in the integration worktree after each milestone merges (`npm test`, say); a failure holds the milestone, and a merged milestone is not done until it passed |

A Wingman's shell carries `MAVERICK_TASK` (its task id) and, when the project names shared
environments, `MAVERICK_SHARED` (the list), so a project's own deploy or test scripts can refuse
what the brief forbids and name what they make.
| `repos.<dir>.base` | that repo's current branch | what its work is cut from and lands against |
| `repos.<dir>.land` | the mission's `land` | overrides it for that repo alone |

`push` reaches a shared branch without review, so it is opt-in per repo and never inherited
from the mission. It fast-forwards or it refuses; it never forces. The approval gate names
every repo that has it before you approve. A project whose services may not be self-merged but whose contract package lands directly
is `land: "pr"` with
`contracts: { "land": "push" }`, which is that project's own process written down.

Everything is optional. A repo the plan never names gets no branch, however many the project has.

## Follow a mission and answer it

The app opens on the workspace of the last project it showed; `/?pick` brings the picker back.
The workspace is the inbox (M20): Needs you, Working, Ready to review, Done. A mission's open
questions are strips in Needs you, answered there with the same buttons the mission page has.

A Wingman, a RIO, a walkthrough builder or the summarizer is a background Claude Code session,
and a finished one keeps its process up, idle, until it is told to stop. The sweep ends every
session a mission is done with on its next pass: one whose turn has finished while the sweep
still flies the mission (flying, blocked or paused), and past the review gate any Wingman or
RIO it still seats, whatever it is doing; a walkthrough builder or the summarizer, which run at
the gate, only once finished. A task handed back ends its Wingman and its RIO as it forgets them. `claude agents --json --all` carries a `pid` exactly
while a session's process is up, and that is what the sweep reads.

The mission page reads one stream. To watch it by hand:

```bash
curl -N "http://localhost:8766/api/missions/<id>/stream?project=<project>"
```

It sends `data: <MissionView>` on connect and again within about a second of the mission record
or its ledger changing, and `: ping` every 15 s. If the page loses it twice in a row it says so
on the status line and polls every 8 s until the stream answers again.

The Strike Lead's chat (in Plan before approval, at the bottom of Progress after) is the `say` route:

```bash
curl -s -X POST "http://localhost:8766/api/missions/<id>/say?project=<project>" \
  -H 'content-type: application/json' -d '{"text":"hold milestone 2, the API is wrong"}'
```

It answers `{ "ok": true, "sent": true }` at once; the Strike Lead's reply lands in the record's
`chat` a turn later (seconds to minutes; `leadBusy` on the view is true meanwhile). A round of
questions is answered with `{"answers": {"<question id>": {"options": ["..."], "other": "..."}}}`
instead of `text`. Once the mission is approved the text is also appended to the ledger, folded
to one line, as `decision: Cory to the Strike Lead: <text>`; a ledger that refuses it is trouble
on the mission, and the chat still has it. An empty reply is a 400. A turn that fails is a
`Maverick` entry in the chat saying why, and is not retried on its own.

Each turn is `claude -p --output-format json --json-schema <LEAD_SCHEMA>` in the project, the
first with `--session-id`, every later one with `--resume` on the same id (`mission.lead`). To
watch one by hand: `claude --resume <mission.lead.sessionId>`, which is what **open its session
in a terminal** (`POST /api/missions/<id>/interview`) opens.

## Read the ledger

The plan on the mission branch ends in a `## Log`, one bullet per move, only ever appended to
(M18). A task that passes with notes says how many, never what (M22):

```
- 2026-10-14 09:48 m1-t1 The ledger line and the feed entry: reviewing to passed (RIO: pass with notes) with 10 notes carried, 1 unverified
```

`, <M> unverified` is left off when there are none, and a plain pass ends at its verdict. The
notes themselves are on the task's `carried` in the record and in its RIO's findings file; the
report and the Result read them there. A decision line keeps the person's whole note.
A hand-back by the review rule ends `with <N> blocker(s) open; this one is yours`.

A ledger written before this still reads: a pass line ending in a `[carried: <note>; <note>]`
block shows on the page as the same counts, with the block cut off. Nothing rewrites the old
file, so the block is still there when you open it.

## Read the result

The Result section is the mission's findings in three buckets (M21): Fix before merge,
Unverified, Fine to ship. Each finding's `read` checkbox and `later` button post the readings
route, with the finding's `key` from `view.readings`:

```bash
curl -s -X POST "http://localhost:8766/api/missions/<id>/tasks/<task>/readings?project=<project>" \
  -H 'content-type: application/json' -d '{"key":"<task>:<8 hex>","state":"later"}'
```

It answers the mission. `state` is `read` or `later`; a missing key or state, an unknown task or
a key no finding of that task has is an error. `later` also appends one line under the backlog
heading of the project's first tracker, `` - [ ] `[ENG]` **<headline>** (from mission <id>,
<task title>; <area>) ``, commits it, and logs it to the ledger; it is not written twice. A
project whose first tracker has no backlog heading refuses it. There is no unmark.

The `summarize` button above the buckets is the summarize route:

```bash
curl -s -X POST "http://localhost:8766/api/missions/<id>/summarize?project=<project>"
```

It answers the mission with `summary.started` set, and spawns one session as the `rioAgent`
with the RIO's tool list (no Edit or Write), briefed with the report and the readings. That
session writes three bullets to `<record dir>/<id>-summary.md`, beside the record in `console-sessions/missions/<project>/`;
the sweep reads it once the session is over and the record carries `summary: { at, text, raw }`,
or `summary.failed` with why. The summary is three bullets by rule (M22): the brief asks for
exactly three, each under twenty words, and `text` keeps only the first three list items of what
the session wrote, each cut at its first line, whatever it sent; `raw` is the whole of it. It is refused while nothing has merged and while a summary is already
running. A summary asked again replaces the last one.

**The notification** comes from the app, not the server: `app/main.mjs` polls
`GET /api/workspace?project=<id>` for every registered project every 15 s and shows a macOS
notification for each question that was not there on the previous poll (`src/notify.ts`). The
first poll of a project only remembers, so opening the app does not announce what was already
waiting. Clicking one brings the window up on that mission's Progress, replacing whatever page
was open. A project whose workspace read fails logs `question poll for <id>: ...` on every poll.
`node server.ts` in a browser tab shows no notification.

That poll has a side effect: `GET /api/workspace?project=` sweeps the project's missions before
it answers, so while the app is open each project's missions are swept every 15 s, on top of
the server's own sweep every 60 s; that is Cory's call (M20). A project with nothing in the air
only has its mission list read.

## Check its agent readiness

```bash
npx @kodus/agent-readiness . --ci --no-web --no-color
```

Use `--ci --no-web`: without `--no-web` the tool starts a dashboard and blocks. Level 1 at 60%
as of 2026-10-07 (6% on 2026-09-16); what Level 2 needs is in [`04-status.md`](./04-status.md).

## Deploy it

Nothing to deploy. It is a local, single-user process. Packaging is the Electron shell above,
and a release is a tag.
