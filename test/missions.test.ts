/**
 * The parts of a mission that are pure: the plan the RIO writes, and the claim the whole
 * design rests on — that mission membership survives an item moving lane, which is why it is
 * a field and not a `###` group.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { costOf, parsePlan } from "../src/missions.ts";
import { addItem, applyMove, parseTracker } from "../src/trackers.ts";

const PLAN = `# Mission: the RIO

An orchestrator that plans with Cory, then flies the mission. Not an Air Boss: it never
answers project questions, and it never writes product code itself.

## Milestone 1 — the plan and the gate

_done when: a plan exists in the tracker as items and nothing has spawned._

- [ ] **Parse the plan document**
  Read the RIO's markdown into milestones and tasks, reusing the tracker parser.
  Reject a plan whose tasks carry only a title.

- [ ] **Write the plan into the tracker**
  One commit, under a group on the roadmap, every item carrying mission and milestone.

## Milestone 2 — the flight

_done when: every task has a passing verdict from a reviewer that did not write it._

- [ ] **Dispatch one Wingman per task**
  A worktree each, branched from the mission branch.
`;

test("parsePlan reads the milestones, their done lines and their tasks", () => {
  const plan = parsePlan(PLAN);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.equal(plan.name, "the RIO");
  assert.match(plan.intro, /^An orchestrator that plans/);
  assert.deepEqual(plan.milestones.map((m) => m.n), [1, 2]);
  assert.equal(plan.milestones[0].title, "the plan and the gate");
  assert.equal(plan.milestones[0].done, "a plan exists in the tracker as items and nothing has spawned");
  assert.deepEqual(plan.milestones[0].tasks.map((t) => t.id), ["m1-t1", "m1-t2"]);
  assert.equal(plan.milestones[0].tasks[0].title, "Parse the plan document");
  assert.match(plan.milestones[0].tasks[0].intent, /reusing the tracker parser/);
  assert.equal(plan.milestones[1].tasks.length, 1);
});

test("a plan missing its done line, its tasks or a task's body is named, not flown", () => {
  const bad = parsePlan(`# Mission: thin\n\n## Milestone 1 — no criterion\n\n- [ ] **A task with nothing under it**\n`);
  assert.ok(bad.problems.some((p) => /no "_done when/.test(p)), bad.problems.join("; "));
  assert.ok(bad.problems.some((p) => /a Wingman gets no other context/.test(p)), bad.problems.join("; "));

  const empty = parsePlan(`# Mission: empty\n\n## Milestone 1 — nothing here\n\n_done when: never._\n`);
  assert.ok(empty.problems.some((p) => /milestone 1 has no tasks/.test(p)), empty.problems.join("; "));

  const stray = parsePlan(`# Mission: stray\n\n## Notes\n\n- [ ] **x**\n  y\n`);
  assert.ok(stray.problems.some((p) => /is not a milestone heading/.test(p)), stray.problems.join("; "));
  assert.ok(stray.problems.some((p) => /no milestones/.test(p)), stray.problems.join("; "));
});

test("a plan with no mission heading is rejected", () => {
  assert.ok(parsePlan("## Milestone 1 — x\n\n_done when: y._\n\n- [ ] **z**\n  w\n").problems.some((p) => /no "# Mission/.test(p)));
});

test("costOf counts two background sessions per task: the Wingman and the reviewer that is not it", () => {
  const cost = costOf(parsePlan(PLAN).milestones);
  assert.deepEqual({ milestones: cost.milestones, tasks: cost.tasks, sessions: cost.sessions }, { milestones: 2, tasks: 3, sessions: 6 });
  assert.match(cost.reference, /12x the tokens/);
});

const TRACKER = `# T

## 🔥 Priority

### Mission: the RIO

## 🚧 In Progress

_Nothing yet._

## 📋 Backlog
`;

test("a task written into the tracker parses back as an ordinary item carrying its fields", () => {
  const block = ["- [ ] `[ENG]` **Dispatch one Wingman per task**", "  - created: 2026-09-16", "  - mission: rio", "  - milestone: 2", "  A worktree each, branched from the mission branch."].join("\n");
  const text = addItem(TRACKER, "🔥 Priority", "Mission: the RIO", block);
  const item = parseTracker(text).sections[0].groups.find((g) => g.name === "Mission: the RIO").items[0];
  assert.equal(item.title, "Dispatch one Wingman per task");
  assert.equal(item.fields.mission, "rio");
  assert.equal(item.fields.milestone, "2");
  assert.match(item.description, /A worktree each/);
});

test("mission membership survives the move a group would not", () => {
  const block = ["- [ ] `[ENG]` **Dispatch one Wingman per task**", "  - mission: rio", "  - milestone: 2"].join("\n");
  const planned = addItem(TRACKER, "🔥 Priority", "Mission: the RIO", block);
  const item = parseTracker(planned).sections[0].groups.find((g) => g.name === "Mission: the RIO").items[0];

  const moved = applyMove(planned, { itemStart: item.start, itemFirstLine: item.firstLine, targetHeading: "🚧 In Progress", targetGroup: "", targetIndex: 0 });
  const after = parseTracker(moved);
  const inProgress = after.sections.find((s) => s.heading === "🚧 In Progress").groups.flatMap((g) => g.items);

  assert.equal(inProgress.length, 1, "the item moved lane");
  assert.equal(inProgress[0].fields.mission, "rio", "the field came with it");
  assert.equal(inProgress[0].fields.milestone, "2");
  // And the group it was planned under is exactly what did not survive.
  assert.equal(after.sections[0].groups.find((g) => g.name === "Mission: the RIO")?.items.length ?? 0, 0);
});
