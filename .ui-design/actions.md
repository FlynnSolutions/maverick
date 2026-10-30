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
