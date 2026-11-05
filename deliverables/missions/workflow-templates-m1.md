# Mission: Workflow templates, milestone 1

Today's mission flow, hardcoded in `src/missions.ts`, becomes a built-in template, `src/workflows/mission.json`, that every mission pins when it starts and actually runs from, behaving identically for every existing mission. This is the first brick of composable workflows (Cory, 2026-11-04: build inside Maverick, borrow Archon's ideas). It is deliberately not project templates, a picker, any UI, the canvas, skill or agent import, cost per run, an audit trail, other providers or any new dependency, and there is no change to a mission's page, ledger format or landing. No path lets a person choose a non-default template yet, so leaving out proof or a walk is reachable only from a test; whether an unverified run may land is Cory's question for the next milestone and this one does not answer it. The run ends with the work on the mission branch. Cory's call: a normal session after the run does the real `/simplify` and opens the pull request against `main`, with what `/simplify` caught under "Verified" and "Not verified" sections, and never merges it. No Wingman pushes, opens a pull request or runs that pass.

## Milestone 1 — Today's flow runs from a template

_done when: on the mission branch, `npm test && npm run lint` pass; `git diff --name-status main...HEAD -- test/` lists only added files, so no existing assertion changed; `test/mission-flight.test.ts` is byte-identical to the commit that first passed on unrefitted code, and it seeds its records with no template, so an older record loads, runs and lands as the default; `test/workflow-flow.test.ts` proves through the real sweep that a template leaving out proof and walkthrough skips them and that one naming another agent launches it for build, review, walkthrough and summary; and `git diff --stat main...HEAD -- web/` prints nothing._
_walk: Run `npm test && npm run lint` on the mission branch, then `git diff --name-status main...HEAD -- test/`, and see everything pass with only added test files; Read `src/workflows/mission.json` and see today's flow in the order the code runs it; Make `workflowOf` ignore a pinned template by hand, run `node --test test/workflow-flow.test.ts`, see the template tests fail, then restore it, so the template is driving and not decorating; Run `node --test test/workflows.test.ts` and see the validator refuse a reordered template, an unknown stage, an unknown kind and a template missing the merge, each with a message naming the stage; Run `git log --format=%s -- test/mission-flight.test.ts` and see only the commits of the first task, none from the refit, so the full flight passes untouched; Run `git diff --stat main...HEAD -- web/` and see nothing, so nothing a person sees changed_

- [x] **The full flight, proved on today's code**
  - touches: test/mission-flight.test.ts
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: 03068e2
  One new test file that drives invented missions through the whole flow with the real `src/missions.ts`, a fake `claude` first on PATH and real git in temp repos, and pins today's behaviour before anyone refits it. This task changes no file under `src/` and no existing test: it must pass on the code as it stands, because it is the before half of a before and after. No later task may change this file. That is the proof the flow stayed identical.

  Copy the fixture approach from `test/missions.test.ts` (the fake `claude` around its line 925, `agentsSay`, `spawnedWith`, `summaryFixture`) and the rule in `test/mission-store.test.ts` that `SESSION_CONSOLE_SESSIONS` is set before `src/missions.ts` is imported. The fake must append every spawn's arguments to a log, so the test reads the whole sequence. The test plays each session's part between sweeps: commit on the task's branch and mark its agent finished, write a RIO's verdict to `task.review.file`, write a filled walkthrough document where `walkthroughFile` says. Two things will bite: the agent listing is cached for 20 seconds per project path (`agentsFor`), and `sweepSoon(project, sweepMissions, 0)` drops it where `sweepMissions` alone does not; the proof runs detached, so a test sweeps until `m.proof` appears.

  First scenario, `land: "merge"`, with a project proof command and one milestone of two tasks where the second needs the first. A record with no template field, written as a record is today, goes through `approveMission`, then: Wingman, RIO, a failing RIO verdict and the retry with a fresh Wingman, a pass, the needing task, merge onto the mission branch, proof, walkthrough builder, a walk through `recordWalkthrough` with one failed case, the fix task `m1-fix1` (M29), a re-walk, then `closeMission`, then `summarizeMission`. Second scenario, `land: "pr"`, with a fake `gh` on PATH and a local bare remote: it proves landing happens after proof and before the walkthrough builder, as `catchUp` does today, and is not repeated at close. Assert literally: the ordered list of spawns with each one's name and `--agent` and `--tools` values (a walkthrough builder has no `--agent`, a summary runs as `rio`), the final status of the mission and each task and milestone, and the ledger's lines as `writeThenSync` wrote them.

  Prove it: `node --test test/mission-flight.test.ts`, then `npm test && npm run lint`, on a branch with no change under `src/`. Put both results in the commit message. If today's code cannot be driven this way without changing `src/`, stop and say what is in the way; do not change `src/` to make it testable.

