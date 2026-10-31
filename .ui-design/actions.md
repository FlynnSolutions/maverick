# Actions

What a person can do on each surface, decided before any visual work (ui-design, section 1 of
`reference/actions.md`). `ui-audit` walks every row on the rendered page. A surface not listed
here has not been tabled yet; table it before its next audit.

## The mission page, before approval: the gate and the Strike Lead

The collection here is one plan, written by the Strike Lead, not by the person: there is no
create, edit, move or delete of milestones or tasks on the page. The plan is changed by asking
the Strike Lead, and the plan document stays the source.

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Plan | Approve and fly | "approve and fly" in the gate, then "yes, approve" | First press says what it writes and spawns and moves focus to "not yet"; the second fires and the status line says the first milestone is out | None; the confirm replaces the button in place | GitHub merge confirm, Vercel promote |
| Plan | Fire from the chat | "Fire mission" under the Strike Lead's ready message, then "yes, fire" | Same two presses as the gate, same message | None | (same action as above, at the other place it is read) |
| Plan | Go to it from the top | "read the terms and fire" in `#now` while the plan is ready; "answer them" while a round is open | The gate's verb, or the round's first option, takes focus | Scrolls into view | Linear inbox |
| Plan | Back out of firing | "not yet" | The arm button returns and takes focus | None | GitHub, Vercel |
| Plan | Read the whole document | "read the plan document" | Opens the file in Files, in a new tab | None | GitHub "view file" |
| Plan | Change it | Write to the Strike Lead (box, Enter or "send") | The message lands in the thread; "the Strike Lead is reading and writing back" while it works; the gate redraws when the plan changes | New messages are placed in time order, nothing else moves | Linear AI, Copilot chat |
| Strike Lead's questions | Answer a round | Option buttons (toggle), "or in your own words", then "send answers" | The picked option shows pressed; the round folds to "N questions asked" once sent | None | Claude, Perplexity follow-ups |
| Strike Lead | Open its session | "open its session in a terminal" | A live terminal opens under the thread | None | Claude Code, Codex |
| Mission | Go to what is waiting | The "waiting for you" lamp in the rail | Lands on it with its control focused: the gate's approve before approval, an open round's first option, the questions after; a second press lands again | Scroll into view, nothing else moves | Linear inbox, GitHub notifications |
| Plan with problems | Have them fixed | Nothing to press: the problems go to the Strike Lead; the person can write to it if it stalls | The problems list in the gate, with what each one needs | None | (Maverick's own) |

Undo: approving is not undoable (it writes the tracker and spawns agents), so it is guarded by
the second press instead; a message to the Strike Lead is answered rather than retracted.

## The mission page, after approval (`web/mission.html`)

The page's question is "what is waiting on me", so every action that answers one lives in `#now`
first and in its section second. Feedback is a toast (`web/toast.js`) unless the row says
otherwise; an error toast stays until it is closed.

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Question | Answer (retry, accept, release, resume, approve, land again) | The answer buttons on its card in `#now`, primary first | Toast naming the question and the answer; the card leaves when the server clears it | Card rises into `#now` and its ring flares once when it lands | Buildkite block step, Devin plan approval |
| Question | Answer with a note | The note field beside the buttons; an answer that needs one refuses empty and says so | Hint under the field, then the toast | none | Buildkite block step inputs |
| Question | Walk a milestone | One row per milestone in the walk question: its progress and its own button, which opens that milestone's walkthrough | The step opens and takes focus | The step scrolls into view | GitHub "n of m files viewed" |
| Question | Close the mission | The close question's button goes to the second gate, which asks twice | Toast, and the gate says what closing did | none | GitHub merge button with its checks |
| Question | Nothing open | The rail's word reads `working` or `done` and `#now` is empty | n/a | n/a | Linear inbox zero |
| Mission | Pause, with a reason | Rail `pause`, then a note and `pause it`; Enter sends | Toast "mission paused"; the question "the mission is paused" lands in `#now` | none | Devin stop, GitHub Actions cancel |
| Mission | Resume | The paused question's `resume`, or the rail's | Toast | none | Buildkite unblock |
| Mission | Stop | Rail `stop this mission`, then `yes, stop it`; says what it stops and what it keeps | Toast; the page turns to the ended state | none | GitHub Actions cancel workflow |
| Mission | Live state | The status word at the top of the rail, linked to `#now` when something waits | The stream repaints; a dropped stream says so on the bar and falls back to polling | Arrivals rise 6px | GitHub Actions, Buildkite |
| Mission | Loading and failing to open | "opening the mission" until the first view; a mission that cannot open says why with the way back | n/a | none | GitHub, Linear |
| Milestone | Expand or fold | Its row in Plan, and its heading in Progress; finished milestones fold themselves | n/a | none | GitHub Actions job groups |
| Milestone | Release a hold | The hold's question in `#now`, with a note | Toast | as Question | Buildkite unblock |
| Milestone | Walk the walkthrough | The walkthrough under its step; answers save as they are given | "last saved" line under the frame | none | GitHub viewed checkbox |
| Milestone | Waive the walk | A note and `waive it` under the walkthrough | Toast | none | GitHub admin merge, with a reason |
| Task | Retry or accept a handed-back task | The question's buttons in `#now`, and the same row under the task in Plan | Toast | as Question | Buildkite retry, GitHub re-run |
| Task | Open its agent's session | `open the session` on a live task's row; `stop watching` closes it | The terminal mounts under the row | none | Buildkite live log, Devin shell |
| Task | See every attempt | The task's card in Progress, one line per attempt with its verdict linked to its findings | n/a | Lines rise as they land | GitHub Actions attempt selector |
| Task | See every automatic move | `show every move` under each milestone in Progress | n/a | none | Buildkite step log |
| Finding | Read why | The finding's head row opens its detail | n/a | none | GitHub review thread |
| Finding | Mark read, and undo it | `mark read` on the finding; the same button then says `mark unread` | Toast; the card dims | none | GitHub viewed checkbox, Linear mark read |
| Finding | Later (onto the checklist) | `later` on the finding | Toast; the card says "on the checklist" | none | Linear add to list |
| Finding | Mark a whole bucket read | `mark all N read` at the top of each bucket | One toast for the lot | none | GitHub mark all files viewed |
| Finding | Hide what is read | `hide read` over the buckets | The read ones leave the list | none | GitHub hide viewed files |
| Finding | Move and mark from the keyboard | Tab reaches each bucket once; `j` and `k` move between findings in page order, `x` marks the one in focus read | Focus ring on the card | Scrolls the card into view | GitHub `j`/`k`, Linear `x` |
| Finding | Jump from a chip | A verdict chip in Progress or a severity chip on a file row unfolds the finding and focuses it | Focus ring on the card | Scrolls into view | GitHub file tree counts |
| Finding | Group by severity, then area | Built: three buckets, fix first, an area heading inside each | n/a | n/a | Linear group by |
| Summary | Ask for the three things to read | `summarize` (`summarize again` once written) | Toast; the button says `summarizing...` until it lands | none | n/a |
| Chat | Write to the Strike Lead | The composer; Enter sends, Shift+Enter is a new line | The button says `sending`; an error stays under the box with the text kept | The entry rises into the thread | Devin chat |
| Chat | Answer a round of interview questions | The option buttons and an own-words field per question, then `send answers` | The round folds into "N questions asked" | none | Devin plan questions |
| Chat | Read the history | `the earlier conversation` unfolds it; a long message folds to its opening with `the whole message` | n/a | none | Linear comments |
| Chat | Open the Strike Lead's raw session | `open its session in a terminal` | The terminal mounts in place | none | Devin shell |
| Plan document | Read it | `read the plan document` opens the file | n/a | none | GitHub file view |
| Diff by file | See what merged | `the files, by task` unfolds the tree: per task, its files or their directories, lines changed | n/a | none | GitHub file tree |
| Report | Read it | `the report` unfolds it; `raw markdown` opens the file | A load error says so in place | none | Buildkite annotations |
| Worktrees | Take them back after the close | `take back the worktrees`, asking twice, and saying what git removed | The line under it | none | n/a |

### Floor rows left out, and why

- **Create, delete, reorder, drag**: every collection on this page is written by the mission (questions, tasks, findings, the ledger). Nothing here is made or ordered by hand.
- **Edit**: a finding, a task and a ledger line are records of what happened; the plan is edited by talking to the Strike Lead, which is the chat row.
- **Bulk select with checkboxes, Shift-click, `Cmd+A`**: the one bulk action worth doing on findings is "mark these read", and it is per bucket (`mark all N read`), which is the unit a reader decides on. Picking 17 of 68 findings by hand to mark read is not a task anyone has here.
- **Search and filter on text**: findings are grouped by severity and area, and `hide read` removes what is done; the browser's own find covers a word, because every finding's headline is on the page.
- **Undo for `later`**: it writes an item and a commit to the tracker. It is taken back on the board, where the item is, not by a toast here.
- **Undo for answers, pause, stop and close**: each is an outward effect (an agent sent out, a session stopped, work landed) and each that cannot be taken back asks twice instead (`feedback.md` section 1).
- **Diff views (split, whitespace, inline comments), plan history, report download**: the mission branch is a real git branch reviewed with the person's own tools; this page says what merged and where, not a second code review tool.

## The workspace inbox (`web/index.html?view=workspace`, `web/command.js`, `web/inbox.js`)

The page's question is the same one: what is waiting on me, across every session and mission in
the project. Four groups in a fixed order (Needs you, Working, Ready to review, Done), then the
brainstorms. A session or a mission is one strip in one group. What an action did is a toast
(`web/toast.js`); a standing condition stays on the bar.

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Mission | Answer its question where it sits | The answer buttons under the question in its strip, primary first, the same routes the mission page posts | Toast naming the mission and the answer; an error toast stays until closed | A strip new since the last paint rises in | Linear inbox, GitHub notifications |
| Mission | Answer with a note | The note field above the answers; an answer that needs one refuses empty and says so | Hint under the answers | none | Buildkite block step |
| Mission | Open it | `open` in its row, a click anywhere on the strip, or Enter on it | The mission page | none | Linear |
| Mission | Open where an answer acts | An answer with a place (walk, close, answer the interview) opens the mission page there | The mission page at that place | none | GitHub "review changes" |
| Mission | Start one | `open a mission` under the racks: a name, then the line, in two asks | The mission page, on its interview | none | Devin new session |
| Session | Open it | A click on its strip, or Enter: full screen in the rack, in place inside a formation | The conversation and composer | none | Warp, iTerm tabs |
| Session | Rename it | `rename`, in place; Enter or blur keeps it, Escape restores, empty hands back Claude Code's own title | The new name at once, and a toast | none | Linear inline edit |
| Session | Close, stop or remove it | `close` (asks first), `stop`, `remove`, each naming its object | Toast; the strip leaves on the next paint | none | GitHub Actions cancel |
| Session | Answer a permission prompt | The prompt's choices as buttons in its open pane, the terminal still under it | The pane clears the card | none | Claude Code |
| Session | Write to it | The composer in its open pane; Enter sends | Toast "sent"; an error toast names what failed | The turn lands in the conversation | Claude desktop |
| Session | Start one, or a shell | `New session` in the bar; the terminal icon beside the tabs | The new strip rises in | Rises in | Warp |
| Formation | Group sessions | Drag a strip onto a tab; every drag also has its right-click menu path | Toast naming where it went | none | Linear move to |
| Formation | Make, rename, disband, pop out | `+` beside the tabs; the tab's own right-click menu | Toast; disband asks first | none | Chrome tab groups |
| Brainstorm | Start one, open one | `brainstorm` on its heading; `open` in its row | The breakdown page | none | n/a |
| Usage | Read the limits, calibrate | The meter in the head opens its panel | The panel; calibrate saves in place | none | n/a |
| Page | Refresh, and see it loading or failing | The refresh icon; the page repaints every ten seconds and waits while a field on it is being typed in | "reading sessions…" while it loads; "sessions unavailable" with the reason when it cannot | none | n/a |

### Floor rows left out, and why

- **Delete as one step with undo**: closing a session ends a real process and removing a record discards it; each asks first instead (`feedback.md` section 1).
- **Bulk select**: sessions are acted on one at a time by design (each is its own process with its own state); nothing here is worth doing to twenty at once.
- **Search and filter**: one project at a time (system.md, "One project at a time"), grouped by what needs you; a rack longer than a screen is not the case this page is for.
- **Reorder by hand**: the racks sort by urgency; the only move is between groups and formations, which is the drag and its menu.
- **Keyboard walk (`j`/`k`)**: every strip is a stop on the Tab path and opens on Enter; the racks are short.

## The walkthrough (`web/walkthrough-template.html`, hosted by `web/walkthrough.js`)

The document a person walks at the end of each milestone. A session writes it from the template
for that milestone; the console hosts it under the milestone's step and saves its answers to the
mission. Its question: did this milestone do what it said, seen with your own eyes.

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Case | Give a verdict: pass, partial, fail, blocked, later | The five buttons under the case, one group; pressing the chosen one again clears it | The button reads chosen, the case's edge takes the verdict's colour, the counts move | The edge colour eases | TestRail, Linear |
| Case | Say what you saw | The note under the case | "kept" under the note, or that this browser will not keep it | none | TestRail result comment |
| Case | Run a command it needs (start the app, seed, clear, dry run) | `copy` beside the command | The button says "copied", or "select it" when the browser refuses | none | GitHub copy button |
| Case | Compare a dry run before and after | The two outputs side by side, one over the other on a phone | n/a | none | GitHub split diff |
| Walk | See how far it has got | The bar at the top: "N of M answered", the count per verdict, and each pillar's own count beside its heading | Updates as each verdict is given | none | TestRail run summary |
| Walk | See only what is left | `show only what is left` | Answered cases leave the list; the button reads pressed | none | GitHub hide viewed files |
| Walk | Pick it up elsewhere | Answers given in another tab of the document arrive here; the console saves them to the mission, and a browser without them is filled from the mission's copy | The counts match | none | n/a |
| Walk | Open it in its own tab | `open in its own tab` on the hosted panel | A new tab | none | n/a |

### Floor rows left out, and why

- **Create, edit, delete, reorder cases**: the cases are written by the session that built the document from the milestone's plan; the person walks them, and a case that is wrong is a note on it.
- **Bulk verdicts**: a walk is a person checking each case with their own eyes; marking ten at once is the thing it exists to prevent.
- **Undo**: pressing the chosen verdict again clears it, and any verdict can be changed until the milestone is closed.
- **Search and filter on text**: a walk is a dozen cases at most; `show only what is left` is the one filter it needs.

## The board (`web/index.html?view=board`, `web/app.js`)

The project's checklist as four lanes: backlog, roadmap, in progress, done and awaiting deploy.
Its question: what is next, in what order, and what is it waiting on. Every write is one commit
to the tracker file, the same write whichever control made it.

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Item | Add | The field at the top of each lane (not Done), Enter or `add` | Toast "Added ..."; the field keeps the focus for the next one; a refusal keeps the words | The new card settles in | Linear quick add, Trello add a card |
| Item | Open | Its title (a button), Enter or a click anywhere on the card | The drawer opens with its heading focused; Escape or the close icon gives focus back | The drawer slides in | Linear issue peek |
| Item | Move to another lane or group | Drag the card; or the drawer's `lane` select and `move` | Toast with `undo`; the board repaints from the file | The list it landed in flares | Trello, Linear |
| Item | Reorder in its group (the runway) | Drag; or the drawer's `move up` and `move down` | Toast with `undo` | as above | Trello, Jira rank |
| Item | Plan for a release | Drag onto a release card; or the drawer's `release` select | Toast with `undo` | The card flares | Linear cycles |
| Item | Set or clear a deadline | The drawer's date and `set` or `clear`; or drag onto a calendar day | Toast with `undo` | none | Linear due date |
| Item | Mark done, reopen | The drawer's `mark done` or `reopen` | Toast with `undo` | none | Linear status |
| Item | Edit its markdown | `edit markdown`, then `save` or `cancel` | Toast with `undo` | none | GitHub edit file |
| Item | Remove | `remove`, with the reason asked for | Toast; it moves to the tracker's Removed section with the date and reason | none | Linear archive with reason |
| Item | Plan it, spawn on it | `plan it` (the primary on an unplanned item), `spawn` (the primary on a planned one, or on the card) | The session opens in the workspace | none | Linear "start working" |
| Lane | Fold or unfold | The chevron beside its name; remembered | The chevron turns | The chevron turns | GitHub projects |
| Group | Delete when empty | The close icon beside an empty group's name, then confirm | Toast | none | Trello archive list |
| Board | Loading, failing, empty | A lane with nothing in it says what goes there; a board that cannot be read says why in the bar | n/a | none | Linear empty states |

### Floor rows left out, and why

- **Bulk select and act**: the board is a runway of a few dozen items moved one at a time; the tracker file is where bulk edits are made.
- **Search and filter**: the lanes are the filter, and the tracker is a file the person's editor already searches.
- **Undo for remove**: remove asks for a reason first and keeps the item in the Removed section, where it can be moved back.

## The calendar (`web/index.html?view=calendar`, `web/app.js`)

The same items by deadline, with the ship days and the releases. Its question: what is due when, and when do we ship.

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Month | Go to another, or today | The chevrons either side of the month, `today` | The grid redraws | none | Google Calendar |
| Item | Open | Its event on the day (a button) | The item drawer | The drawer slides in | Google Calendar |
| Item | Set or clear a deadline | Drag onto a day, or onto "without a deadline"; or the drawer | Toast with `undo` | The day flares | Linear due date |
| Ship day | Open, move, mark shipped, undo, cancel | Its event opens its drawer: `mark shipped`, a date and `move`, `put it back`, `cancel this ship day` (confirmed) | Toast naming the day; the drawer closes only when the write went through | none | Google Calendar event |
| Ship days | Set the cadence, add a one-off | The cadence select and its first day; the one-off date and `add a one-off` | Toast | none | Google Calendar repeat |
| Release | Open its slot | Its deploy event | The release drawer | The drawer slides in | Linear cycle |
| Calendar | On a phone | The days that hold something, as a list, today always among them | n/a | none | Google Calendar schedule view |

### Floor rows left out, and why

- **Create an item here**: items are added on the board, in the lane they belong to; the calendar dates them.
- **Bulk, search, filter**: a month holds a handful of dated items.

## The project picker (`web/index.html?pick=1`)

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Project | Open | Its name | The board or workspace | none | VS Code recent folders |
| Project | Add | `Import a directory from Finder`, or a pasted path and `Add` | Opens it; a refusal is a toast naming the path | none | VS Code open folder |
| Project | Forget | `forget`, confirmed; the directory is untouched | Toast | none | VS Code remove from recent |
| Picker | Failing, empty | A list that cannot be read says why with `try again`; an empty one says how to add | n/a | none | n/a |

### Floor rows left out, and why

- **Rename, reorder, undo forget**: a project's name is its folder's, and forgetting one only drops it from this list; adding it back is one paste.

## The ship page (`web/ship.html`)

One shipment of one version, step by step. Its question: where is this release, and what is waiting on me.

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Step | Choose | Its row in the steps list | The step's detail; on a phone the detail comes first | none | GitHub Actions jobs |
| Step | Run, run it again | `run` on a pending step, `run it again` on a failed one | The button holds while it starts; toast | The runway's jet taxis to the new share | GitHub re-run |
| Step | Mark done, skip, reopen | The step's verbs | Toast; a refusal names the step | as above | Buildkite unblock |
| Step | Watch it run | The live panel, `open in dock` | The session's screen | none | Buildkite live log |
| Step | Check off your items | The checkboxes in its report | Toast | none | GitHub task list |
| Step | Take notes | The notes field, saved on leaving it | Toast | none | n/a |
| Step | Walk the walkthrough | The hosted walkthrough, when the step has one | As the walkthrough | none | n/a |
| Ship | See where it stands | The runway and "N of M steps"; a failed step turns the runway red and names itself | n/a | none | GitHub Actions summary |
| Reviews | Audit, accept, reject | The verbs on each session in Reviews | Toast | none | GitHub review |
| Ship | Cannot open | Says why, with the way back to the board | n/a | none | n/a |

### Floor rows left out, and why

- **Create, delete, reorder steps**: the steps are the ship process's own; a step that does not apply is skipped.
- **Undo**: every step can be reopened, and a run is a session with its own record.
- **Bulk, search**: eleven steps.

## The breakdowns (`web/breakdown.html`)

Every brainstorm and where it stands, and the one approval that writes a proposal to the board.

| Object | Action | Trigger | Feedback | Motion | Seen in |
|---|---|---|---|---|---|
| Brainstorm | Choose | Its row; the one whose proposal waits on you wears the need | Its gate | none | n/a |
| Brainstorm | Propose items | `propose items`, or `propose again` | The button holds; toast; the page shows "proposing" until the CAG writes | none | n/a |
| Proposal | Approve and write the board | `approve and write the board` (the needs-you primary) | Toast naming what it wrote and any interviews opened | none | GitHub merge |
| Proposal | Read it, or the brainstorm | The links under the gate (new tab) | n/a | none | GitHub view file |
| Breakdowns | Empty, cannot open | Says what a brainstorm is and links to the workspace to start one | n/a | none | n/a |

### Floor rows left out, and why

- **Edit a proposal here**: the proposal is the CAG's document; `propose again` or editing the file is how it changes.
- **Undo an approval**: it is one commit to the tracker, reverted there; the items it wrote are ordinary items on the board.
- **Bulk, search**: a project has a handful of brainstorms.
