# What the breakdown step should look like (2026-10-08)

A brainstorm with the CAG. Many ideas, no structure. This document belongs to this one
conversation. Nothing here is on the board; turning it into items is the breakdown itself, which
this document is about, and which does not exist yet.

## What the repo already says

Before any idea, what is already decided or built, because the breakdown has to fit it.

- **The three phases** are named in the checklist item *Brainstorm, breakdown, plan* (created
  2026-10-06) and in the header of `src/plans.ts`: brainstorm (one conversation, one dated
  document), breakdown (that document proposed as items), plan (one document per item about to
  be worked). The brainstorm and the plan are built. The breakdown is the gap.
- **The rule at the door (M13, decided by Cory 2026-10-06):** *planned* is a `plan:` field that
  resolves to a real file. Not a status word. The board badges a Priority or In Progress item
  without one as *unplanned* and nothing is spawned on it.
- **The gate shape that exists:** a mission is an interview in a terminal, a document written in
  a fixed shape, `parsePlan` turning it into structure plus a list of problems, a gate panel on
  the mission page showing the parsed plan, its cost and the problems, and one approve that
  writes the tracker in one commit (`writePlanToTracker`, through `addGroup` and `addItem`). The
  approved document is frozen as the artifact of the gate and never read back as state (M7).
- **The CAG's boundary** is its tool list: `Read,Write,Edit,Grep,Glob`, writing only under
  `deliverables/` and in the tracker. No shell, no subagents, no network. The brainstorm prompt
  tells it not to touch the tracker and that turning a brainstorm into items is a step Cory
  approves in Maverick.
- **Fields the tracker carries:** `created`, `source`, `due`, `release`, `size`, `kind`,
  `status`, `owner`, `plan`, `pr`, `links`, `blocked-by`, `mission`, `milestone`, `repo`.
  `source` is free text, so an item can already say which brainstorm it came from.
- **Groups under Priority are releases.** A mission already bends this by writing a
  `### Mission: <name>` group under Priority.
- **Brainstorm documents are not listed anywhere in the UI today.** The *brainstorm* button in
  the command view opens the terminal; nothing shows the documents under
  `deliverables/brainstorms/` afterwards.
- **A mission starts from one line.** `mission.brief` is what Cory typed; the Strike Lead
  interviews from there. Nothing today pre-loads an interview with a document.

## Cory's ideas, in his words (2026-10-08)

- The breakdown reads **one brainstorm document** and proposes items, each with a **title**, a
  **kind**, a **size**, and a call of **plan-now or backlog**.
- It is **approved once in Maverick, like a mission plan**, then written with the
  **insert-into-group path**.
- **Planned items carry a plan field and land in Priority**; the rest land in **Backlog under a
  group named after the brainstorm**.
- A **mission-sized feature goes to a Strike Lead interview** instead.
- Open: does the breakdown run as **the CAG writing a proposal file that Maverick parses**, or as
  **a form the CAG fills through the console**?

## The CAG's angles

Offered, not argued for. Each one is a direction the conversation could take.

### On how the proposal gets from the CAG to the gate

- **A proposal file Maverick parses.** This is the mission's shape exactly: the CAG writes
  `deliverables/breakdowns/<date>-<topic>.md` in a fixed format, the server parses it into
  items plus problems, the gate shows both, approve writes the tracker. Every piece of that
  pipeline exists for missions and would be a second caller of it. The document is also the
  frozen artifact of the gate for free, the way `deliverables/missions/<id>.md` is.
- **A form the CAG fills through the console.** This collides with the CAG's boundary. The CAG
  has no network and no shell, so it cannot call `/api/*`. For it to fill a form, either it gets
  a tool that reaches the console (which widens the one level whose boundary is fully enforced)
  or "fills a form" means it writes a file the console reads, which is the first option by
  another name. If the form is the thing wanted, the honest version is: the CAG writes the
  proposal file, and the *gate* is the form, with each proposed item editable before approve.
