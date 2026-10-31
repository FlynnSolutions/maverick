# Prompt: a mission must build what the mockups showed (component inventory + visual gate)

Paste everything below the line into a fresh session in `~/Projects/maverick`. It touches Maverick
and the flynn-kit `variants` / `ui-audit` skills; say which repo each change lands in.

---

## What went wrong (2026-10-29/30, Realtime mission `item-files-redesign`)

Cory approved mockups for the item-files redesign (`~/Projects/Realtime/deliverables/design/item-files/`,
`index.html` cells 1-58, `round2.html` 59-79, picks in `rounds.md`). They were drawn in a fresh
stylesheet (`files.css`): a compact file row (type icon, `Sep 22 · Alex · 310 KB`, inline eye /
download / ⋯), a Files page with a toolbar (Search, Folder, Upload), folders as chevron rows in the
same list. He loved them.

The mission flew 15 tasks, every RIO passed them, the walkthrough pre-screen passed 22/22, and the
result looks nothing like the mockups. Each file is still the old `AttachmentCard` (a big paperclip
card, `PDF FILE - <date>`), with the new ⋮ menu dangling under it, no toolbar, inconsistent rows.
Cory: "you shouldn't give me those mock-ups that are showing new components and then have the old
components replace them."

Causes, in order:
1. **The mockups were not drawn with the app's components and did not say so.** Cory approved a look
   that did not exist in the codebase, and nothing told him which parts were new.
2. **The Strike Lead interview never asked the component question.** No probe makes it ask, for an
   element in a mockup that resembles an existing component, whether to reuse, restyle or replace it.
3. **The plan said "reuse app components as they are" while citing cells drawn with components
   that do not exist.** The builders followed the concrete instruction. (That line came from a
   standing rule written after the *opposite* failure on 2026-10-02: hand-built one-off controls
   that matched a mockup and nothing else in the app. Both failures have the same root: the
   reuse-or-new decision was never made explicitly.)
4. **No gate looks at the screen.** RIOs, the probe and the pre-screen checked behaviour only. Nothing
   put a built screen beside its cell.

## What Cory decided the fix is

The reuse-or-new decision is made **in the mockup and interview phase, per component, by Cory, and
shown in the mockups**, then carried through the plan and checked at review.

For every element a mockup draws, name the existing component it resembles (or "none"), and Cory
picks one of three:
- **Reuse as is.** The mockup is drawn *with that component* (its real look), so what he approves
  is what ships.
- **Restyle the shared component.** The new look replaces the old one app-wide. The mockup also shows
  one or two other screens where it changes, so the blast radius is approved, not discovered.
- **New component.** A new one is built for this feature; the old one stays elsewhere, and the plan
  names the difference as deliberate.

## Changes to make

1. **`variants` skill (flynn-kit, `plugins/flynn-core/skills/variants/`).** A round whose cells draw
   product UI starts with a component inventory: every element, the existing component it resembles
   (grep the project), and which of the three options each cell assumes. A cell that draws a new or
   restyled component labels it in the cell. The closing rules list the inventory decisions with
   Cory's picks as evidence, like any other rule. Where a cell assumes "reuse as is", draw it with the
   real component's look (screenshot or faithful copy of its styles), never a fresh approximation.
2. **Strike Lead interview (`src/missions.ts`, `INTERVIEW_PROBES` and `interviewPrompt`).** When the
   mission has mockups or touches a UI, the Lead reads them and asks the inventory question for every
   element the rounds did not already settle, in the same three options, citing cells. It may not
   write "reuse existing components" as a blanket instruction.
3. **Plan format (`PLAN_FORMAT`, `parsePlan` in `src/plans.ts` or wherever it lives).** A
   `## Components` section beside `## Contracts`: `- **<component>** (owner: <task>): reuse | restyle |
   new; cells <n, n>; <one line>`. A UI task names the components it builds or changes. `parsePlan`
   reports a problem when a task cites mockup cells and the plan has no `## Components` entry covering
   them, so the gate refuses it.
4. **Visual gate.** A task that touches a screen is not done until its Wingman commits screenshots of
   the built screen beside the cited cells (desktop and mobile), and its done-when says so. Add to
   `RIO_CHECKLIST` (`src/briefs.ts`): "For a task that cites mockup cells, open its screenshots and
   the cells; any element that differs from its `## Components` decision is a BLOCKER." The RIO
   runs the `ui-audit` skill on those screens, and its verdict is part of the review.
5. **Walkthrough.** A UI milestone's round gets one "Looks like cell N" card per screen, with the cell
   embedded beside the link, so the look is checked in the round and not at the end.
6. **`ui-audit` skill.** Gains a "matches the brief" check that takes the approved cells as input and
   names each element that does not match.

## Done when

- `npm test` and `npm run lint` pass in Maverick, with tests for: the interview prompt containing the
  inventory probe; `parsePlan` refusing a cited-cells task with no `## Components` entry; the RIO
  checklist line; the Components section parsing.
- The two skill changes are in flynn-kit with their own commits.
- A dry run: re-run the Strike Lead's interview prompt (read-only) against the item-files design folder
  and show the inventory questions it would now ask (it should raise the file row vs `AttachmentCard`,
  the Files page toolbar, folder rows, the version badge and the file panel).

Not in scope: fixing the item-files UI itself (that is happening in the Realtime session), and any
change to how missions land or deploy.
