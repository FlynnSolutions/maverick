---
owner: claude
mode: reference
---
# Conventions

Patterns and gotchas. The binding rules are [`../RULEBOOK.md`](../RULEBOOK.md) (repo scope) and
[`../.ui-design/system.md`](../.ui-design/system.md) (the UI contract). This slot holds the
working practice around them.

## Code

- **Consistency within a file beats any rule here.** Read the neighbours first.
- **Nothing machine-specific in source.** Paths, ports and hosts resolve through
  `src/config.ts` (`SESSION_CONSOLE_*` env, then defaults). No literal `~/...`.
- **One concern per commit.** A drive-by refactor is a separate commit.
- **Fail loud.** Never swallow an error to make something pass.
- Commit subjects are lowercase and plain, describing what changed in the product's own
  vocabulary ("formations replace the dock"), not the file list.

## The UI

- `.ui-design/system.md` is a contract: every line is there because breaking it caused a real
  defect. Strips, lamps, reticles, racks and the callsign vocabulary are the visual language;
  do not start a second one alongside it.
- `web/jet.js` is traced from a photograph. **Regenerate it, never hand-edit it.**
- Action effects (flyby, contrail, missile, flares) deliberately ignore `prefers-reduced-motion`
  because they are the product; the ambient contrail respects it.

## Verify by looking, not by asserting

`node tools/cdp.mjs <url> --shot out.png` and `--eval file.js` drive headless Chrome over the
DevTools protocol; see [`../tools/README.md`](../tools/README.md). Two real defects here were
invisible in the CSS and obvious in a computed style, so **measure**: contrast ratios from
computed colours, element boxes for alignment, `scrollWidth` vs `clientWidth` for overflow. Give
a page 6 to 9 seconds to settle.

## Gotchas

- **Maverick does not compute session status.** Interactive sessions carry what Claude Code's
  registry says; background agents carry `state` from `claude agents --json --all`. A wrong
  status is usually a reporting bug here, not a state bug there.
- **Tracker writes are one line move, committed immediately**, in the tracker's own repo. A
  no-op edit must commit nothing.
- **Another session may be working the same repo.** Commit scoped to the files you touched;
  `git add -A` in this repo has already swept an unrelated deletion into an unrelated commit.
- PR-to-version assignment reads the last 400 merged PRs per repo, so old versions undercount.
