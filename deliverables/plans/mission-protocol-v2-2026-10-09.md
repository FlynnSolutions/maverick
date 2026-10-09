# Mission protocol v2: what the first overnight mission taught

Written 2026-10-09 from an outside observer's audit of the first full Maverick mission: a Strike
Lead, one Wingman per task in its own worktree, an independent RIO per task, 9 milestones and 27
tasks planned, run from a plain Claude Code session rather than the app. 7 of 9 milestones merged
in about 10.5 hours: 22 tasks, 48 review rounds, 928 tests, no hard limit broken. The full
evidence log is under `deliverables/audits/`. It names a client and is excluded locally; it must
never be committed to this repo. Nothing in this plan or in anything
built from it names the client or its account.

## The finding in one line

Independent review worked. Almost every stumble was coordination between parallel agents, or a
lesson learned by one agent that never reached the next, because every brief was written by hand
and the mission's state lived in the Lead's head.

## The changes, ranked by what they would have saved

| # | Change | The proof from the night |
|---|---|---|
| 1 | Mission state lives in the plan file on the mission branch, committed after every transition: task status, attempt, verdict, commit, decisions. A fresh Lead can resume from the file. | A subagent's cleanup deleted half the Lead's ledger in the shared scratchpad; recovery worked only because the Lead's context still held it. |
| 2 | Every brief is generated from one template: absolute paths, the standing orders, a "fixes" list, the RIO checklist. A lesson added once reaches every later agent. | The plan-path miss happened 6 times over five hours and was never fixed by hand. |
| 3 | A contracts step before fan-out: shared types, ids, codecs, env flags and every function a task imports but does not own get an owner and a signature first. | Parallel Wingmen invented shared conventions; a reconcile task had to be added; duplicated schema edits. |
| 4 | `touches` and `needs` per task, checked mechanically by the Wingman before hand-back, the Lead before review, the RIO in review. `needs` lets the scheduler start a task when its dependencies pass, not at milestone boundaries. | Four shared files across three tasks despite ownership lists; one straggler idled a whole milestone. |
| 5 | Wingmen get the RIO checklist up front: vacuous assertions, secrets, deployed-state verification, accessibility, background processes, tests that fail on the parent commit. | 0 of the first 8 tasks passed first time; the only early first-pass PASS was the most precisely briefed task. |
| 6 | Verdicts split BLOCKER from NOTE, plus PASS WITH NOTES. A task out of retries with only NOTE-level findings may merge with them carried; an open BLOCKER stops it and its dependants. | The Lead overrode the stop rule once to merge a task with one low-severity finding; three rounds spent on hypotheticals. |
| 7 | Shared-environment rules: one deployer per stack per milestone; only the merged mission branch deploys to the shared dev URL; per-task test queues and tenants, created and deleted by the test; knobs live in the stack. | Dev ran unmerged task branches twice; two deployers flipped the worker count; queue races; test debris. |
| 8 | Gate-1 preflight: toolchain pins against the host, credential lifetime against expected duration, secrets by name, human-sense steps (inbox, passkey, real login) substituted or marked human-verified, the action classes the mission needs pre-approved, host OS (BSD userland on macOS). | Node 22 vs 24; `timeout` missing; SSO expired mid-mission; 6 permission denials; real sign-in never verified. |
| 9 | Harness standing orders: background plus a wait loop, never a foreground `sleep`; export AWS env vars, never pass options through a variable; one check per command; probes in an ignored `.scratch/` inside the worktree; delete only literal paths, never `rm -rf "$(cat file)"`; append commits, never amend after review; stop every background process before hand-back. | Foreground sleep hit 6 agents; the unsafe delete twice; probes outside the worktree failed to resolve packages. |
| 10 | Merge discipline: union, never drop a rule a passed task added; re-run each merged task's own proofs plus the milestone done-when; drift check for infra; remove merged worktrees. | A security lint rule dropped at a merge; 5.9 GB of stale worktrees. |
| 11 | Required report sections: decisions made without the human; amendments to fixed decisions; denied actions and why; unverified steps; blocked vs passed proofs; spend by key; resources created outside stacks; observer and auditor findings unedited. | The interim report missed three incidents; one report line claimed an audit that had not run. |
| 12 | Ship the protocol as a Strike Lead skill, an installed read-only `rio.md` agent beside `wingman.md`, and `maverick plan-check <file>`. | The Lead spent its first five minutes reverse-engineering the protocol and reimplemented the plan parser. |
| 13 | Pause, do not end, on an environment block. Commit state, keep running tasks that do not need the blocked resource, resume on re-login. | The mission closed at milestone 6 and cut the human's central feature, though its UI needed no cloud access. |
| 14 | The Lead writes no product code. Glue, conflict resolution beyond keeping both sides, and fixture repair go to a fast RIO pass or the reconcile task. | The Lead's unreviewed wiring broke tests within minutes and reached dev before any review. |
| 15 | Structural fixes for recurring conflicts, e.g. one file per job rather than a shared registry. | The job registry collided in four milestones in a row. |
| 16 | Enforce prohibitions in the environment, not in prose: a brief that forbids live calls withholds the token. | A Wingman made two live reads against its brief. |
| 17 | LLM output gets an eval and a sample in the report; "read the output against the input" is a standing RIO check. | A generator never saw the product image and produced schema-valid campaigns about an invented product; one RIO caught it on its own initiative. |