- [x] **The template, its loader and its validator**
  - touches: src/workflows.ts, src/workflows/mission.json, test/workflows.test.ts
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: 3233986
  Create the template and the pure module that answers questions about it. `src/workflows.ts` reads no mission state from disk, spawns nothing and imports nothing from `src/missions.ts`. It may not touch `src/missions.ts`, `src/questions.ts` or `src/preflight.ts`; later tasks wire it in. Match the neighbours: plain TypeScript run directly by Node, no build step, no dependency, lowercase plain comments. The template is JSON because the project allows no YAML parser. Find the template's file with `new URL("./workflows/mission.json", import.meta.url)`, as `WALKTHROUGH_TEMPLATE` finds its file, because the packed app carries `src/**` as plain files (`app/electron-builder.yml`). Nothing machine-specific.

  `src/workflows/mission.json` follows the code's order, by Cory's call, not the older list that had land and summary after the walk. In order: `interview`, `plan-gate`, `preflight`, then a `for-each` over `milestones` holding (a `for-each` over `tasks` holding `build`, `review`), `merge`, `proof`, `land`, `walkthrough`, `walk`; then `close`, then `summary`. Landing is inside the milestone because `catchUp` lands `pr` and `push` repos after proof and before the walkthrough. `close` is `closeMission`, which tries landing again and ticks the tracker. `summary` is on demand, the button at `summarizeMission`; nothing runs it automatically. The retry after a failed review stays part of `review` with `MAX_ATTEMPTS` as its limit, and the fix round stays part of `walk`. `build` takes slot `wingmanAgent`, `review` and `summary` take slot `rioAgent`, `proof` takes slot `proof`, and `walkthrough` has no slot, so it launches with no `--agent` as today.

  The validator accepts only today's order. It refuses a reordered template, an unknown stage, an unknown kind, each with a message naming the stage. `proof`, `walkthrough` with `walk` (only together), and `summary` may be left out. Everything else, including `interview` and `preflight`, may not, and leaving one out is refused by name. An `agent` field is allowed only on `build`, `review`, `walkthrough` and `summary`; on any other stage it is refused by name, and an agent name must match the `AGENT` rule in `src/project-config.ts`, because it reaches the CLI as argv (reuse that rule, moving no code out of a file this task does not own: export nothing new from there, restate the pattern with a comment naming the source). `agentFor` returns a stage's own `agent`, else its slot's value, else undefined.

  Prove it: `test/workflows.test.ts` covers that the built-in template loads and validates; each refusal, with its message naming the stage; each permitted leaving-out; `walkthrough` without `walk` refused and the reverse; `agentFor`'s three answers; `hasStage`; `workflowOf` returning a pinned copy when there is one and the default when there is none. `npm test && npm run lint`, results in the commit message.

- [x] **A mission pins its template when it starts**
  - touches: src/missions.ts, test/workflow-pin.test.ts
  - needs: m1-t1, m1-t2
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: 597b328
  `startMission` in `src/missions.ts` sets `template: defaultWorkflow()` on the new record, and the `Mission` interface gains `template?: Workflow`. The copy holds slot names, never resolved values: `maverick.json`'s `wingmanAgent`, `rioAgent` and `proof` are read at use, because `sweepOnce` deliberately follows the project mid-flight today and that stays. So editing a template file never changes a mission in flight, and editing `maverick.json` still does, exactly as now. A record with no `template` reads as the default through `workflowOf` and is never written back. Add no migration. This task changes no behaviour of the flow and consults the template nowhere else; the next tasks do that. The page reads nothing from the new field, and do not touch `web/`, the ledger format or `applyPlanState`. If an existing test breaks because a record gained a field, stop and say so: no existing assertion may change.

  Prove it: `test/workflow-pin.test.ts` proves a started mission carries the template on disk; changing the template the loader would return leaves that record's copy unchanged; a pre-existing record with no field, read and swept and written, still has no field and answers `workflowOf` with the default; and `test/mission-flight.test.ts` passes untouched. `npm test && npm run lint`, results in the commit message.

