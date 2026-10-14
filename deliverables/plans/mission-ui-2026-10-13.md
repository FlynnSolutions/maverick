# The mission page and the inbox

_2026-10-13. Cory's call, after four options drawn from the products that already ship an agent session UI. This is the design record; the build is the mission `deliverables/missions/mission-page-and-inbox.md`._

## What was wrong

Flying the first fixture mission, Cory could not tell what a milestone was, what a task was for, what was running, or where a question from an agent was waiting. The mission page was a separate page that polled every eight seconds and rebuilt itself, every question to him was a browser `window.prompt`, and the workspace knew nothing about missions beyond a row. Nothing carried through from the plan he approved to the flight to the debrief.

## What was looked at

Every shipping agent product has converged on the same page. The evidence, read on 2026-10-13:

- Devin anchors a session on Task, Plan, PR and Summary, groups actions under the plan step they serve, waits 30 s for approval unless told to wait for it ([release notes](https://docs.devin.ai/release-notes/2025)).
- Jules shows the plan as steps you expand, then approve; then an activity feed with a diff per file; then Publish branch ([docs](https://jules.google/docs/review-plan/)).
- Linear renders an agent session as a typed feed (thought, action, elicitation, response, error) with four statuses: working, waiting for input, error, done ([docs](https://linear.app/developers/agent-best-practices)).
- Superset and Conductor review diff-first: a file tree with counts, then approve; the overview groups work as In progress and Ready for review with diff stats per row ([Superset](https://superset.sh/), [Conductor](https://conductor.build/)).
- Factory Missions: a planning conversation, approval, then Mission Control, one view with the feature list, the progress log and validation output; you intervene by pausing and telling the orchestrator what you see ([docs](https://docs.factory.com/missions/overview), [announcement](https://factory.com/news/missions)).
- Claude Code on the web keeps a question answerable after the agent goes idle ([docs](https://code.claude.com/docs/en/claude-code-on-the-web)).
- Pixel Agents, for the map Cory wants later: hooks feed events, a state machine picks each character's animation, Canvas 2D draws it, a speech bubble means waiting for input ([repo](https://github.com/pablodelucca/pixel-agents)).

Four layouts were drawn from these, same frame and same invented mission, in `.ui-design/mockups/options.html`: the session page with four anchors, Factory's three panes, the inbox, and the thread. Cory picked the recommendation.

## The decision

Option 3 in front of option 1, with option 4's reply box.

1. **The workspace is the inbox.** Four groups, top to bottom, always in this order: Needs you, Working, Ready to review, Done. A row is a session, a task or a mission, with a lamp and its diff stats. A question from an agent is a row in Needs you with its answers as buttons; it is answered in place.
2. **The mission page has four fixed anchors** in a left rail, the same before, during and after the flight: The ask, Plan, Progress, Result. The mission's status is one of four words: working, waiting for you, error, done. The page updates from a server stream, never by rebuilding itself.
3. **A question is a feed entry** with its answers as buttons and a note field, pinned at the top of Progress, repeated in the inbox, and pushed as a macOS notification from the Electron shell. No browser prompt anywhere.
4. **A reply box to the Strike Lead** sits at the bottom of Progress: one line to pause and say what you see, Factory style. It lands in the ledger as a decision line.

Factory's three-pane Mission Control is not a page. If it is ever wanted, it is what Progress looks like while a mission flies.

Everything else stands: the plan file on the mission branch is the ledger (M18), RIO verdicts and merge-with-notes (M19), the lamps and the flight-deck palette (`.ui-design/system.md`).

## Not decided here

- The palette. The contract says gull greys with insignia red and blue; the light blue accent and the blue wash on the page came in on 2026-09-16 and Cory does not like how it reads. That is a variants round, not this mission.
- The map view. Later; the mechanism is Pixel Agents'.

## Where the mockups are

`.ui-design/mockups/`, served by the app at `/mockups/` through the `web/mockups` symlink: `options.html` (the four, numbered), `mission.html` (option 1 built), `question-queue.html` (the Needs you group, option B chosen), `flight-plan.html`, `debrief.html` (one mission in three moments). All on an invented project, no real names.
