# Mission protocol v3: a milestone is a foundation, and it is walked before anything builds on it

Written 2026-10-29 from a review of five missions (51 tasks) and Cory's calls in the same
session. Every decision below is his; nothing here is a recommendation still waiting on him.

## The finding in one line

Missions came to Cory slice by slice and ran about one session at a time, because nothing told
the Strike Lead what a milestone is: it cut work by layer (contract, backend, frontend, then a
milestone that was only the walkthrough) and chained the tasks inside each.

## The evidence

| Mission | Tasks | Wall clock | Agent build | RIO review | Avg running | Peak | Retried |
|---|---|---|---|---|---|---|---|
| Mission page and inbox | 12 | 760 m | 58 m | 57 m | 0.2 | 3 | 7 |
| The result reads itself | 8 | 68 m | 39 m | 32 m | 1.0 | 2 | 2 |
| Progress reads itself | 8 | 61 m | 48 m | 38 m | 1.4 | 3 | 2 |
| Concept Build | 9 | 385 m | 57 m | 26 m | 0.2 | 2 | 4 |
| A files redesign | 14 | 145 m | 125 m | 54 m | 1.2 | 2 | 4 |

Wall clock is approval to last review. Build and review count the final attempt only.

- The only milestone guidance the Strike Lead gets is "keep milestones small enough that a
  failure costs one milestone" (`src/missions.ts`, the plan rules near line 798).
- Concept Build was four milestones (the contract, the backend, the frontend, the walkthrough);
  none was a foundation the others had to wait for. Its backend walkthrough was waived as "no
  user-facing screen", and the files redesign's backend walkthrough asked Cory to run `vitest`.
- The files redesign's backend was a chain of four tasks and its frontend a chain of five, so
  no more than two sessions could ever run at once.
- 19 of 51 tasks needed a second full build and review.
- Where a mission waited on a person, the wait was most of its life (Concept Build: 385 minutes
  for about 83 of agent work).

## Decided (Cory, 2026-10-29)

1. **A milestone is a foundation**: work that what comes after it builds on. Everything that can
   be built at the same time is one milestone: the contract first, then backend and frontend in
   parallel against it. Never cut by layer or by repo; the walkthrough is never a milestone. Most
   missions are one milestone. Concept Build should have been one.
2. **A milestone is not a feature.** Features are the cases its walkthrough tests.
3. **One walkthrough per milestone stays (M12 holds), and it now blocks the next milestone.**
   This amends M12, which let the next milestone fly before the walk.
4. **Every walkthrough is something Cory can see.** Work with no screen (a migration, a
   backfill) shows its dry run on the preview, before and after, as part of building it.
5. **The plan is briefed before it is fired**: per milestone, what it builds, the cases Cory
   will walk at its end, what it builds on, a rough time, and when he is needed; then the
   totals (milestones, time end to end, times he is needed). **Maverick computes the times**
   from the plan's shape and measured history, not the Strike Lead's guess.
6. **The gate refuses** a milestone that is one layer or repo only, or a walkthrough only, and
   **warns** on a plan that is mostly one chain.
7. **Pace**: plan wide (the gate above), the Wingman runs its task's proof before it stops, and
   the sweep runs when a session ends, not only on the 60 s tick.

## The work, one concern per PR

### PR 1: the milestone protocol (decisions 1 to 6)

