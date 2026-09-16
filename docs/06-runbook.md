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

There is no test suite yet; `package.json` has no `test` script. Adding one is the first item
on the Priority lane. What exists instead is a browser harness:

```bash
node tools/cdp.mjs http://localhost:8766/?view=workspace --shot out.png
node tools/cdp.mjs http://localhost:8766/ --eval check.js
```

It drives headless Chrome over the DevTools protocol. See [`../tools/README.md`](../tools/README.md).
Measure computed styles and element boxes; do not assert from the CSS. Allow 6 to 9 seconds for
a page to settle.

## Check its agent readiness

```bash
npx @kodus/agent-readiness . --ci --no-web --no-color
```

Use `--ci --no-web`: without `--no-web` the tool starts a dashboard and blocks. Level 1 at 6%
as of 2026-09-16.

## Deploy it

Nothing to deploy. It is a local, single-user process. `server.ts` is written to become the
Electron main process later, which is how it would ever be packaged.
