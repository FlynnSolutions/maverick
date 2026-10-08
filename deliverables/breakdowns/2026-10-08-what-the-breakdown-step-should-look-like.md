# Breakdown: what the breakdown step should look like

The brainstorm asked how one brainstorm document becomes items on the board: how the proposal
reaches the gate, what *plan now* means when no plan file exists, where items land, what the gate
allows, how a mission-sized idea is handed off, and how anyone knows a brainstorm was broken down.
Between that conversation and this breakdown the step itself was built (decisions M15, on
`feat/breakdown`): a CAG in a terminal writes a proposal file, `parseBreakdown` turns it into
items plus problems, the breakdown page is the gate, one approve writes both lanes under a
`Brainstorm:` group and opens a Strike Lead per mission-sized item, and the stamp on the proposal
is the record. So most of the brainstorm's ideas are either decided or already covered by the
checklist item that named the three phases, and this breakdown takes only the edges that are
still open: one thing the writer gets wrong today, three bricks M15 deferred on purpose, and one
seam the handoff leaves.

## Items

- [ ] **The breakdown writes items in the tracker's own tags and sizes**
  - kind: chore
  - size: S
  - call: now
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

- [ ] **Per-item edits at the breakdown gate**
  - kind: feature
  - size: M
  - call: backlog
  Keep, drop, resize, re-kind, or move an item between now, backlog and mission on the breakdown
  page before the one approve writes what is left. M15 rejected this for the first cut: the gate
  is whole-document, as a mission's is, and the fix for a wrong proposal is *propose again*.
  Proposed items are independent of each other, unlike milestones, so edits are sound here in a
  way they are not on a mission plan. The design constraint a plan session has to hold: the
  frozen artifact must be the *approved* list, so approve writes the edited proposal document
  back before it stamps, or the page and the file disagree, which is the exact reason M15 said
  no. Pull this up when dropping two bullets has turned into a conversation with the CAG too
  often; until then the whole-document gate stands.

- [ ] **The board tells a release group from a Mission or Brainstorm group**
  - kind: feature
  - size: M
  - call: backlog
  Every `###` group under Priority is treated as a release: ordering, the deploy-date drawer,
  the release verbs. A `Mission:` group already bent that, and a `Brainstorm:` group now bends
  it the same way. M15 recorded the consequence and Cory's call to live with it. The brick, when
  it is picked up: read a Priority group's kind from its prefix (a release, a `Mission:`, a
  `Brainstorm:`), withhold the release verbs and the deploy-date drawer from the named kinds, and
  give a `Brainstorm:` group its own verbs (open the breakdown gate, read the brainstorm). The
  prefix is the only signal the markdown carries, which is the point: no new field, no store.

- [ ] **The gate hands a now item straight to its plan session**
  - kind: feature
  - size: S
  - call: backlog
  A *now* item arrives unplanned on purpose, and the gate says *plan it* is its next verb, but
  that verb lives in the board drawer, so the path from the gate to the first plan session is a
  tab switch and a search. The brainstorm's stronger version, approve opens a plan interview per
  item, was turned down because six items would mean six sittings. The honest middle: after
  approve, the breakdown page lists the roadmap items it just wrote, each with a *plan it* that
  opens the same CAG plan session the drawer opens, one terminal at a time, nothing automatic.
  The gate already knows the titles and the tracker; it is one list and one existing route.

- [ ] **A Strike Lead opened from a breakdown reads the brainstorm too**
  - kind: chore
  - size: S
  - call: backlog
  `approveBreakdown` opens the mission with the proposal as its `from` document, and the
  interview prompt says to read that document first because it holds the reasoning. It holds the
  item's body; the reasoning is in the brainstorm one folder over, which the prompt never names.
  Name both: the proposal for the item and its call, the brainstorm for the conversation that
  produced it. One line in `interviewPrompt`, or `from` becomes the brainstorm and the proposal
  is named beside it.

## Already on the board

- The breakdown itself: a proposal file Maverick parses, one gate, approve writes both lanes under a group named after the brainstorm, the stamp as the record, roadmap items unplanned on purpose: Brainstorm, breakdown, plan: the phases before an item reaches the board
- A brainstorms list in the console showing each one's state, where the *break it down* verb lives: Brainstorm, breakdown, plan: the phases before an item reaches the board
- The CAG's boundary as its tool list, and no CAG reaching the console API: CAG, Strike Lead, Wingman: three levels of agent per project
- A mission-sized idea handed to a Strike Lead interview rather than planned twice: The Strike Lead: grow the audit from a validator into an orchestrator
- An agent whose only tools are the console API, filling forms rather than writing files: The manager agent
