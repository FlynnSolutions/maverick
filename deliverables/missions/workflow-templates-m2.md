# Mission: Workflow templates, milestone 2

Composable workflows, milestone 2 (follows M32, PR #61). When Cory opens a mission he picks a template from cards. Maverick ships two built-ins, `mission` and `light`, and a project can keep its own at `<project>/.maverick/workflows/<id>.json`. Light is interview, plan gate, preflight, build, merge, land and close, with no RIO, proof, walkthrough, walk or summary. A run whose template leaves out review, proof or the walk is unverified, and unverified work stays on its mission branch: it may never land by pull request or push, refused at the plan gate and again at landing. The mission page says which template a mission runs, in a mono line under the title that links to a new read-only template page, and shows where the mission is in its template as a status strip in the rail. Cory's calls, 2026-11-06 and 2026-11-09, are settled and not reopened. Unverified work stays on its branch. A template may leave out review. The interview and plan gate stay required. Mission is preselected. The read-only template page is in this mission. The cards, strip, line and page follow the picks in `.ui-design/mockups/workflow-templates-round-1.html` (22, 28, 34, 39), with the flow drawn per editor round 1 (1, 7, 11). The one existing assertion allowed to change is the word `"review"` in the "may not be left out" list in `test/workflows.test.ts`. Deliberately not in this mission: editing or creating templates in a page (the canvas), reordering stages, leaving out the interview or plan gate, importing skills or agents, cost per run, an audit trail, other providers, phone control, and any new dependency. Project templates are written by hand as JSON. No dependencies, no build step, no database, and nothing machine-specific in the code. Fixtures use invented projects. The run ends with the work on the mission branch. A normal session after it runs the real `/simplify` and opens the pull request against `main`, with what `/simplify` caught under "Verified" and "Not verified" sections. Nobody merges during the run, and no Wingman pushes, opens a pull request or runs that pass.

## Milestone 1: Pick a template, fly Light, and keep unverified work on its branch

_done when: on the mission branch, `npm test && npm run lint` and `node tools/ui-check.mjs` pass; `git diff main...HEAD -- test/` changes no existing line except the word `"review"` dropped from the "may not be left out" list in `test/workflows.test.ts`, and `test/mission-flight.test.ts` is untouched; `test/workflow-light.test.ts` flies a Light mission through the real sweep to closed with only Wingmen spawned (no RIO, proof, walkthrough or summary); `test/workflow-landing.test.ts` proves the plan gate and landing each refuse an unverified `pr` or `push` repo, and fails when either guard is removed; ui-audit grades the new-mission dialog, the mission page (full and Light) and the template page A at 390 and 1280 wide in light and dark; and one real Light mission flown from the mission branch's own server closes with its work on its mission branch and nothing pushed._
_walk: Open a mission on the invented project from the mission branch's server and see four cards (Mission selected with the accent ring, Light with its unverified line, a project template, and a broken project file disabled with its validator message), then press Enter without changing anything and see a Mission open exactly as today; Pick Light for a one-task mission and answer the interview, and see the Strike Lead say there is no review, proof or walk and that the work stays on its mission branch, and see the plan fire with no walk line; Watch it fly: the status strip in the rail lists Interview, Plan gate, Preflight, Build, Merge, Land and Close and lights each in turn, one Wingman runs and no RIO, the mission reaches review and closes with one click, and the commit is on the mission branch with nothing pushed; Read the line under the Light mission's title ("runs light · unverified: stays on its mission branch"), click it, and see the template page draw only the stages Light runs; Open a full Mission's page and see "runs mission", every stage in the strip, and its template page; Set the invented project's maverick.json to land by pr, take a Light plan to the gate, and see preflight refuse it naming the repo and why; Edit a project template after a mission started from it, and see that mission's template page still show the copy it pinned; Read the ui-audit cards for the new-mission dialog, the mission page and the template page, A at 390 and 1280 in light and dark_

- [x] **Templates: Light, a review-optional validator, names, project files and the unverified rule**
  - touches: src/workflows.ts, src/workflows/mission.json, src/workflows/light.json, test/workflows.test.ts, test/workflow-templates.test.ts
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: ad60767
  Grow `src/workflows.ts` (M32) and keep it pure about templates. It reads no mission state, spawns nothing and imports nothing from `src/missions.ts`. Do not touch `src/missions.ts`, `src/preflight.ts`, `server.ts` or `web/`; later tasks wire this in. Match the neighbours: plain TypeScript run directly by Node, lowercase plain comments, no dependency.

  Changes. (1) `review` becomes optional in the validator's `TODAY` rules. Everything else stays as it is: interview, plan gate, preflight, build, merge, land and close may not be left out, and walkthrough and walk only together. (2) A workflow may carry optional top-level `name` and `description` strings. Any other unknown field is still refused, and `id` must match `^[a-z0-9][a-z0-9-]*$` because it names a file and reaches a URL. (3) Add `name` and `description` to `src/workflows/mission.json` ("Mission"; "The full flight: every task reviewed by a RIO, the proof on the merged tree, and a walk before it lands.") and change nothing else in it. (4) Ship `src/workflows/light.json`: id `light`, name "Light", description "Explore fast: build and merge, with no review, proof or walk.", stages interview, plan-gate, preflight, milestones (tasks (build), merge, land), close. Find it beside `mission.json` with `new URL(..., import.meta.url)`, as `MISSION_TEMPLATE` does. (5) `unverified(w)` is true when `w` lacks any of `review`, `proof` or `walk`, and this is the only place the question is asked. (6) `builtInWorkflows()` returns mission and light, validated and frozen. (7) `templatesFor(projectPath)` reads `<projectPath>/.maverick/workflows/*.json` and returns the contract's `TemplateChoice[]`: built-ins first, then project files by id. A project file with a built-in's id replaces it in place. A file whose `id` differs from its file name, that is not JSON, or that fails validation becomes a choice with `error` set to the message and no `template`. A missing folder is no project templates, and any other read error throws, naming the folder. (8) `chooseTemplate(projectPath, id = "mission")` returns the chosen choice's template, or throws the choice's error, or throws "no template <id>". So a project whose `mission.json` is broken refuses a start rather than silently running the built-in.

  In `test/workflows.test.ts`, change exactly one thing: drop `"review"` from the list in "each stage that may not be left out is refused by name". No other line in any existing test changes. Prove it: new `test/workflow-templates.test.ts` covers light loading and being unverified, mission being verified, leaving out each of review, proof and walk making a template unverified, `name` and `description` accepted, a bad id refused, an unknown field still refused, a project override, a broken file and a mismatched id each listed with their messages, a missing folder, and `chooseTemplate`'s three outcomes, using invented projects in temp folders. Then `git diff main -- test/workflows.test.ts` shows the one word, and `npm test && npm run lint` pass, with the results in the commit message.

- [x] **The templates a project offers, over the API**
  - touches: server.ts, test/workflows-api.test.ts
  - needs: m1-t1
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: 50a847a
  Add `GET /api/workflows?project=<id>`, which returns `templatesFor(project.path)` as `TemplateChoice[]`, and `GET /api/workflows/<templateId>?project=<id>`, which returns one choice with its `template`, or 404 naming the id. Resolve the project with `requireProject`, as the mission routes do. Look a template up in the list `templatesFor` returns, and never build a path from the URL. Put the routes beside `/api/missions` in `server.ts` and match its style. Do not touch `src/missions.ts` or `web/`. The mission's pinned copy is m1-t3's. A broken template file must not break the list: it is a choice with `error`, and the route answers 200.

  Prove it: `test/workflows-api.test.ts` starts the real server on a free port against temp `SESSION_CONSOLE_*` folders, as `test/http-writes.test.ts` does, with an invented project holding one good and one broken template. It asserts the list (mission, light, the good file and the broken one with its message), one template fetched by id, a 404 for an unknown id, and that `../` in an id is refused. `npm test && npm run lint`, with the results in the commit message.

- [x] **A mission starts from the chosen template, and its view says which and where it is**
  - touches: src/missions.ts, server.ts, test/workflow-start.test.ts
  - needs: m1-t1, m1-t2
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: c5cc24e
  `startMission` takes an optional template id as a new last parameter and pins `chooseTemplate(project.path, id)`. With no id it chooses `mission`, which for a project with no `.maverick/workflows/` is exactly today's `defaultWorkflow()`. `breakdowns.ts` keeps calling it with no id. `POST /api/missions` passes `body.template` through. `GET /api/workflows/<id>?project=&mission=<missionId>` returns that mission's pinned copy through `workflowOf`, so editing or deleting a project template changes no mission already started. An older record with no `template` reads as `mission`.

  `missionView` keeps not sending the raw template, but it gains `workflow` (the contract): id, name, `unverified(...)`, and `flight`, the stages the strip draws. `flight` comes from a pure exported `flightOf(mission)`. Its labels, in order, are Interview, Plan gate, Preflight, Build, Review, Merge, Proof, Land, Walk and Close (walkthrough folds into Walk, and summary is on demand and not drawn). It holds only the stages the pinned template has, each `done`, `now` or `next`, read from the record: `interviewing` is Interview, `planned` is Plan gate, flying reads the first milestone not done (tasks flying or pending is Build, reviewing is Review, every task passed and not merged is Merge, merged and not proved is Proof, a repo landing is Land, owing a walk is Walk), `review` is Close now, and `closed` is all done. Build and Review carry a count ("2 of 3"). Do not touch `web/`, the ledger format, `sweepOnce`, `actOn`, landing or briefs: those are m1-t4's and m1-t5's.

  Prove it: `test/workflow-start.test.ts` covers a start with no id pinning the same template as today, a start choosing `light` pinning light, a start on a broken project `mission.json` refused with the validator's message, an edit to the project's file after start leaving the pinned copy unchanged and served by the `mission=` route, `missionView` carrying `workflow` and never `template`, and `flightOf` across every status for both templates. `test/mission-flight.test.ts` passes untouched. `npm test && npm run lint`, with the results in the commit message.

- [x] **Light flies: a built task passes with no review, and the plan, briefs and interview follow the template**
  - touches: src/missions.ts, src/briefs.ts, .claude/agents/wingman.md, test/workflow-light.test.ts
  - needs: m1-t3
  - status: passed
  - attempt: 2
  - verdict: pass with notes
  - commit: cc57e1d
  Refit, not rewrite (M32): the statuses, `sweepOnce`, `gates` and the ledger format stay. (1) In `actOn`, a `built` task under a template with no `review` stage becomes `passed`, with no RIO spawned. The ledger shows it as `built to passed`. The note says "no review in this template", with no `RIO:` part, so no line claims a review. (2) `parsePlan` takes an optional `{ walk: boolean }` and does not require a `_walk:_` line when `walk` is false. `approveOnce` and `previewPlan` pass whether the pinned template has a walk. The default keeps today's rule. (3) `costOf` and `estimateOf` count a RIO per task only when the template reviews. (4) The Strike Lead's interview prompt, built beside `PLAN_FORMAT`, names the template, lists the stages this mission runs, and says where the work will end up. Under an unverified template it says plainly that there is no review, proof or walk, that the work stays on its mission branch, that the plan must promise none of them and leaves out `_walk:_`, and that a repo set to land by `pr` or `push` will be refused at the gate, which it tells Cory in its first round. Under `mission` the prompt is unchanged. (5) `wingmanBrief` in `src/briefs.ts`, under a template with no review, drops "A RIO that is not you will check the work" and says instead: "No RIO reviews this mission: its template leaves review out, so what you commit is merged as you leave it. Check the list yourself." It keeps the checklist and the proof lines. The default brief is unchanged byte for byte. (6) Make `.claude/agents/wingman.md`'s line 82 paragraph conditional ("unless your brief says this mission has no RIO") and change nothing else. Under Light there is no summary: `summarizeMission` already refuses, so leave it.

  Prove it: `test/workflow-light.test.ts` uses `test/flight-harness.ts` and its fake `claude` to fly a pinned-Light mission with one milestone of two tasks, the second needing the first, from `approveMission` to `closeMission` through the real sweep. It asserts literally the ordered spawn list (two Wingmen and nothing else), each task `passed` with no `review`, the milestone merged with no proof, no walkthrough commissioned, the mission reaching `review` and then `closed`, and the ledger lines. A plan with no `_walk:_` line parses under Light and is refused under `mission`. The Light Wingman brief has no RIO promise and the default brief is unchanged. The interview prompt under Light names the stages and the branch. `test/mission-flight.test.ts` passes untouched. `npm test && npm run lint`, with the results in the commit message.

- [x] **Unverified work can't land: refused at the gate and at landing**
  - touches: src/preflight.ts, src/missions.ts, test/workflow-landing.test.ts
  - needs: m1-t4
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: 63bd0ba
  (1) Preflight. `PreflightInput` gains `unverified?: boolean`, and `rioAgent` becomes optional. `preflightFor` passes `unverified(workflowOf(mission))`, and passes `rioAgent` only when the template reviews, so a Light mission in a project with no `rio.md` is not refused for it. Under `unverified`, every repo in `remote` gets a refusing `landing` check named `unverified landing for <label>`, whose detail says: "<label> is set to land by <pr|push>, but this mission's template leaves out <review, proof, walk>, so its work stays on its mission branch; set <label>'s land to merge in maverick.json, or choose a template that verifies". The default template's checks stay the same names in the same order, and `test/preflight.test.ts` passes unchanged. (2) Landing. `landTheWork` refuses, per repo, any `pr` or `push` landing under an unverified template: it pushes nothing, opens nothing, and adds that repo and reason to `failed`. So `catchUp` holds the milestone on `landing`, and `closeMission` refuses, even when `maverick.json` changed mid-flight and `landAgain` followed it. (3) The release must work. Today `landAgain` on a single-repo mission throws "nothing was waiting to land" once `followLanding` has moved the repo back to `merge`, and that throw discards the change, so the hold can never come off (read from `src/missions.ts`, not yet run). Make a follow to `merge` count as a recovery, so the hold comes off and `settle` runs. The existing test of this path passes unchanged.

  Prove it: `test/workflow-landing.test.ts` covers the gate refusing a Light plan with a `pr` repo and a `push` repo, each named, and passing it with `merge`. A Light mission whose `maverick.json` flips to `pr` mid-flight is refused at `landAgain` and at `closeMission`, with no push, no `gh` call (fake `gh` on PATH logging calls) and a landing hold. Setting the project back to `merge` and landing again releases the hold on a single-repo mission. A full `mission` landing by `pr` still lands as today. Then remove the preflight guard, run the test and see the gate cases fail; restore it; remove the landing guard, run the test and see the landing cases fail; restore it. Put both failing outputs in the commit message. `test/mission-flight.test.ts` passes untouched. `npm test && npm run lint`, with the results in the commit message.

- [x] **Template cards in the new-mission dialog**
  - touches: web/app.js, web/command.js, web/style.css
  - needs: m1-t3
  - cells: 22
  - status: passed
  - attempt: 2
  - verdict: pass with notes
  - commit: ca62a66
  Build cell 22 of `.ui-design/mockups/workflow-templates-round-1.html` and follow its closing rules 1, 2 and 6. `ask()` in `web/app.js` gains an optional `choices` option: a list of `{ value, name, description, note?, error? }` and the selected value. It draws the new template card under the text field, one per row, as a radio group: one Tab stop, arrows move and choose, `aria-checked`, the selected card on `--panel` with a 2px accent ring, and a disabled card for `error` with the message in mono `--threat`. It resolves `{ text, choice }` when choices are given. Every other `ask()` call is untouched and behaves as today. In `web/command.js`, `newMission` fetches `GET /api/workflows?project=` before the second dialog, passes the choices (an unverified one gets the note "unverified: stays on its mission branch") with `mission` selected, and posts `template` with the name and brief. If the fetch fails, say so through `failed()` and do not open the dialog. Styles go in `web/style.css` beside `.ask`, using only existing tokens. Do not touch the mission page, `server.ts` or `src/`.

  Prove it: serve the branch on the invented Harbor project as `tools/ui-check.mjs` does, with a project template and a broken one, and grade the dialog with ui-audit (the `MAVERICK_UI_AUDIT` scripts: `scan.mjs`, then `grade.mjs`) at 390 and 1280 in light and dark. Put the grade card in the commit message and the screenshots where the brief says. Enter with no change opens a Mission. `node tools/ui-check.mjs`, `npm test && npm run lint`, with the results in the commit message. Report the grade; do not judge it.

- [x] **The mission page: the template line, the status strip, and a Light result**
  - touches: web/mission.js, web/mission.css, web/mission/result.js, web/mission/result.css
  - needs: m1-t3
  - cells: 28, 34
  - status: passed
  - attempt: 2
  - verdict: pass with notes
  - commit: f755041
  Build cells 34 and 28 and follow closing rules 3, 4 and 6. In `renderAsk`, under the `h1`, add the template line in the `.mv-ask-meta` mono style: "runs <a>light</a> · unverified: stays on its mission branch", or "runs <a>mission</a>". The name links to `/workflow.html?project=<id>&mission=<missionId>`. It reads `mission.workflow` from the view (the contract), and an older view without it reads as mission. In the rail, between `#word` and `.mv-anchors`, add the status strip: `mission.workflow.flight` as a list with done, now and next marks and the count, left-out stages not drawn, and at 390 under the word, above the content, as the rail's `display: contents` already orders it. Under an unverified template, the Result section draws no summarize button and no "What I must read" panel, the walks list says nothing about proof or walking, and the closing copy says the work stays on its mission branch, which is where Cory takes it by hand. Use existing tokens only, and no colour for "unverified". Do not touch `web/app.js`, `web/command.js` or `src/`.

  Prove it: on the invented Harbor fixtures `tools/ui-check.mjs` serves, render a full mission flying, a Light mission flying, a Light mission at review, and an older record with no `workflow`. Grade the mission page with ui-audit at 390 and 1280 in light and dark, and put the grade card in the commit message. `node tools/ui-check.mjs`, `npm test && npm run lint`, with the results in the commit message. Report the grade; do not judge it.

- [x] **The read-only template page**
  - touches: web/workflow.html, web/workflow.js, web/workflow.css
  - needs: m1-t2
  - cells: 39
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: 8aac27f
  A new page, `web/workflow.html`, built from cell 39 and closing rule 5, with the flow drawn per `.ui-design/mockups/workflow-editor-round-1.html` picks 1 (left to right, wires), 7 (for-each as splay and rejoin), and 11 (card steps with ports). It is read-only, with no drag, add or delete. `?project=&id=` loads `GET /api/workflows/<id>`, and `?project=&mission=` loads that mission's pinned copy. It shows the crumb, name, description, the unverified sentence when `unverified` is true ("It leaves out review, proof and the walk, so a mission it runs stays on its mission branch, and you take the work from there by hand.", naming only what it actually leaves out), where it comes from (built-in or the project's file), then the flow and the legend. A stage the template leaves out is not drawn. Who runs each stage reads from the template (`agent`, else its slot's name). An unknown id or a broken template says so on the page, with the message. Match the other pages' bar and theme handling (`web/theme.js`, `web/page.js`, the `.bar` header as `web/mission.html` has it) and use only existing tokens. At 390 the flow scrolls sideways inside its frame and the page does not. Do not touch other pages or `src/`.

  Prove it: serve the branch on invented Harbor fixtures and grade the page with ui-audit at 390 and 1280 in light and dark for mission, light, a project template and a broken one, with the grade card in the commit message. The grid rule in `.ui-design/system.md` (a 600-character `<pre>` widens nothing) holds. `node tools/ui-check.mjs`, `npm test && npm run lint`, with the results in the commit message. Report the grade; do not judge it.

- [x] **The decision entry, the docs and the design system**
  - touches: docs/03-decisions.md, docs/01-architecture.md, docs/02-data-model.md, docs/07-glossary.md, README.md, .ui-design/system.md
  - needs: m1-t4, m1-t5, m1-t6, m1-t7, m1-t8
  - status: passed
  - attempt: 1
  - verdict: pass with notes
  - commit: d17c2eb
  Write `## M33: A mission picks its template, and unverified work stays on its branch ✅ built` in `docs/03-decisions.md`, after M32 and in its voice. Cover what was decided (Cory's calls listed in this plan's intro), the shape (ordered stages still, `unverified` asked in one place, the pinned copy decides, review left out settles at `passed`, project templates at `.maverick/workflows/<id>.json` overriding built-ins), what the tests pin and what they do not, the one existing assertion changed and why, and the `landAgain` release fix. Under M32's "Not known", point to M33 for the landing question. Update the architecture row for `workflows.ts`, the data-model rows (`Workflow` gains `name` and `description`; `MissionView.workflow`), and the glossary's "Workflow template" (two built-ins, project templates, unverified). In `README.md`, replace "There is one template, and a person cannot pick another yet." with how to pick, where a project's templates live, and the rule that unverified work never lands by pull request or push. Record the template card, the status strip, the template line and the template page in `.ui-design/system.md`, from the mockup's closing rules. Change no code.

  Prove it: every path, function and file the new text names exists on the branch (`grep` each), `npm run lint` passes, and the README section reads true against the code. Results in the commit message.

## Contracts

- **Workflow** (owner: m1-t1): `{ id: string; name?: string; description?: string; stages: Stage[] }`, with id matching `^[a-z0-9][a-z0-9-]*$`
- **unverified** (owner: m1-t1): `unverified(w: Workflow): boolean`, true when `w` lacks any of `review`, `proof`, `walk`
- **TemplateChoice** (owner: m1-t1): `{ id: string; name: string; description?: string; source: "built-in" | "project"; unverified: boolean; template?: Workflow; error?: string }`
- **templatesFor** (owner: m1-t1): `templatesFor(projectPath: string): Promise<TemplateChoice[]>`, built-ins first, project files by id, same id overrides in place
- **chooseTemplate** (owner: m1-t1): `chooseTemplate(projectPath: string, id = "mission"): Promise<Workflow>`, throwing the choice's error or "no template <id>"
- **light.json** (owner: m1-t1): `src/workflows/light.json`, id `light`: interview, plan-gate, preflight, milestones (tasks (build), merge, land), close
- **GET /api/workflows** (owner: m1-t2): `?project=<id>` answers `TemplateChoice[]`; `/api/workflows/<templateId>?project=<id>` answers one `TemplateChoice` with `template`, or 404
- **GET /api/workflows/<id>?mission=** (owner: m1-t3): with `&mission=<missionId>`, the mission's pinned copy as a `TemplateChoice` (source "built-in" or "project" by id)
- **POST /api/missions template** (owner: m1-t3): body `{ name, brief, tracker?, template?: string }`
- **startMission** (owner: m1-t3): `startMission(project, name, brief, trackerIndex = 0, from?: string, template?: string)`
- **MissionView.workflow** (owner: m1-t3): `{ id: string; name: string; unverified: boolean; flight: Array<{ id: string; label: string; state: "done" | "now" | "next"; count?: string }> }`
- **flightOf** (owner: m1-t3): `flightOf(mission: Mission): MissionView["workflow"]["flight"]`, pure
- **parsePlan walk option** (owner: m1-t4): `parsePlan(text, repos?, shared?, opts?: { walk?: boolean })`, where `walk: false` makes `_walk:_` optional
- **ask choices** (owner: m1-t6): `ask({ ..., choices?: { items: Array<{ value: string; name: string; description?: string; note?: string; error?: string }>; selected: string } })` resolves `{ text, choice }` when given choices
- **PreflightInput.unverified** (owner: m1-t5): `unverified?: boolean`, with `rioAgent?: string` now optional; check kind `landing`, name `unverified landing for <label>`

## Components

- mockups: .ui-design/mockups/workflow-templates-round-1.html
- **Template card** (owner: m1-t6): new; cells 22; inside the real `ask()` dialog, which other dialogs keep unchanged; no existing card; the selected card gets a 2px accent ring on `--panel`, no radio dot, and stays a keyboard radio group
- **Status strip** (owner: m1-t7): new; cells 28; a list in `.mv-rail` between `.mv-word` and `.mv-anchors`, both reused as is; left-out stages not drawn
- **Template line** (owner: m1-t7): reuse; cells 34; the `.mv-ask-meta` mono style as is, with the template name as a link
- **Template page** (owner: m1-t8): new; cells 39; a new page with no existing counterpart, header after `.mv-ask h1`, the flow per editor round 1 picks 1, 7 and 11, left-out stages not drawn

## Preflight

- duration: 10h
- tool: git
- runtime: node >=22.18
- human: commit `.ui-design/mockups/workflow-templates-round-1.html` and `.ui-design/mockups/workflow-editor-round-1.html` to `main` before approving, because Wingmen work in worktrees cut from `main` and an untracked mockup never reaches them; the plan reads them only from the mission branch
- human: set `MAVERICK_UI_AUDIT` to flynn-core's ui-audit `scripts` folder in the environment Maverick runs its sessions with; without it `tools/ui-check.mjs` skips the grade and says so, and the UI tasks report the grade as not run rather than A
- human: the walk's real Light flight runs Claude sessions on your login against an invented project; the tests use a fake `claude` and never your login


## Log

- 2026-11-09 20:58 m1-t1 Templates: Light, a review-optional validator, names, project files and the unverified rule: pending to flying
- 2026-11-09 21:04 m1-t1 Templates: Light, a review-optional validator, names, project files and the unverified rule: flying to reviewing
- 2026-11-09 21:07 m1-t1 Templates: Light, a review-optional validator, names, project files and the unverified rule: reviewing to passed (RIO: pass with notes) with 9 notes carried
- 2026-11-09 21:07 m1-t2 The templates a project offers, over the API: pending to flying
- 2026-11-09 21:11 m1-t2 The templates a project offers, over the API: flying to reviewing
- 2026-11-09 21:15 m1-t2 The templates a project offers, over the API: reviewing to passed (RIO: pass with notes) with 8 notes carried, 1 unverified
- 2026-11-09 21:15 m1-t3 A mission starts from the chosen template, and its view says which and where it is: pending to flying
- 2026-11-09 21:15 m1-t8 The read-only template page: pending to flying
- 2026-11-09 21:28 m1-t3 A mission starts from the chosen template, and its view says which and where it is: flying to reviewing
- 2026-11-09 21:50 m1-t8 The read-only template page: flying to reviewing
- 2026-11-09 21:51 m1-t3 A mission starts from the chosen template, and its view says which and where it is: reviewing to passed (RIO: pass with notes) with 11 notes carried, 2 unverified
- 2026-11-09 21:51 m1-t4 Light flies: a built task passes with no review, and the plan, briefs and interview follow the template: pending to flying
- 2026-11-09 21:51 m1-t6 Template cards in the new-mission dialog: pending to flying
- 2026-11-09 21:51 m1-t7 The mission page: the template line, the status strip, and a Light result: pending to flying
- 2026-11-09 22:29 m1-t8 The read-only template page: reviewing to passed (RIO: pass with notes) with 10 notes carried, 1 unverified
- 2026-11-09 22:31 m1-t4 Light flies: a built task passes with no review, and the plan, briefs and interview follow the template: flying to reviewing
- 2026-11-09 22:38 m1-t4 Light flies: a built task passes with no review, and the plan, briefs and interview follow the template: reviewing to flying
- 2026-11-09 22:47 m1-t4 Light flies: a built task passes with no review, and the plan, briefs and interview follow the template: flying to reviewing
- 2026-11-09 22:59 m1-t4 Light flies: a built task passes with no review, and the plan, briefs and interview follow the template: reviewing to passed (RIO: pass with notes) with 13 notes carried, 1 unverified
- 2026-11-09 22:59 m1-t5 Unverified work can't land: refused at the gate and at landing: pending to flying
- 2026-11-09 23:02 m1-t7 The mission page: the template line, the status strip, and a Light result: flying to reviewing
- 2026-11-09 23:14 m1-t7 The mission page: the template line, the status strip, and a Light result: reviewing to flying
- 2026-11-09 23:23 m1-t5 Unverified work can't land: refused at the gate and at landing: flying to reviewing
- 2026-11-09 23:35 m1-t7 The mission page: the template line, the status strip, and a Light result: flying to reviewing
- 2026-11-09 23:35 m1-t5 Unverified work can't land: refused at the gate and at landing: reviewing to passed (RIO: pass with notes) with 8 notes carried, 1 unverified
- 2026-11-09 23:41 m1-t7 The mission page: the template line, the status strip, and a Light result: reviewing to passed (RIO: pass with notes) with 13 notes carried, 2 unverified
- 2026-11-10 00:38 m1-t6 Template cards in the new-mission dialog: flying to reviewing
- 2026-11-10 00:48 m1-t6 Template cards in the new-mission dialog: reviewing to flying
- 2026-11-10 00:52 m1-t6 Template cards in the new-mission dialog: flying to reviewing
- 2026-11-10 00:57 m1-t6 Template cards in the new-mission dialog: reviewing to passed (RIO: pass with notes) with 12 notes carried, 2 unverified
- 2026-11-10 00:57 m1-t9 The decision entry, the docs and the design system: pending to flying
- 2026-11-10 01:05 m1-t9 The decision entry, the docs and the design system: flying to reviewing
- 2026-11-10 01:11 m1-t9 The decision entry, the docs and the design system: reviewing to passed (RIO: pass with notes) with 7 notes carried
- 2026-11-10 01:11 merged: milestone 1 (Pick a template, fly Light, and keep unverified work on its branch) is on the mission branch
