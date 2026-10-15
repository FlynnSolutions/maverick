# Mission: Progress reads itself

The Progress section of the mission page prints the ledger raw: one row per transition, six rows for a task's two attempts, and every `passed` line dragging the whole `[carried: ...]` blob behind it, so a flight reads as a wall. Cory's calls on 2026-10-14, after the second mission landed: (1) the ledger stops carrying the notes; a line says how many and the notes live on the task and in the findings file, which fixes the feed, the plan file on the branch and the report at once. (2) One card per task, not one row per move: a task's attempts as a compact timeline, the raw moves on demand. (3) Default to what matters: decisions, verdicts and questions show; automatic moves fold under `show every move (N)`. (4) Verdict chips, not verdict prose: `10 notes · 1 unverified` as chips that jump to the triage rows in Result. (5) Terse at the source: the RIO's headline under fifteen words, detail under three sentences; the summary exactly three bullets, each under twenty words, and the server keeps only the first three. (6) One card component for a task, a question, a finding and a summary bullet, so every section reads the same. And one more from the same look at the page: the page is one column with no boxes; the ask spans its column instead of stopping at 34 characters, and sections are set apart by space, not panels; the gate before approval is the one lifted panel. Builds on `mission-page-and-inbox` (#16) and `the-result-reads-itself` (#18), both on `main`. Not the palette, not the map, not the inbox. No dependency, no build step (M2); the design contract in `.ui-design/system.md` holds; no `window.prompt`.

## Milestone 1 — The ledger says less and the record keeps more

_done when: `npm test` passes; a task passing with notes writes a ledger line ending `with 10 notes carried, 1 unverified` and no `[carried:` anywhere in the plan on the mission branch; `feedOf` reads both that line and the old `[carried: ...]` shape into an entry with `counts`; `missionView` carries `moves` (one timeline per task per attempt) and a summary is at most three bullets whatever the session wrote._

- [~] **The ledger line and the feed entry**
  - touches: src/missions.ts, src/feed.ts, test/feed.test.ts, test/missions.test.ts
  - status: reviewing
  - attempt: 1
  - commit: 07677d1
  In `src/missions.ts` `transitions()` (the line builder near `[carried:`), a task that passes with carried notes writes `... (RIO: pass with notes) with N notes carried, M unverified` (omit `, M unverified` when zero) and never the notes themselves; the notes stay on `task.carried` and in the findings file, which the report and the Result already read. A decision line keeps the person's full note (it is their words). In `src/feed.ts`, `FeedEntry` gains `counts?: { notes: number; unverified: number; blockers: number }`: filled from the new line shape, and, for old ledgers, from a trailing `[carried: ...]` block, which is then stripped from `text` (count `unverified:` prefixes and `UNVERIFIED(` leads as unverified). A handed-back line gets `blockers` from the `N blocker(s) open` phrase when present. Tests pin the new line, the old block stripped into counts, and a line with neither.

- [~] **Terse at the source**
  - touches: src/briefs.ts, src/summary.ts, test/briefs.test.ts, test/summary.test.ts
  - status: flying
  - attempt: 2
  `src/briefs.ts`: the RIO brief's finding-format line gains the length rule, headline under fifteen words and detail under three sentences, with the example trimmed to match; `summaryBrief` asks for exactly three bullets, each under twenty words, naming the area in plain words, and nothing before or after them. `src/summary.ts`, pure: `threeBullets(text: string): string` keeps the first three top-level list items of a markdown text (bullets or numbered), each cut at its first line, and returns them as three `- ` lines; a text with fewer than three list items is returned as its list items plus the first sentence of any prose as a bullet, never more than three. `test/summary.test.ts` pins the cut, a numbered list, prose only, and an empty text (empty string back). `test/briefs.test.ts` pins both rules.

- [ ] **Moves on the view, bullets on the record**
  - touches: src/missions.ts, test/missions.test.ts
  - needs: m1-t1, m1-t2
  - status: pending
  `missionView` adds `moves: Move[]` (contract below) derived from the feed: for each task, one `Move` per attempt with the stamps of its launch, hand-off (`built`), review start, and its end (`passed`, `handed-back`, or `retry` when the next attempt launched), the verdict and the `counts` from the passed or handed-back entry; attempts are numbered from the launches in order. `settleSummary` stores `threeBullets(text)` as `summary.text` and the raw text as `summary.raw`. Tests: a ledger with one task over two attempts yields two moves with the right stamps and verdicts; a summary file with five bullets lands as three.

## Milestone 2 — Cards

_done when: with the server running, the mission page for `mission-page-and-inbox` shows Progress as one card per task with an attempt timeline, decisions and questions visible, automatic moves folded under a `show every move` toggle, verdict chips that scroll to a triage row, the ask spanning its column, no `.panel` on any section after approval, and `npm run lint` passes._

- [ ] **The card**
  - touches: web/card.js, web/card.css
  - status: pending
  Write `web/card.js` exporting `card(spec, ctx)` per the contract below: a 40 px head row (lamp or kind glyph, title in weight, chips on the right, an optional act button) and a body that folds (`headline` always shown, `detail` under a `why` toggle, closed by default), plus `update(spec)` that patches text, chips and state in place by key and never rebuilds an open fold. Chips use the existing `.chip` class with the three severity colours scoped under `.card`. `card.css` carries the tokens' densities: 40 px row, 13.5 px title, 11 px tracked chips, 8 px between rows, 16 px between cards. Keyboard: the head is a button when the card folds; focus visible. Render a page of cards in headless Chrome at 1440 and 390 before you stop.

- [ ] **Progress as cards**
  - touches: web/mission/progress.js, web/mission/progress.css
  - needs: m2-t1
  - status: pending
  Rewrite `web/mission/progress.js` on `card` and `view.moves`: the open questions stay pinned at the top as question cards (answers through `answerControls` as today); then one card per task, in plan order, grouped under its milestone heading, whose head row shows the task's lamp, title and the chips of its last move (`2 attempts`, `10 notes`, `1 unverified`, `blocker`) and whose body is the attempt timeline, one line per attempt: `attempt 1 · out 09:42 · built 09:45 · reviewed 09:48 · pass with notes`, the verdict as a chip that scrolls to the matching triage rows in Result (`#rd-<taskId>` anchors from the result module; link by task id). Decisions (`who: you`) are their own cards in time order between the task cards they concern, with the full note folded. Everything else, every automatic move, is folded under one `show every move (N)` toggle at the bottom of each milestone group that reveals the raw feed rows as today. The reply box stays at the bottom. `update(view)` patches by task id and attempt.

- [ ] **Result and the summary on cards**
  - touches: web/mission/result.js, web/mission/result.css
  - needs: m2-t1
  - status: pending
  The triage rows become cards: chip, headline, read box and later button on the head row, detail folded, the same `#rd-<key>` ids kept so chips elsewhere still land. The three summary bullets become three cards under `What I must read`, each with a chip for the bucket it names when the bullet starts with `fix`, `check` or `ship`. `result.css` loses whatever `card.css` now carries.

- [ ] **One column, no boxes**
  - touches: web/mission.css, web/mission.js, web/mission.html
  - status: pending
  After approval the page's sections are set apart by space, not panels: no `.panel` or background on The ask, Plan, Progress or Result, 48 px between sections, a 15 px section heading. The ask's sentence spans its column (`max-width: 66ch` on the paragraph, none on the heading). Before approval the gate keeps its lifted panel (the one loud thing), and the contracts and the plan-as-written lose theirs. Drop `ship.css` from `mission.html` once nothing on the page uses it, moving the two or three rules the gate still needs into `mission.css`. Render at 1440 and 390 before you stop.

## Milestone 3 — The decision and the docs

_done when: `docs/03-decisions.md` carries M22; the data model names `Move` and `counts`; the runbook names the ledger line shape and the three-bullet rule; `npm run lint` passes._

- [ ] **The docs**
  - touches: docs/02-data-model.md, docs/03-decisions.md, docs/06-runbook.md, docs/07-glossary.md
  - status: pending
  Record decision M22 in the house shape (read M20 and M21): the ledger says how many and the record keeps the notes, Progress is one card per task with its attempts, automatic moves fold, verdicts are chips, the RIO and the summary are terse by brief and by code, one card component, one column with no boxes. Data model: `Move`, `FeedEntry.counts`, `summary.raw`. Runbook: the ledger line shape and that old ledgers still read. Glossary: move, card. No em-dashes.

## Contracts

- **ledger pass line** (owner: m1-t1): `<stamp> <taskId> <title>: reviewing to passed (RIO: <verdict>) with <N> notes carried[, <M> unverified]`; old ledgers' `[carried: ...]` block still read
- **FeedEntry.counts** (owner: m1-t1): `counts?: { notes: number; unverified: number; blockers: number }`
- **threeBullets** (owner: m1-t2): `threeBullets(text: string): string`, at most three `- ` lines
- **Move** (owner: m1-t3): `{ taskId: string; title: string; milestone: number; attempt: number; out?: string; built?: string; reviewed?: string; ended?: string; end?: "passed" | "handed-back" | "retry"; verdict?: string; counts?: FeedEntry["counts"] }`; `MissionView.moves: Move[]` in plan order then attempt order; `Mission.summary.raw` the session's full text
- **card** (owner: m2-t1): `card({ key, lamp?, kind?, title, chips?: Array<{ text, cls?, href? }>, headline?, detail?, act?: { label, onclick }, open? }, ctx): { node, update(spec) }` in `web/card.js`; styles in `web/card.css`; a finding row keeps id `rd-<key>`

## Preflight

- duration: 4h
- tool: claude
- tool: git
- runtime: node, 22
- human: Cory said go on 2026-10-14; the ask's width and the boxes are his own words


## Log

- 2026-10-14 21:35 m1-t1 The ledger line and the feed entry: pending to flying
- 2026-10-14 21:35 m1-t2 Terse at the source: pending to flying
- 2026-10-14 21:38 m1-t2 Terse at the source: flying to reviewing
- 2026-10-14 21:39 m1-t1 The ledger line and the feed entry: flying to reviewing
- 2026-10-14 21:40 m1-t2 Terse at the source: reviewing to flying
