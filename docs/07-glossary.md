---
owner: claude
mode: reference
---
# Glossary

The vocabulary is aviation, and it is load-bearing: the words carry the model.

| Term | Means |
|---|---|
| **Maverick** | the application itself. The pilot: it flies the work. |
| **CAG** | Commander, Air Group. One per carrier, commanding every squadron aboard; the acronym outlived the 1963 rename to air *wing* and stuck. Here: the project-level agent, which holds the whole project, writes plans and never edits product code. *(designed, not built)* |
| **Air Boss** | runs the flight deck from Pri-Fly: what launches, when, and whether the deck is fit. Here: the readiness gate that refuses to send an unattended session into a repo it cannot verify. Not in the chain of command; he decides whether you go at all. *(designed, not built)* |
| **Mission** | a bounded multi-feature effort, planned into milestones and blessed once, the way a strike is one package off the deck. Its plan lives in the tracker as items carrying `mission` and `milestone`. |
| **Strike Lead** | the aviator designated to plan and lead one strike package: builds the plan, briefs it, sends it, debriefs it. A role for that mission, not a rank. Here: the agent that runs a mission. It interviews Cory in an embedded terminal and writes the plan; after he blesses it, Maverick dispatches and validates on its behalf. It is also the mission's formation **lead**, which is the same word on purpose. |
| **RIO** | Radar Intercept Officer, the back-seater in a two-seat fighter: one per aircraft, working the sensors and calling what he sees while the pilot flies. Here: the session that reviews one finished Wingman and returns a verdict. It never fixes what it finds, and it never wrote the code. `src/audits.ts` has always been this. |
| **Wingman** | one item off the board: fresh context, a worktree, a diff. On a mission it is one task, with a RIO in its back seat. |
| **Formation** | a named group of sessions flying one job. One **lead** plus its **flight**. Named with phonetic callsigns (Alpha, Bravo, Charlie). |
| **Flight** | the sessions under a formation's lead. |
| **Rack** | the workspace's list of sessions for one project, grouped by urgency. |
| **Strip** | one session's row in the rack. Fixed columns so lamp, state, timing, path and verbs share one x. |
| **Lamp** | a strip's state indicator: a drawn afterburner nozzle for running states, a targeting reticle for the two that want you. |
| **Lane** | a column on the roadmap board, read from a `## ` emoji heading in the tracker: Priority, In progress, Backlog, Done awaiting deploy. |
| **Group** | a `### ` heading inside a lane. Under Priority, a group is a **release**. |
| **Item** | a `- [ ]` bullet, optionally carrying indented `key: value` fields. |
| **Tracker** | the project's markdown work file. The source of truth for all board state. |
| **Ship run** | a saved, resumable set of steps for one version, driving the project's own `SHIP_WORKFLOW.md`. |
| **Milestone** | a group of a mission's tasks that fly together and merge together, the way a division or section of the package launches together. Tasks inside one are parallel; milestones are sequential. No agent holds one: the Strike Lead dispatches every task itself. |
| **Gate** | one of the two places a mission stops for Cory: the plan before anything spawns, and the result before anything ships. |
| **Audit parent** | a session record with role `audit` that owns a group of task sessions and returns a verdict. |
| **Callsign** | a project's short label, from its `maverick.json`, shown beside the name in the top bar. |
| **Agent readiness** | how well a repo supports an unattended agent, scored 1 to 5. Here: a gate on what may be launched, not a badge. |