- [x] **The template says who runs a stage**
  - touches: src/missions.ts, src/preflight.ts, test/workflow-flow.test.ts
  - needs: m1-t3
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: 977fbac
  Every place the flow spawns an agent asks the mission's template, through `agentFor(workflowOf(mission), <stage>, cfg)`, instead of reading the slot directly. These are the sites in `src/missions.ts`: `launch` and `handBack` (`build`), the RIO spawn in `actOn` (`review`), `commissionWalkthrough` (`walkthrough`, which passes no agent today and must still pass none under the default), and `summarizeMission` (`summary`). A named agent on `review` or `summary` keeps `RIO_TOOLS` as its fence: the template changes who runs, never the fence. Leave the Strike Lead's interview turns and the collision resolver as they are: they refuse an `agent` by Cory's call. `preflightFor` and `src/preflight.ts` check every agent the mission's template will launch rather than only the two slots, through an optional new input, so the default's checks stay the same names in the same order and `test/preflight.test.ts` passes unchanged. `previewPlan`'s `wingmanAgent` answers through the template as well. Refit, not rewrite: the statuses, `sweepOnce`, `gates` and the ledger stay. If a change looks like rewriting the sweep, stop and record it.

  Prove it: new `test/workflow-flow.test.ts`, with its own fake `claude`, drives through the real sweep. A pinned test template that names another agent for each of `build` (first launch and the retry through `handBack`), `review`, `walkthrough` and `summary` makes that stage's spawn carry that `--agent`. With the default pinned, a `wingmanAgent` and a `rioAgent` set in the project's `maverick.json` are the ones launched, so no project changes anything. Preflight fails on a pinned agent that is not installed. Then make `workflowOf` ignore the pinned copy, run the new test, show it failing, restore, and put that output in the commit message. `test/mission-flight.test.ts` passes untouched. `npm test && npm run lint`, results in the commit message.

- [x] **The template decides whether proof and a walk happen**
  - touches: src/missions.ts, src/questions.ts, test/workflow-skip.test.ts
  - needs: m1-t4
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: c2bb475
  The flow consults the template where it decides on the stages that may be left out. Proof: `mission.proofRequired` in `approveOnce` and `sweepOnce` becomes `Boolean(cfg.proof) && hasStage(<template>, "proof")`; the proof start in `catchUp` is guarded the same way; `briefContext` passes no proof to a Wingman or RIO brief when the stage is absent. Walk: `commissionWalkthrough`'s call in `catchUp` is skipped without the stage, and a milestone with no walk stage does not need walking. Keep `needsWalking(m)` in `src/questions.ts` as it is, because existing tests call it with one argument and `closeMission` passes it straight to `filter`, which would hand an index to a new second parameter. Add `owesWalk(mission, m)` beside it and move `done`, `notBase`, `toWalk`, `closeMission` and `missionView` onto it, with `mission` staying optional-template so the existing partial fixtures read as the default. Summary: `summarizeMission` refuses with a message naming the stage when it is absent. The stages that may not be left out (`plan-gate`, `build`, `review`, `merge`, `land`, `close`) have nothing to decide in this milestone: the validator guarantees them, so no code asks. Add no question for a person and no word on the page: without a path to a non-default template nobody reaches this but a test. Refit, not rewrite, as in the task before.

  Prove it: new `test/workflow-skip.test.ts` drives through the real sweep with a project proof command that writes a sentinel file. A pinned template with no `proof`, no `walkthrough` and no `walk` merges, runs no proof (no sentinel), spawns no builder, reaches `review`, closes without a walk and starts the next milestone without one; its Wingman and RIO briefs carry no proof line. Leaving out `summary` makes `summarizeMission` refuse. The same fixture with the default template runs the proof, spawns the builder and holds on the walk. Then make `workflowOf` ignore the pinned copy, show the new test failing, restore, and put that output in the commit message. `test/mission-flight.test.ts` passes untouched. `git diff --stat main...HEAD -- web/` prints nothing. `npm test && npm run lint`, results in the commit message.

