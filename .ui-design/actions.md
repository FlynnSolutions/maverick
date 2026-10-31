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
