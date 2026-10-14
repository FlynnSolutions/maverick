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
window onto it and starts nothing. A release is cut by pushing a `v*` tag: the Release workflow
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

The mission page reads one stream. To watch it by hand:

```bash
curl -N "http://localhost:8766/api/missions/<id>/stream?project=<project>"
```

It sends `data: <MissionView>` on connect and again within about a second of the mission record
or its ledger changing, and `: ping` every 15 s. If the page loses it twice in a row it says so
on the status line and polls every 8 s until the stream answers again.

The reply box at the bottom of Progress is the `say` route:

```bash
curl -s -X POST "http://localhost:8766/api/missions/<id>/say?project=<project>" \
  -H 'content-type: application/json' -d '{"text":"hold milestone 2, the API is wrong"}'
```

It answers `{ "ok": true, "sent": <bool> }`. The reply is folded to one line. Once the mission is
approved it is appended to the ledger as `decision: Cory to the Strike Lead: <text>`; `sent` says
whether it was also typed into the Strike Lead's terminal, which happens only while that terminal
is open. An empty reply is a 400; a reply with neither a ledger nor an open terminal to land in
is an error, not an ok.

**The notification** comes from the app, not the server: `app/main.mjs` polls
`GET /api/workspace?project=<id>` for every registered project every 15 s and shows a macOS
notification for each question that was not there on the previous poll (`src/notify.ts`). The
first poll of a project only remembers, so opening the app does not announce what was already
waiting. Clicking one brings the window up on that mission's Progress, replacing whatever page
was open. A project whose workspace read fails logs `question poll for <id>: ...` on every poll.
`node server.ts` in a browser tab shows no notification.

That poll has a side effect: `GET /api/workspace?project=` sweeps the project's missions before
it answers, so while the app is open each project's missions are swept every 15 s, on top of
the server's own sweep every 60 s. A project with nothing in the air only has its mission list
read.

## Check its agent readiness

```bash
npx @kodus/agent-readiness . --ci --no-web --no-color
```

Use `--ci --no-web`: without `--no-web` the tool starts a dashboard and blocks. Level 1 at 60%
as of 2026-10-07 (6% on 2026-09-16); what Level 2 needs is in [`04-status.md`](./04-status.md).

## Deploy it

Nothing to deploy. It is a local, single-user process. Packaging is the Electron shell above,
and a release is a tag.