Smaller items from the log worth folding in: the mission owns one keep-awake with a timeout and
kills it at the end; `.claude/worktrees/` goes into the target's `.git/info/exclude` before any
worktree is made; each subagent gets its own scratch path and may delete only inside it; a RIO
for a task with siblings in the same milestone is told the siblings and asked what happens when
they merge; spikes record units and semantics for every metric they touch; a RIO reconciles any
derived number against an independent source; a cost estimate at gate 1 outside the app; agent
commits carry an agent identity or trailer, not only the human's.

## Built 2026-10-09, on `feat/protocol-v2`

Changes 1, 2, 4, 5, 6 and 12 of the table above, as five bricks with a test or a check each, each
reviewed by an independent RIO before the next. Decisions M18 and M19. Not built: 3 (the
contracts step), 7 to 11, 13 to 17, and dispatching by `needs`; those are the proposal that
follows this branch.

## Keep exactly as it is

The RIO's independence and depth. The Lead's split: enforce the fixed decision now, escalate the
change to the human. The Lead's refusal, three times, to perform an action an agent was denied.
Amendments written into the architecture doc in the same commit as the code, with a reason.

## Where the protocol lives today

`BRIEF-rio.md`, `.claude/agents/wingman.md` (symlinked into `~/.claude/agents/`), `README.md`,
`docs/03-decisions.md`, `docs/06-runbook.md`, `docs/07-glossary.md`, `src/missions.ts`
(`parsePlan`), `web/mission.js`, `test/missions.test.ts`.

---

Paste into a fresh session in `~/Projects/maverick`:

> Read `deliverables/plans/mission-protocol-v2-2026-10-09.md`. It is the ranked list of protocol
> changes from the first overnight mission. The loop for this session: land protocol v2 for the
> top changes, in this order, one brick at a time, each with a test or a check I can run:
> (1) the plan file carries mission state and `parsePlan` reads it, (2) a brief template that
> generates Wingman and RIO briefs with the standing orders and the RIO checklist, (3) an installed
> read-only `rio.md` agent and `maverick plan-check`, (4) `touches` / `needs` in the plan format
> with a mechanical overlap check, (5) BLOCKER / NOTE verdicts and the merge-with-notes rule.
> Then propose how to ship the rest (preflight, pause-not-end, shared-environment rules, report
> sections) and stop for my call. The evidence log in `deliverables/audits/` names a client: read
> it, never commit it, and keep every client and account name out of this repo. Show me
> the plan before you build.