- **The proposal is a section of the brainstorm document itself.** No second file. The CAG
  appends `## Proposed items` in the fixed shape and the server parses that section. One fewer
  path, one fewer folder, and the brainstorm shows what came out of it. Against: the brainstorm
  prompt says the document is the conversation's, and a later session editing it is the drift
  M13 rejected a rolling IDEAS.md for.
- **No CAG session at all.** The breakdown is a background agent (`claude --bg`, same as a
  Wingman) with the CAG's tool list, reading the document and writing the proposal. The
  brainstorm was the conversation; this is a read. Cheaper than a terminal, and it can be fired
  from the gate panel itself with a *propose items* button. Against: a breakdown that misreads
  the brainstorm has no one to ask, so the gate carries more of the load.
- **The breakdown is the tail of the brainstorm.** When the conversation winds down, the CAG
  asks "shall I propose items?" and writes the proposal before it stops. One session, no
  re-reading. Against: the brainstorm prompt says do not converge early, and a CAG that knows it
  ends in a proposal will start shaping ideas into items from the first question.

### On what *plan now* does

The sketch says planned items carry a plan field and land in Priority. The rule says planned
means the field resolves to a real file. At breakdown time there is no file. So the field alone
is a claim, and the item would wear the *unplanned* badge the moment it landed. Readings:

- **Priority, unplanned, on purpose.** *Plan now* means "this is roadmap work"; the item lands
  in Priority with no `plan:` field, wears the badge, and the gate's confirmation says "N items
  will arrive on the roadmap unplanned; plan them next." The badge and *plan it* verb already
  exist and already do the nagging. The breakdown sorts; it does not plan.
- **Approve also opens the plan sessions.** After the tracker write, Maverick queues a CAG plan
  session per *plan now* item, one terminal at a time since each is an interview. The item is
  planned by the time Cory gets to it. Against: approving a breakdown of six items would open
  six interviews; that is a lot of sitting down.
- **Small items are planned inside the breakdown.** An S-sized item's plan is a paragraph; the
  breakdown writes `deliverables/plans/<slug>.md` for it in the same pass and the field
  resolves. M and L go to a plan interview. Against: a plan written without the interview skips
  the probes `INTERVIEW_PROBES` exist for, and the plan prompt itself says do not present a
  plan until he has answered.
- **The field points at a plan that does not exist yet, and the badge says so.** Honest in a
  different way: `plan: plans/<slug>.md` is written, the file is not, and the drawer shows
  "plan named, not written". Against: this is the status-word failure in a new coat, since the
  path is now a promise instead of a fact.

### On where items land