- **Strike Lead wording.** Replace the milestone sentence in the plan rules (`src/missions.ts`,
  near line 798) with:
  > A milestone is a foundation: work that what comes after it builds on, so it is finished and
  > walked before the next one starts. Everything that can be built at the same time belongs in
  > one milestone: the contract first, then the backend and the frontend in parallel against it.
  > Never cut milestones by layer or by repo, and never make the walkthrough a milestone. Most
  > missions are one milestone; add another only when its work cannot begin until the first is
  > built and confirmed. Every milestone ends in a walkthrough Cory can see, and work with no
  > screen (a migration, a backfill) shows its dry run on the preview, before and after. Before
  > the plan is fired, brief Cory on every milestone: what it builds, what he will walk through
  > at its end (the cases), what it builds on, a rough time to build, and when he will be needed.
  > Then give the total: how many milestones, the time end to end, and how many times he is
  > needed.
  Update `flightRules` in `src/strike-lead.ts` ("the next milestone starts only when the one
  before it has merged") to say merged and walked.
- **Plan format.** Each milestone carries a `_walk: <case>; <case>; ..._` line beside its
  `_done when_`: the cases Cory will walk, in words a person reads. `parsePlan` makes it a
  problem when it is missing. This is what makes "a milestone Cory can see" checkable, and it
  feeds the briefing.
- **Plan check** (`parsePlan`, `src/missions.ts`):
  - problem: a milestone whose tasks all touch one repo, in a plan where another milestone's
    tasks touch a different one (cut by repo or layer);
  - problem: a milestone that is only a walkthrough (no task that changes product code; judge
    from `touches`, not from the title);
  - warning: inside a milestone of four or more tasks, the longest `needs` chain is more than
    half of them. Say the chain by task id.
  Keep the existing rule that a `needs` may not point at a later milestone.
- **Walkthrough blocks the next milestone.** `done` (near line 1376) and `isBase` must also
  require the milestone walked or waived (`walkthroughState`), so `undoneBefore`, `gates`,
  `startable`, `mergeable` and `waitingOn` follow without a second rule. `waitingOn` says
  "sent once milestone n is walked" when that is the holdback. A waiver still counts, with its
  reason, as today.
- **The walk is a question.** While a merged milestone waits on its walk, the mission asks it
  (`src/questions.ts`): which milestone, how far through, answers that open the walkthrough. The
  UI session's branch `feat/review-asks` is adding a question for a mission in review; read it
  first and share the shape rather than adding a second one.
- **The briefing**, at the gate above Fire mission (`web/mission/lead.js`, `web/mission.js`
  gate): per milestone its title, the `_walk_` cases, what it builds on, the estimate, and "you
  walk it at the end"; then the totals. The estimate is computed server-side in `previewPlan`:
  for each milestone, the longest `needs` chain times the measured mean per task (build plus
  review), plus the measured retry rate times that mean, read from past mission records under
  `config.sessionsDir/missions/`. With no history, fall back to a fixed 15 minutes per chain link
  and say it is a default. Show minutes rounded to the nearest 5, never false precision.
- **Decision record.** Add M28 to `docs/03-decisions.md` (decisions 1 to 6, the evidence table,
  and that it amends M12's "does not block the next milestone"), and update **Milestone** in
  `docs/07-glossary.md`.
- **Tests** for each `parsePlan` rule, for `gates` holding a task behind an unwalked milestone
  and releasing it on walk and on waive, and for the estimate with and without history.

### PR 2: the Wingman proves before it stops

In the Wingman brief (`src/briefs.ts`, the first-attempt path, next to the `diff --name-only`
check): before stopping, run the task's own proof (the commands its intent names) and the
project's `missions.proof` from `maverick.json` when there is one, and put each command with its
result in the final message. It reports; it does not grade. The RIO still judges. Test the brief
text the way the existing brief tests do.

### PR 3: the sweep runs when a session ends

Find where Maverick observes a Wingman or RIO ending (the sweep reads it today on its 60 s
tick), and run that project's mission sweep then, debounced so a burst of endings is one pass.
The 60 s tick stays as the backstop. `sweepMissions` already refuses a second concurrent pass
per project. Prove it with a test or a measured before and after of the gap between a task
passing and its dependant starting (median today: about 5 minutes on a chain, of which up to
60 s is the tick).

## Not in this plan

- Whether a mission can create a new repo (open question to Cory).
- Projects' own rules (bless, landing mode): those change in their own repos.
- The UI rework and the review-question surface beyond what PR 1 needs: the UI session owns
  those.
- Starting a dependant before its predecessor's RIO passes: considered and set aside.
