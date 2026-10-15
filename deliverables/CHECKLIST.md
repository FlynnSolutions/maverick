---
device: true
format: checklist
---
# 🛠️ Maverick — Checklist

> **Maverick's own work tracker**, in the shape Maverick parses: `## 🔥 Priority`,
> `## 🚧 In Progress`, `## 📋 Backlog`, `## ✅ Recently shipped, pending release`. `###` headings
> under Priority are releases. This is the canonical list; items commit to `hq/PUNCHLIST.md` get
> pulled *up* there, never duplicated. The repo rules are [`RULEBOOK.md`](../RULEBOOK.md).
>
> **Source tags:** `[ENG]` engineering / feature · `[DEBT]` tech debt · `[OSS]` open-source
> readiness · `[DOC]` docs and standards.

---

## 🔥 Priority

### Open source, for real

- [ ] `[OSS]` `[S]` **Clear agent-readiness Level 2 on Maverick itself**
  - created: 2026-09-16
  - source: Cory, 2026-09-16 (competitive research session)
  - kind: chore
  Baseline on 2026-09-16 was **Level 1, 3%**, the worst repo measured on this machine. Eight
  criteria short of Level 2. The cheap ones first: a linter and formatter config, `.editorconfig`,
  `.nvmrc`, a `test` script with at least one real test, `CONTRIBUTING.md`, `SECURITY.md`, a CI
  workflow that runs lint and test. Re-run `npx @kodus/agent-readiness . --ci --no-web` and put the
  number in the README. Maverick cannot ship a readiness score it fails.
  - status: on `feat/electron-shell` (2026-10-07): `.editorconfig`, `.nvmrc`, `lint`, CI, CONTRIBUTING, SECURITY; linter and formatter still open (M15)

- [ ] `[OSS]` `[S]` **The public repo reads like one**
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: chore
  - plan: plans/the-public-repo-reads-like-one-2026-10-08.md
  `LICENSE` landed 2026-09-16. Still missing: `CONTRIBUTING.md`, `SECURITY.md`, issue and PR
  templates under `.github/`, a screenshot or GIF in the README, and a one-line description of who
  this is for. Do not post about it before this is done.
  - status: on `feat/electron-shell` (2026-10-07): all of it, pending the draft PR

### The level model

- [ ] `[ENG]` `[L]` **CAG, Strike Lead, Wingman: three levels of agent per project**
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
  The reframe, named 2026-09-16; the names settled the same day (decisions M9). **CAG (L1)**: one long-lived agent per project that holds
  the whole landscape, answers questions about it, and writes plan documents. Never builds a
  feature, never edits product code. It is the project's chat box. **Mission (L2), run by a
  Strike Lead**: a bounded multi-feature effort planned into milestones, dispatching and validating
  workers. **Wingman (L3)**: one item off the board, fresh context, a worktree, a diff, which is
  what Maverick spawns today. The levels are blast radius, not seniority.
  Open: where the CAG's tool boundary is enforced (allowed-tools list, not prompt) and where
  its plan documents are written.

- [~] `[ENG]` `[L]` **The Strike Lead: grow the audit from a validator into an orchestrator**
  - created: 2026-09-16
  - source: Cory, 2026-09-16, after reading Factory's Missions docs
  - kind: feature
  - status: built on `feat/rio`, not merged. `src/missions.ts`, `web/mission.*`, the first tests.
  - plan: docs/03-decisions.md M7 and M8
  Take from Factory's Missions, which are documented behaviour, not a format: a **clarifying
  interview** before any work (probe constraints, refuse to start on one prompt), a plan of
  **features grouped into milestones** that Cory blesses once, a **fresh worker session per
  feature** so no agent carries the whole project, **validation at every milestone** rather than
  inside the worker, and **human-style QA** driving the real UI (Playwright) instead of only unit
  tests. Parallelism stays narrow: within a feature and during validation. `src/audits.ts` and the
  audit-parent records are the seam this grows out of. Their published cost, median 12x the tokens
  of a normal session, is the reason the blessing gate is not optional.
  **The gap, named 2026-09-16:** what `audits.ts` does today is the *validator half only*, a verdict
  and findings on a session that already finished. The Strike Lead is the missing half in front of it: the
  interview, the milestone plan, the dispatch. Build that, then rename. Renaming first would be
  exactly the drift the positioning note warns about.
  **Built 2026-09-16 on `feat/rio`,** verified end to end against a fixture project with real
  agents: interview, gate, tracker write, dispatch into worktrees, a separate reviewer's verdict,
  the merge into `mission/<id>`, and the close that ticks the items. Left open: the CAG, a
  mission across more than one repo, and human-style QA driving the real UI (Playwright is a
  dependency, so it is a decision rather than a step).