- **Which Priority group.** Groups under Priority are releases. Options: a `### From brainstorm:
  <topic>` group (the mission's bend, again); the next planned release slot, which
  `src/releases.ts` already knows; or ungrouped at the top of Priority. A release is a real
  commitment and a brainstorm is not, so landing straight in a release slot may be the wrong
  default.
- **A Backlog group named after the brainstorm** spends a theme group on provenance. Backlog
  groups in this repo's own checklist are themes, and the parser reads them in any lane. Over a
  year, Backlog would be groups named for dates and topics. Alternatives: `source: brainstorm
  <file>, <date>` on each item and no group; or the CAG proposes a theme group per item and the
  brainstorm name stays in `source`. Against the alternatives: a group named for the brainstorm
  is the only way to see the breakdown as one thing on the board the day after.
- **`created` and `source` on every item.** The mission writer sets `created: today` and
  `source: Strike Lead interview, <date>`. The breakdown should set `source:` to the brainstorm
  file so the item points back at the reasoning, which is the thing a later session will want.

### On the gate

- **Per-item edits before approve.** A mission plan is approved whole because milestones
  depend on each other. Proposed items are independent. The gate could let each item be kept,
  dropped, resized, re-kinded, and moved between *plan now* and *backlog* before one approve
  writes what is left. The frozen artifact is then the *approved* list, not the proposed one.
- **The mission's answer instead: edit the document.** Keep the gate read-only and all-or-
  nothing, exactly as missions have it, and fix the proposal by telling the CAG. Simpler to
  build, and one less place where the page and the file can disagree. Against: it makes a
  conversation out of dropping two bullets.
- **Problems the parser can catch.** The mission parser refuses a task with only a title. The
  breakdown parser can refuse an item with no kind, a size not in the tracker's own vocabulary,
  a title that already exists on the board, or a *plan now* item whose body is one line.
- **Cost on the gate.** A mission gate shows sessions it will spawn. A breakdown spawns nothing
  on approve (unless *plan now* opens interviews), so the honest cost line is "N items onto the
  roadmap, M into Backlog, K handed to a Strike Lead."

### On duplicates and the board that already exists

- **The breakdown reads the tracker too.** An idea already on the board is not a new item; the
  proposal should say "already there: <title>" and offer nothing, or offer an edit to the
  existing item's body. The workspace note on the checklist already says items get pulled up,
  never duplicated.
- **Learn the tracker's own tags.** Maverick's checklist uses `[ENG]` `[DEBT]` `[OSS]` `[DOC]`
  and `[S]` `[M]` `[L]`; another project's tracker may not. The breakdown should read the
  vocabulary from the file it is writing into rather than carry Maverick's.

### On mission-sized features

- **Handing off without planning twice.** The Strike Lead interviews from a one-line brief
  today. The breakdown could open a mission whose brief is the proposed item's title and body,
  and whose interview prompt names the brainstorm document to read first. The item is not
  written to the tracker by the breakdown; the mission's approve writes it, as a `Mission:`
  group, the way it already does.
- **Or write it as an item with `kind: mission` and no plan,** and let *plan it* on that item
  route to a mission instead of a CAG plan session. One fewer branch in the breakdown; one more
  in the drawer.

### On knowing a brainstorm was broken down

- **Derive it, store nothing.** A brainstorm is broken down if any item's `source:` names its
  file. Consistent with M1; no new record. Weak if the breakdown produced zero items.
- **The proposal file is the record.** If `deliverables/breakdowns/<date>-<topic>.md` exists
  and carries `approved: <date>` in its front matter, the brainstorm was broken down. Also no
  store; the artifact of the gate doubles as the flag.
- **A brainstorms list in the console.** The command view would list the documents under
  `deliverables/brainstorms/` with their state: not broken down, proposal waiting at the gate,
  broken down on a date. This is where the *break it down* verb would live. It is also the first
  place brainstorms become visible at all.

## Rejected, and why

Nothing firmly rejected yet; the conversation has not converged. Candidates leaning that way:

- **The CAG calling the console API to fill a form.** Breaks the one tool boundary that is
  fully enforced (M5, M13). Noted above; the proposal file does the same job inside the
  boundary.
- **Writing a `plan:` field for a file that does not exist.** It reintroduces the claim M13
  removed. Noted above; left here so the reasoning is not lost if the sketch's wording gets
  read literally later.

## Open questions

- **Cory's:** proposal file parsed by Maverick, or a form filled through the console?
- What *plan now* does, given that no plan file exists at breakdown time.
- Whether the breakdown is a conversation, a background read, or the tail of the brainstorm.
- Which Priority group a *plan now* item lands in: a brainstorm-named group, a release slot, or
  none.
- Whether the Backlog group is named for the brainstorm or the brainstorm lives in `source:`.
- Whether the gate allows per-item edits or stays whole-document like the mission's.
- How a mission-sized item is handed to the Strike Lead: a mission opened from the gate, or an
  item with `kind: mission` routed later.
- Where in the UI the gate and the list of brainstorms live.
- Whether the brainstorm document may be edited after its conversation (to record what came out
  of it), or whether the breakdown artifact carries that.