- [x] **The decision and the docs**
  - touches: docs/03-decisions.md, docs/01-architecture.md, docs/02-data-model.md, docs/07-glossary.md, README.md
  - needs: m1-t5
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: 69c9c9b
  Write the decision entry in `docs/03-decisions.md` as M32, in the shape of M31 (what happened, the shape, what stays, not known, rejected). It records: Cory's calls (build inside Maverick and borrow from Archon; ordered stages with fan-out, not a free graph; one JSON file; a mission pins its template; the template follows the code's order, with landing inside the milestone and summary on demand; agents can be named for build, review, walkthrough and summary; the pull request comes from a session after the run); that slots stay live from `maverick.json` while the template is frozen; that an older record reads as the default; that whether an unverified run may land is unanswered; and the rejected free graph and YAML. Say what the full-flight test pins. Then keep the rest true: the record's new field in `docs/02-data-model.md`, the module in `docs/01-architecture.md`, a glossary line for a workflow template, and one short honest passage in `README.md` beside its passage on the Wingman and RIO agents in `maverick.json` (around line 344), which says `maverick.json` works as before and a person cannot pick another template yet. Read the code as merged on your branch, not this plan, for what you state. This repo is public: invented examples only, no real project paths. No em-dashes in anything you write. Do not touch `deliverables/CHECKLIST.md`, which Maverick owns while a mission flies, or any code.

  Prove it: `grep -n "^## M32" docs/03-decisions.md` shows the entry, the path `src/workflows/mission.json` exists as named in each doc that names it, and `npm test && npm run lint` passes. Put the results in the commit message.

## Contracts

- **Workflow** (owner: m1-t2): `{ id: string; stages: Stage[] }` where `Stage = { id: string; kind: "interview" | "gate" | "preflight" | "for-each" | "agent" | "merge" | "command" | "land" | "walk" | "close"; over?: "milestones" | "tasks"; stages?: Stage[]; slot?: "wingmanAgent" | "rioAgent" | "proof"; agent?: string }`, exported from `src/workflows.ts`.
- **Stage ids** (owner: m1-t2): `interview`, `plan-gate`, `preflight`, `milestones`, `tasks`, `build`, `review`, `merge`, `proof`, `land`, `walkthrough`, `walk`, `close`, `summary`.
- **defaultWorkflow** (owner: m1-t2): `defaultWorkflow(): Workflow`, synchronous, the validated `src/workflows/mission.json`, cached, so the pure gates in `src/missions.ts` can call it.
- **validateWorkflow** (owner: m1-t2): `validateWorkflow(raw: unknown): Workflow`, which throws an `Error` whose message names the stage.
- **loadWorkflow** (owner: m1-t2): `loadWorkflow(path: string): Promise<Workflow>`, which reads and validates one file.
- **hasStage** (owner: m1-t2): `hasStage(w: Workflow, id: string): boolean`, searching nested stages.
- **agentFor** (owner: m1-t2): `agentFor(w: Workflow, id: string, slots: { wingmanAgent?: string; rioAgent?: string }): string | undefined`, the stage's `agent`, else its slot's value, else undefined.
- **workflowOf** (owner: m1-t2): `workflowOf(m: { template?: Workflow }): Workflow`, the pinned copy, else `defaultWorkflow()`; structural so `src/workflows.ts` never imports `src/missions.ts`.
- **Mission.template** (owner: m1-t3): `template?: Workflow` on the record, set by `startMission`, never back-filled, absent on older records.
- **owesWalk** (owner: m1-t5): `owesWalk(mission: { template?: Workflow }, m: Milestone): boolean` in `src/questions.ts`, `hasStage(workflowOf(mission), "walk") && needsWalking(m)`.
- **The full-flight test** (owner: m1-t1): `test/mission-flight.test.ts`, seeded with no template; no other task changes it.