- [ ] `[ENG]` `[L]` **Brainstorm, breakdown, plan: the phases before an item reaches the board**
  - created: 2026-10-06
  - source: Cory, 2026-10-06
  - kind: feature
  Three phases sit in front of the checklist today and only the last is formal. **Brainstorm**: one
  conversation, many ideas, no structure, written as one dated markdown doc per conversation at
  `deliverables/brainstorms/<date>-<topic>.md`. This is the CAG's first real job (decisions M5,
  M9), and the one level whose tool boundary is enforceable by the tool list: Read and Write under
  `deliverables/`, edit the tracker, no `Bash`. Session role `plan` already exists for the record.
  **Breakdown**: a step that reads one brainstorm doc and proposes items, each with a title, `kind`,
  `size`, and a call of *plan now* or *backlog*. On approval it writes them into the tracker with
  the insert-into-group path missions already use: planned items carry
  `plan: deliverables/plans/<slug>.md` and land in Priority; the rest land in Backlog under a `###`
  group named after the brainstorm. A feature that is mission-sized is handed to a Strike Lead
  interview rather than planned twice. **The rule**: Priority and In Progress require a `plan:`
  field that resolves to a real file; Backlog does not. *Planned* means the field is present and
  the file exists, not a `status:` word, because a path is verifiable and a word is a claim. The
  board shows an *unplanned* badge on any roadmap or in-progress item missing one, offers a
  *plan it* verb that opens a plan session, and the drawer refuses to spawn a Wingman on an
  unplanned item. Backlog stays free-form, organised by theme groups, which the parser already
  reads in any lane. This formalises what is already half there: the `plan` field, the *note
  only, not scoped* marker on six backlog items, and Realtime's `deliverables/plans/`. No new
  store; every artifact is markdown in the repo (M1).
  **Decided by Cory 2026-10-06:** one dated brainstorm file per conversation, not a rolling
  `IDEAS.md`, since a running file gets edited by agents and drifts; and *planned* is the
  presence of a resolving `plan:` field, not a new status value.
  **Built:** the rule and the CAG (brainstorm, plan) merged 2026-10-07 as #3, decisions M13.
  The breakdown built 2026-10-07 on `feat/breakdown`, decisions M16: a CAG terminal writes
  the proposal, the breakdown page is the gate, approve writes the board under a group named
  after the brainstorm and opens a Strike Lead per mission-sized item. Roadmap items land
  unplanned on purpose (M13 over the sketch's wording). Not yet: per-item edits at the gate.

### Readiness at the door

- [ ] `[ENG]` `[M]` **Score a project when it is imported, and offer to fix it**
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
  On import (Finder picker or pasted path), run `@kodus/agent-readiness` (MIT) and show the level,
  the percentage and the failing pillars on the project card. Then offer the remediation Maverick
  actually owns: run the `doc-standard` skill to scaffold and generate the docs, add the tracker
  file if it has none, install the drift gate. The score is not decoration; it is the gate on what
  Maverick will let you launch unattended into that repo.
  - blocked-by: agree the cache and re-score policy (scores go stale)

### Brainstorm: what the breakdown step should look like

- [ ] `[ENG]` **The breakdown writes items in the tracker's own tags and sizes**
  - created: 2026-10-08
  - source: brainstorm deliverables/brainstorms/2026-10-08-what-the-breakdown-step-should-look-like.md, 2026-10-08
  - kind: chore
  - size: S
  `itemBlock` in `src/trackers.ts` stamps `[ENG]` on every bullet it writes, and `parseBreakdown`
  accepts sizes from a constant (`SIZES`) rather than from the tracker. The checklist header
  defines four source tags (`[ENG]` `[DEBT]` `[OSS]` `[DOC]`) and the proposer is told to use the
  tracker's words, but the proposal format gives it no way to say the tag, so a `kind: doc` item
  lands on the board as `[ENG]`. The mission writer in `src/missions.ts` shares the default.
  What to do: read the tag and size vocabulary from the tracker being written into (its header
  note, or the tags already on its items), let a proposed item carry its tag (a `tag:` field, or
  a kind-to-tag mapping the tracker declares), write that tag instead of the constant, and have
  the parser list a tag or size the tracker does not use as a problem. Why now rather than
  later: it is the one piece of the just-built breakdown that writes something wrong rather than
  something deferred, every approve from today on produces it, and the plan is a paragraph.

### Mission: Mission page and inbox

- [ ] `[ENG]` **Mission: Mission page and inbox**
  - created: 2026-10-13
  - source: Strike Lead interview, 2026-10-13
  - kind: mission
  - mission: mission-page-and-inbox
  - plan: deliverables/missions/mission-page-and-inbox.md
  Build the UI Cory chose in `deliverables/plans/mission-ui-2026-10-13.md`: the workspace becomes an inbox grouped by what needs him (Needs you, Working, Ready to review, Done); the mission page gets four fixed anchors (The ask, Plan, Progress, Result) in a left rail, one status word, and updates from a server stream; every question from an agent is a feed entry with its answers as buttons, repeated in the inbox and pushed as a macOS notification; a reply box to the Strike Lead sits at the bottom of Progress. The mockups to match are served by the app at `/mockups/mission.html` and `/mockups/question-queue.html#b` (read them in a browser with `node tools/cdp.mjs <url> --shot out.png`, and read their source in `.ui-design/mockups/`). This mission is deliberately not the palette (a variants round later), not the map view, and not a change to the protocol in `src/missions.ts` beyond what the view needs. Nothing here adds a dependency or a build step (decision M2), and the design contract in `.ui-design/system.md` holds: its tokens, its lamps (`web/lamp.js`), its strips, no unicode glyphs for icons.
  Milestone 1 — The record speaks the page's language: done when `npm test` passes, `GET /api/missions/<id>?project=<p>` on a mission record returns `word`, `questions` and `feed`, `GET /api/missions/<id>/stream` sends a `data:` event within two seconds of the record being written, and `POST /api/missions/<id>/say` appends a decision line to the ledger
  Milestone 2 — The mission page: four anchors: done when with the server running, `node tools/cdp.mjs "http://localhost:8767/mission.html?project=maverick&mission=mission-page-and-inbox" --eval check.js` (write `check.js` to count them) reports four anchor links, a status word, the plan's milestones with their tasks' intent lines, a feed with entries, and no `window.prompt` or `window.confirm` anywhere under `web/mission*`; and `npm run lint` passes
  Milestone 3 — The workspace is the inbox: done when with the server running, the workspace (`/?view=workspace`) renders four groups in the order Needs you, Working, Ready to review, Done, a mission's open question appears as a row in Needs you with an Answer button that posts the same route the mission page uses, and `npm run lint` passes
  Milestone 4 — The question reaches you, and the page is where you start: done when `npm test` and `npm run lint` pass; `test/notify.test.ts` pins which questions are new; the app opens on the workspace of the last project; the docs name the four anchors, the inbox and the status words

- [ ] `[ENG]` **Questions and the status word**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 1
  - mission: mission-page-and-inbox
  - milestone: 1
  - repo: root
  Write `src/questions.ts`, pure functions over a `Mission` (the type in `src/missions.ts`; import the types only, do not edit that file). Export `statusWord(mission: Mission): "working" | "waiting for you" | "error" | "done"`: `done` for `closed` and `review` with nothing held; `waiting for you` when any task is `handed-back`, any milestone carries a `hold`, the mission has `escalation` or `trouble`, is `paused`, or is `planned` (the gate); `error` when `trouble` names a failure the person cannot act on (the report could not be written, a proof runner died: the strings in `src/missions.ts` that set `trouble` tell you which); otherwise `working`. Export `questionsOf(mission: Mission): Question[]` where `Question` is the contract below: one per handed-back task (answers: send it out again → `POST tasks/<id>/retry`; accept it over the RIO → `POST tasks/<id>/accept` with `{ note }`; the body is the task title, attempt count, verdict and the first BLOCKER line from `mission.findings?.[id]` when the view carries findings, else the task `note`), one per held milestone (kind from `hold.kind`; answers: release → `POST milestones/<n>/release` with `{ note }`, and for a landing hold "try landing again" → `POST land`), one for `escalation` (kind `plan`; answers: resume → `POST resume`, pause → `POST pause`), one when `paused` (answer: resume), one at the gate when `status === "planned"` (kind `gate`; answer: approve → `POST approve`). Every answer carries `label`, `method`, `path` relative to `/api/missions/<id>/`, optional `body` keys the page must fill (`note`), and `primary: true` on exactly one answer per question. Questions are ordered oldest first by the timestamp you can find (hold.at, task.review?.at, else mission.created). `test/questions.test.ts` builds missions by hand (see `test/missions.test.ts` for the shapes) and pins every kind, the ordering, one primary per question, and all four words. No I/O in this file.

- [ ] `[ENG]` **The feed from the ledger**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 1
  - mission: mission-page-and-inbox
  - milestone: 1
  - repo: root
  Write `src/feed.ts`: `feedOf(log: string[], mission: Mission): FeedEntry[]` turning the plan's `## Log` lines (the ledger; `parsePlan(...).log` returns them, each `<ISO stamp> <text>`, with the marks `decision:`, `auto:` and `held:` that `src/report.ts` already reads with `DECISION` and `AUTOMATIC`; read `transitions()` and `recorded()` in `src/missions.ts` for every line shape the ledger can hold) into typed entries, oldest first: `kind` is `question` for `held:` lines and for lines that hand a task back, `response` for a pass, a merge, a landing and a decision line, `error` for a fail, a failed proof, a collision, `action` for a launch, a spawn, a RIO sent in, a merge attempt, and `thought` for anything else. `who` is `you` for `decision:` lines, `RIO` when the line names a verdict, `Wingman` when it names a hand-off from a task, else `Maverick`. `milestone` and `taskId` are filled when the line names `milestone N` or a task id (`m\d+-t\d+`). `text` is the line without its stamp and mark. Lines the parser cannot read are kept as `thought` with the raw text, never dropped. `test/feed.test.ts` feeds real ledger lines (take them from `test/missions.test.ts` and `test/report.test.ts`) and pins every kind and the who rule. No I/O.

- [ ] `[ENG]` **The view, the stream and the reply**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 1
  - mission: mission-page-and-inbox
  - milestone: 1
  - repo: root
  In `src/missions.ts`, make `missionView` also return `word: statusWord(mission)`, `questions: questionsOf({ ...mission, findings })` and `feed: feedOf(log, mission)` where `log` is the ledger: read the plan on the mission branch the way `missionReport` does (`ledgerRepoFor` and the integration worktree path; `parsePlan(text).log`), empty when the mission is not approved yet or the file cannot be read, never a throw. Add `export const sayToStrikeLead(project, id, text)`: appends `decision: Cory to the Strike Lead: <text>` to the ledger through the same write path every other ledger line uses (`writeThenSync` with a note; read how `pauseMission` records its note) and, when `mission.interview?.terminalId` names a terminal that is still open, sends the text plus a newline into it with the terminal module's input function (`server.ts` shows how terminals take input); return `{ ok: true, sent: boolean }`. In `server.ts`: `POST /api/missions/:id/say` with `{ text }` (empty text is a 400 through the existing error path); `GET /api/missions/:id/stream` as `text/event-stream` following the pattern of `/api/transcript/stream`: write `data: <JSON of missionView>` once on connect, then whenever the mission record file changes (watch the file at `missionPath`, with a 1 s poll as the backstop, and a `: ping` comment every 15 s); stop everything on `close`. Extend the route regex that lists actions. Tests in `test/missions.test.ts`: `missionView` carries the three new fields on a fixture mission with a ledger (use `tempRepo` from `test/fixtures.ts`), and `sayToStrikeLead` writes the line and reports `sent: false` with no terminal.

- [ ] `[ENG]` **The shell**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 2
  - mission: mission-page-and-inbox
  - milestone: 2
  - repo: root
  Rewrite the mission page as the shell of `/mockups/mission.html`: the bar as it is today (keep `#back`, `#crumb`, `#status`, `#board-link`), then a two-column page, a sticky left rail (200px) and content (max 760px). The rail shows the status word from `view.word` as a chip (`waiting for you` in caution, `done` in hud, `error` in threat, `working` plain) and four anchor links, The ask, Plan, Progress, Result, each with a small count (Plan: milestone n of N; Progress: open questions or `live`; Result: `not yet` until something merged). Each anchor scrolls to a `<section>` of that id; the one in view is marked `on` with an IntersectionObserver. The ask section is the shell's own: `mission.name` as the display name, `mission.brief` as the sentence, created and approved times. Before approval (`status` interviewing or planned) the Plan section shows what today's `renderPlan` shows (the gate: problems, overlaps, warnings, preflight, cost, the approve and interview buttons, the Strike Lead terminal) moved verbatim into the shell; after approval, Plan, Progress and Result are modules: `import("./mission/plan.js")`, `progress.js`, `result.js`, each mounted with the contract below, each wrapped so a module that fails to load shows one line saying so instead of breaking the page. Link `web/mission/plan.css`, `progress.css` and `result.css` from `mission.html` (they may not exist on your branch; a missing stylesheet is harmless). Data: open `EventSource(/api/missions/<id>/stream?project=)` and call every module's `update(view)` on each event; fall back to the 8 s poll if the stream errors twice; never `replaceChildren` on the whole page after the first paint. Keep `watchSession`, `mountTerminal`, `detachTerminal` and the `act` helper from today's file and hand them to modules through `ctx` (`ctx.openSession(taskId)` mounts the task's session, Wingman or RIO, under the element the module passes). Delete every `window.prompt` and `window.confirm` in the file; a module asks with its own note field. Keep `mission.css` to the shell's own rules and the tokens; nothing a module owns.

- [ ] `[ENG]` **The plan module**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 2
  - mission: mission-page-and-inbox
  - milestone: 2
  - repo: root
  Write `web/mission/plan.js` per the module contract, matching the Plan section of `/mockups/mission.html`: one `<details class="step">` per milestone, open unless done, a lamp (`ctx.lamp`), `Milestone n` and the title, one status word on the right (`done <time>`, `waiting for you`, `working since <time>`, `not started`) derived from the milestone (`merged`, `hold`, tasks' statuses, `dispatched`), the done-when line as prose under the heading, then one row per task: lamp by task status (the map in the mockup), title, the task's `intent` as a second line, the status word with attempt count, `after <task title>` for a pending task whose `needs` are not all passed, and for a flying, reviewing or handed-back task a link `open the session` that calls `ctx.openSession(task.id)` and takes the session panel under the row. A handed-back task shows the question's answers inline: find the question for the task in `view.questions` and render each answer as a button that calls `ctx.act(answer.path, body)` with a note field beside the primary when the answer wants one; no prompt. `update(view)` patches in place by id (keep a map of row elements), never rebuilding, so an open session stays open. The milestone walkthrough controls that today's `walkthroughSection` renders stay available here under a done milestone, unchanged in behaviour. Style in `plan.css` with the tokens; nothing in `mission.css`.

- [ ] `[ENG]` **The progress module**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 2
  - mission: mission-page-and-inbox
  - milestone: 2
  - repo: root
  Write `web/mission/progress.js` per the module contract, matching the Progress section of `/mockups/mission.html`: at the top, every open question from `view.questions` pinned as one line each with a lock lamp and `answer below`; then the feed from `view.feed`, oldest first, grouped under a small heading whenever the milestone changes (`At the gate`, `milestone 1, <title>`), each entry a row of time, lamp by kind, `who` in weight, the text, and a mono `where` line naming the task when the entry has one; `question` entries that are still open (match by task or milestone with `view.questions`) carry their answers as buttons and a note field, in a caution ring, exactly like the mockup; an `error` entry's who is in threat, a `response` in hud. Under the feed, a live line (`swept <n> s ago`, from the stream's event time) and the reply box: a text input and a `send` button posting `{ text }` to `say` through `ctx.post`, clearing on success and showing the server's `sent` flag as `the Strike Lead has it` or `kept in the ledger; no Strike Lead session is open`. `update(view)` appends new entries at the bottom and removes answered questions' buttons; it does not rebuild the list. Scroll to a question when the page's hash names it. Style in `progress.css`.

- [ ] `[ENG]` **The result module**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 2
  - mission: mission-page-and-inbox
  - milestone: 2
  - repo: root
  Write `web/mission/result.js` per the module contract, matching the Result section of `/mockups/mission.html`: a summary line (`+N −M · F files · T tasks merged · on <branch>`) computed from `view.diffstat` (the strings are `git diff --stat` output per task; parse the last line for files, insertions, deletions) over tasks whose milestone has `merged`; then a list of merged tasks grouped by milestone with each task's files changed and counts (parse the stat lines; collapse to directories when a task touched more than eight files); then `To read before you merge`: every task's `carried` lines, the ones starting `unverified:` first and marked so, each with the task's title; then the milestone walkthroughs and the proof results that today's `renderReview` shows (status `review`), with the close button and its landing options moved here verbatim, no prompt. Before anything merged, the section says `not yet` and what the first landing will show. `update(view)` patches counts and lists in place. Style in `result.css`.

- [ ] `[ENG]` **Questions on the workspace feed**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 3
  - mission: mission-page-and-inbox
  - milestone: 3
  - repo: root
  Two halves. Server: `GET /api/workspace` (read `server.ts` and `src/missions.ts` for what it returns today) carries, for each mission, `word` and `questions` from `src/questions.ts`, and a `diffstat` summary string (`+N −M` over its merged tasks, computed the way `missionView` computes per-task stats, cached the same way) so a row can show it without opening the mission. Browser: write `web/inbox.js` exporting `inboxRows(mission, ctx)` per the contract: one strip per open question (`.strip.full`, the lock lamp, the question title, its body on the `strip-say` line, and its answers as buttons in the acts column; the primary answer first; a note field appears inline when an answer wants one), posting to `/api/missions/<id>/<path>?project=` through `ctx.post`, then `ctx.refresh()`. The strip grid in `web/style.css` is the one to use; add nothing to it. No prompt.

- [ ] `[ENG]` **The four groups**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 3
  - mission: mission-page-and-inbox
  - milestone: 3
  - repo: root
  In `web/command.js`, `projectSection` composes four groups in this order and nothing else at the top level: `Needs you` (sessions that are blocked or waiting, every mission's `inboxRows` from `web/inbox.js`, and the `Needs action` sessions that carry a question), `Working` (busy sessions, formations and shells, missions whose `word` is `working` as one row each with their `diffstat`), `Ready to review` (missions in `review`, sessions whose last turn was Claude's and are idle under an hour), `Done` (done and stale sessions, closed missions, the closed list). Each group is a `rack` with the existing heading pattern and count; `Needs you` keeps `.rack.needs`, the loudest. Mission rows reuse `missionRow` with the diff stats added in the `where` column. Drag and drop between formation racks keeps working; the formation tabs stay. In `web/style.css`, only what the regrouping needs (a `.rack.review` heading colour); nothing else moves. Remove the old racks that these replace (`Shells`, `Idle`, `Stale`, `Background`), folding their strips into the groups above.

- [ ] `[ENG]` **The notification**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 4
  - mission: mission-page-and-inbox
  - milestone: 4
  - repo: root
  `src/notify.ts`: `newQuestions(before: Array<{ missionId, questions }>, after: same): Array<{ missionId, missionName, question }>` returning the questions present in `after` and not in `before`, matched by `missionId` and question `id`; pure, tested in `test/notify.test.ts`. In `app/main.mjs`, after the window opens, poll `/api/workspace` every 15 s, feed each pair to `newQuestions`, and for each result fire an Electron `Notification` titled with the mission name and bodied with the question title; clicking it focuses the window and loads `/mission.html?project=<id>&mission=<id>#progress`. No dependency; `Notification` is Electron's own. Nothing fires on the first poll.

- [ ] `[ENG]` **Workspace first**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 4
  - mission: mission-page-and-inbox
  - milestone: 4
  - repo: root
  The default view is `workspace`, not `board` (`view` resolution near `console.view` in `web/app.js`); the picker remembers the last opened project in `localStorage` (`mv.project`) and opens it straight away, with the picker one click away in the bar (the brand mark already links to `/`; add a `change project` ghost button beside the project pick). Nothing else in `app.js` changes.

- [ ] `[ENG]` **The docs**
  - created: 2026-10-13
  - source: mission mission-page-and-inbox, milestone 4
  - mission: mission-page-and-inbox
  - milestone: 4
  - repo: root
  Record decision M20 in `docs/03-decisions.md` in the house shape (read M18 and M19): the four anchors, the four status words, questions as feed entries answered in place, the inbox's four groups, the reply box, with the prior art named (`deliverables/plans/mission-ui-2026-10-13.md` has it). Architecture: `web/mission/` modules and the module contract, `src/questions.ts`, `src/feed.ts`, `src/notify.ts`, the stream route. Data model: `Question`, `FeedEntry`, `word`. Runbook: the `say` route, the stream, the notification. Glossary: anchor, status word, question, inbox. README's missions paragraph says what the person sees now. No em-dashes anywhere; the house style is in `docs/05-conventions.md`.

### Mission: The result reads itself

- [ ] `[ENG]` **Mission: The result reads itself**
  - created: 2026-10-14
  - source: Strike Lead interview, 2026-10-14
  - kind: mission
  - mission: the-result-reads-itself
  - plan: deliverables/missions/the-result-reads-itself.md
  What a mission leaves for Cory to read is today a wall of prose: every RIO note and every unverified claim printed verbatim under the task it belongs to, in the Result section of the mission page. He does not usually open the code, so the notes have to carry their own meaning. Cory's call on 2026-10-14: six changes, all of them. (1) The RIO writes structure, not prose: every finding is `KIND(area, severity): headline. detail`, so a page never guesses. (2) Triage, not a list: three buckets, fix before merge, fine to ship, unverified, with counts, only the first open by default, and the rail badge says `3 to fix`, not `12 notes`. (3) Grouped by area in plain names, beside the files it is about, with the diff a click away for the times he wants it. (4) Checkboxes that mean something: read, or later, and later writes a checklist line for him; the unread count is the badge. (5) The note sits inline beside the file rows it is about. (6) Ask the record: one button runs a short read-only pass over the carried list and the report and returns three bullets. This mission builds on the mission page from `mission-page-and-inbox` (PR #16), so it flies from `main` after that lands. It is deliberately not the palette, not the map, and not a change to how RIOs judge; only to how they write it down and how it is read. Nothing adds a dependency or a build step (M2); the design contract in `.ui-design/system.md` holds; no `window.prompt` anywhere.
  Milestone 1 — Findings carry their own structure: done when `npm test` passes; `findingsOf` in `src/audits.ts` sorts `- NOTE(web/signin, ship): focus is lost. The Wingman called it out of scope.` as a note and `- BLOCKER(src/worker, fix): ...` as a blocker; `src/findings.ts` turns both new and old-style lines into `Finding` records; a RIO brief generated by `bin/maverick brief <plan> <task> --role rio` says the format in one line with an example
  Milestone 2 — The Result section is triage: done when with a server running, `node tools/cdp.mjs "http://localhost:8767/mission.html?project=maverick&mission=<a mission with carried notes>" --eval check.js` reports a Result section with three bucket headings carrying counts, the first open and the others folded, each finding as a chip plus a headline with its detail folded, grouped by area beside the file rows, a read checkbox and a later button on each, and the rail's Result badge reading `<n> to fix`; `npm run lint` passes
  Milestone 3 — Ask the record: done when `POST /api/missions/<id>/summarize` on a mission with carried notes spawns one read-only session that writes `<record dir>/<id>-summary.md` with three bullets, the record carries `summary: { at, text }` once it lands, the Result section shows the bullets under a `What I must read` heading with a `summarize` button that reads `summarizing...` while it runs, and `npm test` passes
  Milestone 4 — The decision and the docs: done when `docs/03-decisions.md` carries M21; the runbook, data model and glossary name the finding format, the three buckets, read and later, and the summary; `npm run lint` passes

- [ ] `[ENG]` **The finding record**
  - created: 2026-10-14
  - source: mission the-result-reads-itself, milestone 1
  - mission: the-result-reads-itself
  - milestone: 1
  - repo: root
  Write `src/findings.ts`, pure. Export the `Finding` contract below and `parseFinding(line: string, taskId: string): Finding`. The line is one list item's text as `findingsOf` hands it over (the `- ` and any bold already stripped): the new shape `KIND(area, severity): headline. detail` where KIND is BLOCKER, NOTE or UNVERIFIED (case-insensitive), area is a path or a plain name (`web/signin`, `the sign-in form`), severity is one of `fix`, `ship`, `check`; and the old shape `KIND: free prose` or bare prose, where the area is `general`, the severity follows the kind (BLOCKER is `fix`, UNVERIFIED is `check`, NOTE is `ship`), and the headline is the first sentence (up to the first `. ` or the whole line under 120 characters), the detail the rest. A `carried` line that begins `unverified: ` (the way `settleReview` stores them) is an UNVERIFIED. Export `triage(findings: Finding[]): { fix: Finding[]; check: Finding[]; ship: Finding[] }`, each bucket grouped by area in first-seen order, and `areaName(area: string): string` that turns `web/signin/` into `web/signin` and leaves plain names alone. `test/findings.test.ts` pins both shapes, the fallback headline rule, every severity default, the carried `unverified:` prefix, and the triage order. No I/O.

- [ ] `[ENG]` **The RIO writes the shape, and the sorter reads it**
  - created: 2026-10-14
  - source: mission the-result-reads-itself, milestone 1
  - mission: the-result-reads-itself
  - milestone: 1
  - repo: root
  In `src/audits.ts`, `findingsOf` accepts an optional parenthetical after the kind: `^(BLOCKER|NOTE|UNVERIFIED)(?:\([^)]*\))?:\s*(.*)$`, keeping the whole text after the colon as the finding (the parenthetical is for `src/findings.ts` to read; `findingsOf` only sorts), and the existing test at `test/missions.test.ts` gains one case per kind in the new shape. In `src/briefs.ts`, `rioBrief` tells the RIO how to write a finding, in one line placed right where it says `each starting "BLOCKER:"`: every finding is `- KIND(area, severity): headline. detail`, area the path or the plain name of what it is about, severity `fix` (must change before merge), `ship` (fine to merge as is), `check` (a claim the RIO could not verify), headline one sentence a person who will not open the code can act on, detail the evidence; with one example of each kind. `RIO_CHECKLIST` gets no new line; this is the format of the answer, not a check. `test/briefs.test.ts` pins the format line and the example in the RIO brief and its absence from the Wingman brief. `settleReview` and `verdictOf` are untouched.

- [ ] `[ENG]` **The view carries the readings and remembers what was read**
  - created: 2026-10-14
  - source: mission the-result-reads-itself, milestone 1
  - mission: the-result-reads-itself
  - milestone: 1
  - repo: root
  Add to `MissionTask` an optional `readings?: Record<string, "read" | "later">` keyed by the finding key (contract below). In `src/missions.ts`, `missionView` adds `readings: Reading[]`: every finding from every task's `carried` lines and, for a handed-back task, from its findings file, through `parseFinding`, each with its key, task id, task title, milestone and the state from `task.readings`, triaged and grouped by area with `triage`. Export `markReading(project, id, taskId, key, state)`: a `changeMission` that sets the state, and for `later` also appends one line to the project's first tracker under its backlog heading, `- [ ] `[ENG]` **<headline>** (from mission <id>, <task title>; <area>)`, committed with the existing tracker commit path (read how `closeMission` ticks items), and writes `decision: <taskId> finding "<headline>" marked later by Cory` to the ledger. `server.ts`: `POST /api/missions/:id/tasks/:task/readings` with `{ key, state }`, added to the task route regex. Tests: a view fixture with two carried lines in each shape yields readings in triage order with the right keys; `markReading` records the state and, for `later`, the tracker line.

- [ ] `[ENG]` **The triage module**
  - created: 2026-10-14
  - source: mission the-result-reads-itself, milestone 2
  - mission: the-result-reads-itself
  - milestone: 2
  - repo: root
  Rewrite the `To read before you merge` part of `web/mission/result.js` on `view.readings`: three sections in this order, `Fix before merge`, `Unverified`, `Fine to ship`, each a `<details>` with its count in the summary, the first open, the others folded, an empty bucket drawn as one quiet line. Inside, group by area: the area name as a small heading, then one row per finding: a chip (`fix` in threat, `check` in info, `ship` in caution, the kind spelled in the chip's title), the headline in weight, a `read` checkbox and a `later` ghost button on the right, and the detail folded under a `why` toggle, never open by default. A read finding fades; a later one shows `on the checklist`. Both post to `tasks/<task>/readings` through `ctx.act` and patch in place from the next view. Where the merged-files list draws an area that has findings, draw those findings' chips inline on that area's row too (item 5), each chip a link to the finding's row. Keep the diff-by-task list and the rest of the section as they are. Style in `result.css` with the tokens: chips at 11px tracked uppercase, nothing a person reads below 11px, a 40px row.

- [ ] `[ENG]` **The rail badge**
  - created: 2026-10-14
  - source: mission the-result-reads-itself, milestone 2
  - mission: the-result-reads-itself
  - milestone: 2
  - repo: root
  In the shell, the Result anchor's count reads `<n> to fix` from `view.readings` (findings in the `fix` bucket not yet read), in caution when n > 0, else `<n> to read` for the rest unread, else `read`, else `not yet` before anything merged; the status word is untouched. Patch in place on every view.

- [ ] `[ENG]` **The summarizer**
  - created: 2026-10-14
  - source: mission the-result-reads-itself, milestone 3
  - mission: the-result-reads-itself
  - milestone: 3
  - repo: root
  In `src/briefs.ts`, export `summaryBrief(ctx: { missionName: string; report: string; readings: Reading[]; file: string })`: a read-only prompt that asks for exactly three bullets a person who will not open the code can act on, ordered fix first, naming the area in plain words, written to `file`, with the same tool fence a RIO gets (`RIO_TOOLS`). In `src/missions.ts`, export `summarizeMission(project, id)`: refuses when nothing has merged or a summary is already running, writes `mission.summary = { started }`, spawns the session with `spawnBackgroundAgent` in the project path as agent `rio` with `RIO_TOOLS`, records its id in `mission.summary.claudeId`, and the sweep (`recordFinished`) reads the file when the session ends and sets `summary = { at, text }`, or `summary.failed` with the reason when the file is missing. `missionView` carries `summary`. `server.ts`: `POST /api/missions/:id/summarize`. Tests with a fake spawn (read how the sweep tests stub agents): the refusals, the record after spawn, the record after the file lands, the failure.

- [ ] `[ENG]` **The summary on the page**
  - created: 2026-10-14
  - source: mission the-result-reads-itself, milestone 3
  - mission: the-result-reads-itself
  - milestone: 3
  - repo: root
  At the top of the Result section, `What I must read`: the three bullets from `view.summary.text` in body weight, the time it was written, and a `summarize` button (`summarize again` once one exists) that posts `summarize` through `ctx.act` and reads `summarizing...` disabled while `summary.started` is set with no `at`; a failed summary says why in one line with the button live again. Nothing merged yet: the heading says what the button will do, disabled.

- [ ] `[ENG]` **The docs**
  - created: 2026-10-14
  - source: mission the-result-reads-itself, milestone 4
  - mission: the-result-reads-itself
  - milestone: 4
  - repo: root
  Record decision M21 in the house shape (read M18 to M20): findings carry their structure at the source, the Result section is triage not a list, read and later are a person's marks with later writing the checklist, and the summary is a read-only pass over the record. Data model: `Finding`, `Reading`, `readings`, `summary`. Runbook: the readings route and the summarize route. Glossary: finding, triage, reading, summary. README's missions paragraph gains one sentence. No em-dashes.

### Mission: Progress reads itself

- [ ] `[ENG]` **Mission: Progress reads itself**
  - created: 2026-10-14
  - source: Strike Lead interview, 2026-10-14
  - kind: mission
  - mission: progress-reads-itself
  - plan: deliverables/missions/progress-reads-itself.md
  The Progress section of the mission page prints the ledger raw: one row per transition, six rows for a task's two attempts, and every `passed` line dragging the whole `[carried: ...]` blob behind it, so a flight reads as a wall. Cory's calls on 2026-10-14, after the second mission landed: (1) the ledger stops carrying the notes; a line says how many and the notes live on the task and in the findings file, which fixes the feed, the plan file on the branch and the report at once. (2) One card per task, not one row per move: a task's attempts as a compact timeline, the raw moves on demand. (3) Default to what matters: decisions, verdicts and questions show; automatic moves fold under `show every move (N)`. (4) Verdict chips, not verdict prose: `10 notes · 1 unverified` as chips that jump to the triage rows in Result. (5) Terse at the source: the RIO's headline under fifteen words, detail under three sentences; the summary exactly three bullets, each under twenty words, and the server keeps only the first three. (6) One card component for a task, a question, a finding and a summary bullet, so every section reads the same. And one more from the same look at the page: the page is one column with no boxes; the ask spans its column instead of stopping at 34 characters, and sections are set apart by space, not panels; the gate before approval is the one lifted panel. Builds on `mission-page-and-inbox` (#16) and `the-result-reads-itself` (#18), both on `main`. Not the palette, not the map, not the inbox. No dependency, no build step (M2); the design contract in `.ui-design/system.md` holds; no `window.prompt`.
  Milestone 1 — The ledger says less and the record keeps more: done when `npm test` passes; a task passing with notes writes a ledger line ending `with 10 notes carried, 1 unverified` and no `[carried:` anywhere in the plan on the mission branch; `feedOf` reads both that line and the old `[carried: ...]` shape into an entry with `counts`; `missionView` carries `moves` (one timeline per task per attempt) and a summary is at most three bullets whatever the session wrote
  Milestone 2 — Cards: done when with the server running, the mission page for `mission-page-and-inbox` shows Progress as one card per task with an attempt timeline, decisions and questions visible, automatic moves folded under a `show every move` toggle, verdict chips that scroll to a triage row, the ask spanning its column, no `.panel` on any section after approval, and `npm run lint` passes
  Milestone 3 — The decision and the docs: done when `docs/03-decisions.md` carries M22; the data model names `Move` and `counts`; the runbook names the ledger line shape and the three-bullet rule; `npm run lint` passes

- [ ] `[ENG]` **The ledger line and the feed entry**
  - created: 2026-10-14
  - source: mission progress-reads-itself, milestone 1
  - mission: progress-reads-itself
  - milestone: 1
  - repo: root
  In `src/missions.ts` `transitions()` (the line builder near `[carried:`), a task that passes with carried notes writes `... (RIO: pass with notes) with N notes carried, M unverified` (omit `, M unverified` when zero) and never the notes themselves; the notes stay on `task.carried` and in the findings file, which the report and the Result already read. A decision line keeps the person's full note (it is their words). In `src/feed.ts`, `FeedEntry` gains `counts?: { notes: number; unverified: number; blockers: number }`: filled from the new line shape, and, for old ledgers, from a trailing `[carried: ...]` block, which is then stripped from `text` (count `unverified:` prefixes and `UNVERIFIED(` leads as unverified). A handed-back line gets `blockers` from the `N blocker(s) open` phrase when present. Tests pin the new line, the old block stripped into counts, and a line with neither.

- [ ] `[ENG]` **Terse at the source**
  - created: 2026-10-14
  - source: mission progress-reads-itself, milestone 1
  - mission: progress-reads-itself
  - milestone: 1
  - repo: root
  `src/briefs.ts`: the RIO brief's finding-format line gains the length rule, headline under fifteen words and detail under three sentences, with the example trimmed to match; `summaryBrief` asks for exactly three bullets, each under twenty words, naming the area in plain words, and nothing before or after them. `src/summary.ts`, pure: `threeBullets(text: string): string` keeps the first three top-level list items of a markdown text (bullets or numbered), each cut at its first line, and returns them as three `- ` lines; a text with fewer than three list items is returned as its list items plus the first sentence of any prose as a bullet, never more than three. `test/summary.test.ts` pins the cut, a numbered list, prose only, and an empty text (empty string back). `test/briefs.test.ts` pins both rules.

- [ ] `[ENG]` **Moves on the view, bullets on the record**
  - created: 2026-10-14
  - source: mission progress-reads-itself, milestone 1
  - mission: progress-reads-itself
  - milestone: 1
  - repo: root
  `missionView` adds `moves: Move[]` (contract below) derived from the feed: for each task, one `Move` per attempt with the stamps of its launch, hand-off (`built`), review start, and its end (`passed`, `handed-back`, or `retry` when the next attempt launched), the verdict and the `counts` from the passed or handed-back entry; attempts are numbered from the launches in order. `settleSummary` stores `threeBullets(text)` as `summary.text` and the raw text as `summary.raw`. Tests: a ledger with one task over two attempts yields two moves with the right stamps and verdicts; a summary file with five bullets lands as three.

- [ ] `[ENG]` **The card**
  - created: 2026-10-14
  - source: mission progress-reads-itself, milestone 2
  - mission: progress-reads-itself
  - milestone: 2
  - repo: root
  Write `web/card.js` exporting `card(spec, ctx)` per the contract below: a 40 px head row (lamp or kind glyph, title in weight, chips on the right, an optional act button) and a body that folds (`headline` always shown, `detail` under a `why` toggle, closed by default), plus `update(spec)` that patches text, chips and state in place by key and never rebuilds an open fold. Chips use the existing `.chip` class with the three severity colours scoped under `.card`. `card.css` carries the tokens' densities: 40 px row, 13.5 px title, 11 px tracked chips, 8 px between rows, 16 px between cards. Keyboard: the head is a button when the card folds; focus visible. Render a page of cards in headless Chrome at 1440 and 390 before you stop.

- [ ] `[ENG]` **Progress as cards**
  - created: 2026-10-14
  - source: mission progress-reads-itself, milestone 2
  - mission: progress-reads-itself
  - milestone: 2
  - repo: root
  Rewrite `web/mission/progress.js` on `card` and `view.moves`: the open questions stay pinned at the top as question cards (answers through `answerControls` as today); then one card per task, in plan order, grouped under its milestone heading, whose head row shows the task's lamp, title and the chips of its last move (`2 attempts`, `10 notes`, `1 unverified`, `blocker`) and whose body is the attempt timeline, one line per attempt: `attempt 1 · out 09:42 · built 09:45 · reviewed 09:48 · pass with notes`, the verdict as a chip that scrolls to the matching triage rows in Result (`#rd-<taskId>` anchors from the result module; link by task id). Decisions (`who: you`) are their own cards in time order between the task cards they concern, with the full note folded. Everything else, every automatic move, is folded under one `show every move (N)` toggle at the bottom of each milestone group that reveals the raw feed rows as today. The reply box stays at the bottom. `update(view)` patches by task id and attempt.

- [ ] `[ENG]` **Result and the summary on cards**
  - created: 2026-10-14
  - source: mission progress-reads-itself, milestone 2
  - mission: progress-reads-itself
  - milestone: 2
  - repo: root
  The triage rows become cards: chip, headline, read box and later button on the head row, detail folded, the same `#rd-<key>` ids kept so chips elsewhere still land. The three summary bullets become three cards under `What I must read`, each with a chip for the bucket it names when the bullet starts with `fix`, `check` or `ship`. `result.css` loses whatever `card.css` now carries.

- [ ] `[ENG]` **One column, no boxes**
  - created: 2026-10-14
  - source: mission progress-reads-itself, milestone 2
  - mission: progress-reads-itself
  - milestone: 2
  - repo: root
  After approval the page's sections are set apart by space, not panels: no `.panel` or background on The ask, Plan, Progress or Result, 48 px between sections, a 15 px section heading. The ask's sentence spans its column (`max-width: 66ch` on the paragraph, none on the heading). Before approval the gate keeps its lifted panel (the one loud thing), and the contracts and the plan-as-written lose theirs. Drop `ship.css` from `mission.html` once nothing on the page uses it, moving the two or three rules the gate still needs into `mission.css`. Render at 1440 and 390 before you stop.

- [ ] `[ENG]` **The docs**
  - created: 2026-10-14
  - source: mission progress-reads-itself, milestone 3
  - mission: progress-reads-itself
  - milestone: 3
  - repo: root
  Record decision M22 in the house shape (read M20 and M21): the ledger says how many and the record keeps the notes, Progress is one card per task with its attempts, automatic moves fold, verdicts are chips, the RIO and the summary are terse by brief and by code, one card component, one column with no boxes. Data model: `Move`, `FeedEntry.counts`, `summary.raw`. Runbook: the ledger line shape and that old ledgers still read. Glossary: move, card. No em-dashes.

## 🚧 In Progress

- [~] `[ENG]` `[L]` **The mission page and the inbox**
  - created: 2026-10-13
  - source: the first fixture flight, 2026-10-12; four options drawn from Devin, Jules, Linear, Superset, Conductor, Factory
  - kind: feature
  - plan: plans/mission-ui-2026-10-13.md
  - mission: missions/mission-page-and-inbox.md
  - status: flying overnight 2026-10-13 as a Maverick mission; Cory picked option 3 in front of 1 with 4's reply box
  The workspace as an inbox (Needs you, Working, Ready to review, Done), the mission page with four
  fixed anchors (The ask, Plan, Progress, Result) and one status word, questions as feed entries
  answered in place and pushed as a notification, a reply box to the Strike Lead. Mockups in
  `.ui-design/mockups/`, served at `/mockups/`.

## 📋 Backlog

- [ ] `[ENG]` `[M]` **Checkbox flips from the board** — tick an item in the UI, write `- [x]` back.
  - created: 2026-09-14
- [ ] `[ENG]` `[M]` **Ship-time `release: next+1` → `next` rewrite**, today a manual edit.
  - created: 2026-09-15
- [ ] `[ENG]` `[L]` **The manager agent** — one agent whose only tools are the console API (boards,
  sessions, spawn, assign, handoffs) and which never touches code. Merges and promotions stay
  Cory's buttons.
  - created: 2026-09-14
- [ ] `[ENG]` `[M]` **"Who is behind" on the project picker** — a fix to the flow, a skill, or a
  UI-testing pattern in one repo should not leave the others behind. Decided 2026-09-16: do **not**
  build a propagation engine. Skills already propagate (one versioned `flynn-kit` plugin at user
  scope), standards already propagate (one `WORKSPACE.md`, one `check.py`). What is missing is
  visibility. Show per project: doc-standard governed or not, `RULEBOOK.md` present and newer than
  the last workspace change, readiness level, installed plugin version vs. latest. The picker
  already enumerates the repos and already has somewhere to put a badge.
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
- [ ] `[ENG]` `[M]` **Highlights in the ship / session review walkthrough** — _note only, not
  scoped._ The walkthrough already deep-links to the exact page under test and fills it with
  realistic data. Next step is showing the reviewer **where to look**: a highlight that flashes on
  the element and fades, the same device the Realtime tutorial uses. Lift the pattern from
  Realtime's tutorial rather than inventing one. Open: how a walkthrough step names its target
  (selector, test id, or a coordinate the QA pass captured), and whether the highlight is driven by
  the walkthrough document or by the session that wrote it.
  - created: 2026-09-16
  - source: Cory, 2026-09-16
  - kind: feature
- [ ] `[ENG]` `[M]` **Support agents other than Claude Code.** `web/providers/` already has the
  shape. Every competitor runs Codex alongside Claude; Maverick reading only one runtime is a
  ceiling, not a position.
  - created: 2026-09-16

- [~] `[ENG]` `[L]` **Planned and recurring ship days on the calendar.** The calendar today only
  plots item deadlines (`due:`) and releases already computed from the changelog. It cannot hold a
  *future* ship. Add a ship day as its own event: pick a date on the calendar, and set a recurrence
  (weekly, every other week, whatever cadence the operator picks) so the next ones are already
  there. Needs the interface (place one, set the cadence, move one, cancel one) and the backing
  record. **Decided by Cory 2026-09-17:** a schedule is the first thing the markdown trackers
  genuinely cannot hold, so it earns a new named exception, a ship dates tracker and schedule under
  `~/.claude/session-console/`. Still not a database. Notify on the morning of: "ship day". Other
  recurring notifications should hang off the same mechanism.
  **Why, from Cory 2026-09-17, mid-ship:** three weeks between ships and the pile of untested
  changes is the part that hurts. Testing is the tedious step and there is no removing it, but a
  weekly or biweekly cadence keeps each batch small enough to stomach. The cadence is the product
  feature; the calendar is where it becomes visible.
  **What it sets up (not now):** once a ship day is a scheduled event, work can fire *on* it.
  Auto-generate the session review for the batch when ship day arrives, and so on. Reason enough to
  model it as a real scheduled event rather than a reminder string.
  **Built 2026-09-18 on `feat/ship-schedule`:** `src/ship-schedule.ts` (the cadence, one-offs,
  skips, moves and shipped history, keyed to the day the cadence generated so a pushed-back day
  still knows where it was meant to be), three `/api/ship-schedule` routes, ship days on the
  calendar with drag-to-move and a drawer, the cadence control, and the ship-day banner above
  every view. Ten tests in `test/ship-schedule.test.ts`; verified in the browser against a seeded
  schedule. **Left open:** an OS-level notification, which a browser tab cannot do when it is
  closed, so it properly belongs to the Electron shell.
  - created: 2026-09-17
  - source: Cory, 2026-09-17, while shipping Realtime
  - kind: feature
  - status: merged to main 2026-10-07 (#1), pending release

- [ ] `[ENG]` `[S]` **Gamify the ship.** _Note only, not scoped._ Marking a ship complete should
  feel like something: "mission complete", with a plane getting up into the sky. Pushing a ship day
  back is the opposite: mission failed, the plane crashes and burns. Fits the callsign language the
  console already speaks (Maverick, Wingman, Strike Lead) and gives the cadence above teeth, since
  a slipped ship day should cost something visible. Open: what the animation actually is, and
  whether anything is tracked across ships (a streak) or it is purely per-event.
  - created: 2026-09-17
  - source: Cory, 2026-09-17
  - kind: feature

- [ ] `[ENG]` `[M]` **Fire an overnight build session from Maverick.** _Note only, not scoped._
  Tonight's run (2026-10-06) was set up by hand in a terminal: a queue of checklist items in
  priority order, a stop line (push and open draft PRs, never merge), and `caffeinate` to keep
  the machine awake. All of that is a form Maverick could show: pick the items, pick the stop
  line, press go, read the PRs in the morning. The Strike Lead already dispatches background
  agents; this is the same dispatch pointed at a queue instead of a plan, and the morning read is
  the session review that already exists.
  - created: 2026-10-06
  - source: Cory, 2026-10-06, going to bed
  - kind: feature

- [~] `[ENG]` `[M]` **A gated walkthrough on every mission task, the way the ship has one.** _Note
  only, not scoped._ The ship page already hosts a walkthrough document inside a step and marks the
  step done only when the human has been through it (`src/ships.ts`, the `walkthrough` step). The
  `/develop` skill now produces the same kind of walkthrough per feature. A mission is a pile of
  smaller PRs under one Strike Lead, and today a task goes `built → reviewing → passed` on the
  RIO's verdict alone; nobody walks it. Give each task (or each milestone, to be decided) the same
  hosted walkthrough and the same gate: the task is not `passed` until the walkthrough is answered,
  and the mission page shows where each one stands. Reuse the ship page's walkthrough panel and the
  `walkthrough` record on the step rather than inventing a second shape. Open: whether the Wingman
  writes the walkthrough as part of its task or the Strike Lead commissions it after the RIO passes;
  and per task vs. per milestone (per milestone matches "validation at every milestone" above).
  **Built 2026-10-06, merged 2026-10-07 (#2):** per milestone. At merge the sweep sends a session
  into the integration worktree to write the milestone's walkthrough on the mission branch; the
  milestone page hosts it through the panel lifted out of the ship page (`web/walkthrough.js`);
  `closeMission` refuses until every milestone that changed anything is walked or waived with a
  reason. The next milestone is not held; only the landing is. Decisions M12. Verified under test
  and with the page served, not yet against a live mission with real agents.
  - created: 2026-09-24
  - source: Cory, 2026-09-24
  - kind: feature
  - status: merged to main 2026-10-07 (#2), pending release

- [ ] `[ENG]` `[M]` **One response format from every agent, parsed and shown as sections.** _Note
  only, not scoped; the section list is still being decided._ Every reply Maverick reads back from
  an agent should arrive in one fixed, parseable shape, and the console should render it as
  labelled sections you can scan and skip rather than as a wall of prose. Sections named so far:
  **what changed**, **decisions** (the call, what it was chosen over, how it is set up, briefly),
  and a **TL;DR at the very bottom**. Candidates to settle: **verified** (what was actually run and
  what was not), **open** (questions, assumptions, blockers), **next**. Four to five short blocks,
  not an essay. Enforced where Maverick already writes the prompt (Wingman, RIO, Strike Lead, ship
  steps) and rendered by the transcript view, which already splits replies into events
  (`src/transcript-view.ts`). Sits underneath the event timeline item below: a structured reply is
  the last event of a turn.
  - created: 2026-09-24
  - source: Cory, 2026-09-24
  - kind: feature

- [ ] `[ENG]` `[M]` **The live stream as a timeline of events that stand out, with a running
  clock.** _Note only, not scoped._ Watching a session today is watching Claude Code's own stream:
  everything scrolls past at the same weight. Wanted: a broader, simplified view of the same
  transcript where the things that matter are distinct events you can spot at a glance, a decision,
  a change to a file, a test run and its result, a question waiting on you, and each running thing
  shows a live timer for how long it has been going. Quick to review after the fact for exactly
  what happened, without reading the whole transcript. `src/transcript-view.ts` already turns the
  jsonl into events; this is the classification and the UI on top. Pairs with the response format
  above.
  - created: 2026-09-24
  - source: Cory, 2026-09-24
  - kind: feature

### Brainstorm: what the breakdown step should look like

- [ ] `[ENG]` **Per-item edits at the breakdown gate**
  - created: 2026-10-08
  - source: brainstorm deliverables/brainstorms/2026-10-08-what-the-breakdown-step-should-look-like.md, 2026-10-08
  - kind: feature
  - size: M
  Keep, drop, resize, re-kind, or move an item between now, backlog and mission on the breakdown
  page before the one approve writes what is left. M15 rejected this for the first cut: the gate
  is whole-document, as a mission's is, and the fix for a wrong proposal is *propose again*.
  Proposed items are independent of each other, unlike milestones, so edits are sound here in a
  way they are not on a mission plan. The design constraint a plan session has to hold: the
  frozen artifact must be the *approved* list, so approve writes the edited proposal document
  back before it stamps, or the page and the file disagree, which is the exact reason M15 said
  no. Pull this up when dropping two bullets has turned into a conversation with the CAG too
  often; until then the whole-document gate stands.

- [ ] `[ENG]` **The board tells a release group from a Mission or Brainstorm group**
  - created: 2026-10-08
  - source: brainstorm deliverables/brainstorms/2026-10-08-what-the-breakdown-step-should-look-like.md, 2026-10-08
  - kind: feature
  - size: M
  Every `###` group under Priority is treated as a release: ordering, the deploy-date drawer,
  the release verbs. A `Mission:` group already bent that, and a `Brainstorm:` group now bends
  it the same way. M15 recorded the consequence and Cory's call to live with it. The brick, when
  it is picked up: read a Priority group's kind from its prefix (a release, a `Mission:`, a
  `Brainstorm:`), withhold the release verbs and the deploy-date drawer from the named kinds, and
  give a `Brainstorm:` group its own verbs (open the breakdown gate, read the brainstorm). The
  prefix is the only signal the markdown carries, which is the point: no new field, no store.

- [ ] `[ENG]` **The gate hands a now item straight to its plan session**
  - created: 2026-10-08
  - source: brainstorm deliverables/brainstorms/2026-10-08-what-the-breakdown-step-should-look-like.md, 2026-10-08
  - kind: feature
  - size: S
  A *now* item arrives unplanned on purpose, and the gate says *plan it* is its next verb, but
  that verb lives in the board drawer, so the path from the gate to the first plan session is a
  tab switch and a search. The brainstorm's stronger version, approve opens a plan interview per
  item, was turned down because six items would mean six sittings. The honest middle: after
  approve, the breakdown page lists the roadmap items it just wrote, each with a *plan it* that
  opens the same CAG plan session the drawer opens, one terminal at a time, nothing automatic.
  The gate already knows the titles and the tracker; it is one list and one existing route.

- [ ] `[ENG]` **A Strike Lead opened from a breakdown reads the brainstorm too**
  - created: 2026-10-08
  - source: brainstorm deliverables/brainstorms/2026-10-08-what-the-breakdown-step-should-look-like.md, 2026-10-08
  - kind: chore
  - size: S
  `approveBreakdown` opens the mission with the proposal as its `from` document, and the
  interview prompt says to read that document first because it holds the reasoning. It holds the
  item's body; the reasoning is in the brainstorm one folder over, which the prompt never names.
  Name both: the proposal for the item and its call, the brainstorm for the conversation that
  produced it. One line in `interviewPrompt`, or `from` becomes the brainstorm and the proposal
  is named beside it.

## ✅ Recently shipped, pending release

- [x] `[ENG]` `[L]` **Mission protocol v2** — the plan on the mission branch is the ledger, one
  brief template, a read-only `rio.md` agent, `touches` / `needs` / `deploys` with mechanical
  checks, BLOCKER / NOTE verdicts and merge-with-notes (#11, M18, M19); then dispatch by needs,
  contracts, pause-not-end, preflight, the generated report, shared environments and a proof
  (#12). Not yet flown on a live mission: the next mission on a fixture project is the test.
  Plan: plans/mission-protocol-v2-2026-10-09.md. _2026-10-09 (#11), 2026-10-11 (#12)._
- [x] `[ENG]` `[L]` **Electron shell, and Maverick posted as a free, open-source download** —
  `app/` (Electron 44, its own `package.json`), the Release workflow on a `v*` tag, the README with
  Cory's statement up front, and the public-repo files. Decision M15. Released as v0.1.0, ad-hoc
  signed; Apple Developer enrollment for a signed build is in progress.
  Plan: plans/maverick-public-release-2026-10-07.md. _2026-10-08 (#5, v0.1.0)._
- [x] `[OSS]` **MIT `LICENSE`** — the repo was public with no license, which made it legally
  unusable by anyone who found it. _2026-09-16._
- [x] `[DOC]` **`RULEBOOK.md`** — Maverick is held to the workspace standard it reads for everyone
  else. _2026-09-16._
- [x] `[DOC]` **This checklist** — Maverick now appears in its own project picker. _2026-09-16._
