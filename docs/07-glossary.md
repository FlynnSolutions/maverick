---
owner: claude
mode: reference
---
# Glossary

The vocabulary is aviation, and it is load-bearing: the words carry the model.

| Term | Means |
|---|---|
| **Maverick** | the application itself. The pilot: it flies the work. |
| **Air Boss** | the project-level agent. Holds the whole project, writes plans, never edits product code. Runs the flight deck, does not fly. *(designed, not built)* |
| **Mission** | a bounded multi-feature effort, planned into milestones and blessed once. *(designed)* |
| **RIO** | Radar Intercept Officer. The agent that runs a mission: interviews, plans milestones, dispatches and validates. The back-seater works the radar and calls the intercept. *(designed; `src/audits.ts` is its validator half only)* |
| **Wingman** | one item off the board: fresh context, a worktree, a diff. What Maverick spawns today. |
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
| **Audit parent** | a session record with role `audit` that owns a group of task sessions and returns a verdict. |
| **Callsign** | a project's short label, from its `maverick.json`, shown beside the name in the top bar. |
| **Agent readiness** | how well a repo supports an unattended agent, scored 1 to 5. Here: a gate on what may be launched, not a badge. |