## Preflight

- duration: 8h
- tool: node
- tool: git
- runtime: node, 22.18 or newer as `package.json` pins
- human: Pull `main` from origin before firing (it is behind by the command center work) and commit the uncommitted backlog items in `deliverables/CHECKLIST.md` if they should not ride in the plan's commit; the plan cannot do this and takes the branch from local `main`
- human: Walk the milestone at the end, then have a normal session run the real `/simplify` and open the pull request; the plan stops at a green mission branch and never pushes


## Log

- 2026-11-04 21:11 m1-t1 The full flight, proved on today's code: pending to flying
- 2026-11-04 21:11 m1-t2 The template, its loader and its validator: pending to flying
- 2026-11-04 21:16 m1-t2 The template, its loader and its validator: flying to reviewing
- 2026-11-04 21:26 m1-t2 The template, its loader and its validator: reviewing to passed (RIO: pass with notes) with 7 notes carried, 2 unverified
- 2026-11-04 22:37 m1-t1 The full flight, proved on today's code: flying to reviewing
- 2026-11-04 22:51 m1-t1 The full flight, proved on today's code: reviewing to passed (RIO: pass with notes) with 7 notes carried, 3 unverified
- 2026-11-04 22:51 m1-t3 A mission pins its template when it starts: pending to flying
- 2026-11-04 22:56 m1-t3 A mission pins its template when it starts: flying to reviewing
- 2026-11-04 23:00 m1-t3 A mission pins its template when it starts: reviewing to passed (RIO: pass with notes) with 10 notes carried, 2 unverified
- 2026-11-04 23:00 m1-t4 The template says who runs a stage: pending to flying
- 2026-11-04 23:14 m1-t4 The template says who runs a stage: flying to reviewing
- 2026-11-04 23:21 m1-t4 The template says who runs a stage: reviewing to passed (RIO: pass with notes) with 9 notes carried, 1 unverified
- 2026-11-04 23:21 m1-t5 The template decides whether proof and a walk happen: pending to flying
- 2026-11-04 23:32 m1-t5 The template decides whether proof and a walk happen: flying to reviewing
- 2026-11-04 23:42 m1-t5 The template decides whether proof and a walk happen: reviewing to passed (RIO: pass with notes) with 9 notes carried, 3 unverified
- 2026-11-04 23:42 m1-t6 The decision and the docs: pending to flying
- 2026-11-04 23:47 m1-t6 The decision and the docs: flying to reviewing
- 2026-11-04 23:51 m1-t6 The decision and the docs: reviewing to passed (RIO: pass with notes) with 6 notes carried, 2 unverified
- 2026-11-04 23:51 merged: milestone 1 (Today's flow runs from a template) is on the mission branch
- 2026-11-04 23:52 merged: milestone 1 (Today's flow runs from a template) is on the mission branch
- 2026-11-04 23:53 merged: milestone 1 (Today's flow runs from a template) is on the mission branch
- 2026-11-04 23:54 merged: milestone 1 (Today's flow runs from a template) is on the mission branch
- 2026-11-04 23:55 held: milestone 1 (since 2026-11-05T07:55:18.497Z): the proof failed after milestone 1 merged: # skipped 0 | # todo 0 | # duration_ms 212930.354917
- 2026-11-05 11:09 decision: Cory to the Strike Lead: "m1-t3 found the drop-over-Notes bug in m1-t1's AddRow; add a fix task for it, then rerun m1-t3.
- 2026-11-05 13:31 decision: milestone 1 released by Cory: Proof reported 2 of 294 failing at 23:51; names lost to the 4000-character output limit. Reran twice on this merged code on 2026-11-05: 294 of 294, lint clean. Cause not identified, likely flaky or load. Cory chose to release and re-prove.
- 2026-11-05 13:31 merged: milestone 1 (Today's flow runs from a template) is on the mission branch
- 2026-11-05 13:32 merged: milestone 1 (Today's flow runs from a template) is on the mission branch
- 2026-11-05 13:33 merged: milestone 1 (Today's flow runs from a template) is on the mission branch
