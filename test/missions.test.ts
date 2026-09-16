/**
 * The parts of a mission that are pure: the plan the Strike Lead writes, and the claim the whole
 * design rests on — that mission membership survives an item moving lane, which is why it is
 * a field and not a `###` group.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { costOf, parsePlan } from "../src/missions.ts";
import { addItem, applyMove, parseTracker } from "../src/trackers.ts";

const PLAN = `# Mission: the Strike Lead

An orchestrator that plans with Cory, then flies the mission. Not an Air Boss: it never
answers project questions, and it never writes product code itself.

## Milestone 1 — the plan and the gate

_done when: a plan exists in the tracker as items and nothing has spawned._

- [ ] **Parse the plan document**
  Read the Strike Lead's markdown into milestones and tasks, reusing the tracker parser.
  Reject a plan whose tasks carry only a title.

- [ ] **Write the plan into the tracker**
  One commit, under a group on the roadmap, every item carrying mission and milestone.

## Milestone 2 — the flight

_done when: every task has a passing verdict from a reviewer that did not write it._

- [ ] **Dispatch one Wingman per task**
  A worktree each, branched from the mission branch.
`;

test("parsePlan reads the milestones, their done lines and their tasks", () => {
  const plan = parsePlan(PLAN, ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.equal(plan.name, "the Strike Lead");
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
  const bad = parsePlan(`# Mission: thin\n\n## Milestone 1 — no criterion\n\n- [ ] **A task with nothing under it**\n`, ["root"]);
  assert.ok(bad.problems.some((p) => /no "_done when/.test(p)), bad.problems.join("; "));
  assert.ok(bad.problems.some((p) => /a Wingman gets no other context/.test(p)), bad.problems.join("; "));

  const empty = parsePlan(`# Mission: empty\n\n## Milestone 1 — nothing here\n\n_done when: never._\n`, ["root"]);
  assert.ok(empty.problems.some((p) => /milestone 1 has no tasks/.test(p)), empty.problems.join("; "));

  const stray = parsePlan(`# Mission: stray\n\n## Notes\n\n- [ ] **x**\n  y\n`, ["root"]);
  assert.ok(stray.problems.some((p) => /is not a milestone heading/.test(p)), stray.problems.join("; "));
  assert.ok(stray.problems.some((p) => /no milestones/.test(p)), stray.problems.join("; "));
});

test("a plan with no mission heading is rejected", () => {
  assert.ok(parsePlan("## Milestone 1 — x\n\n_done when: y._\n\n- [ ] **z**\n  w\n", ["root"]).problems.some((p) => /no "# Mission/.test(p)));
});

test("costOf counts two background sessions per task: the Wingman and the reviewer that is not it", () => {
  const cost = costOf(parsePlan(PLAN, ["root"]).milestones);
  assert.deepEqual({ milestones: cost.milestones, tasks: cost.tasks, sessions: cost.sessions, repos: cost.repos }, { milestones: 2, tasks: 3, sessions: 6, repos: 1 });
  assert.match(cost.reference, /12x the tokens/);
});

const TRACKER = `# T

## 🔥 Priority

### Mission: the Strike Lead

## 🚧 In Progress

_Nothing yet._

## 📋 Backlog
`;

test("a task written into the tracker parses back as an ordinary item carrying its fields", () => {
  const block = ["- [ ] `[ENG]` **Dispatch one Wingman per task**", "  - created: 2026-09-16", "  - mission: strike-lead", "  - milestone: 2", "  A worktree each, branched from the mission branch."].join("\n");
  const text = addItem(TRACKER, "🔥 Priority", "Mission: the Strike Lead", block);
  const item = parseTracker(text).sections[0].groups.find((g) => g.name === "Mission: the Strike Lead").items[0];
  assert.equal(item.title, "Dispatch one Wingman per task");
  assert.equal(item.fields.mission, "strike-lead");
  assert.equal(item.fields.milestone, "2");
  assert.match(item.description, /A worktree each/);
});

test("mission membership survives the move a group would not", () => {
  const block = ["- [ ] `[ENG]` **Dispatch one Wingman per task**", "  - mission: strike-lead", "  - milestone: 2"].join("\n");
  const planned = addItem(TRACKER, "🔥 Priority", "Mission: the Strike Lead", block);
  const item = parseTracker(planned).sections[0].groups.find((g) => g.name === "Mission: the Strike Lead").items[0];

  const moved = applyMove(planned, { itemStart: item.start, itemFirstLine: item.firstLine, targetHeading: "🚧 In Progress", targetGroup: "", targetIndex: 0 });
  const after = parseTracker(moved);
  const inProgress = after.sections.find((s) => s.heading === "🚧 In Progress").groups.flatMap((g) => g.items);

  assert.equal(inProgress.length, 1, "the item moved lane");
  assert.equal(inProgress[0].fields.mission, "strike-lead", "the field came with it");
  assert.equal(inProgress[0].fields.milestone, "2");
  // And the group it was planned under is exactly what did not survive.
  assert.equal(after.sections[0].groups.find((g) => g.name === "Mission: the Strike Lead")?.items.length ?? 0, 0);
});

const MULTI = `# Mission: the conversation foundation

Scope as a real key across three repos, in the order they have to land.

## Milestone 1 — the contract

_done when: the scope pair is on main in contracts and pushed._

- [ ] **Reshape MessageScopeType**
  - repo: contracts
  Rename the scope pair and regenerate.

## Milestone 2 — the backend and its migration

_done when: the backfill dry-run reports counts for every environment._

- [ ] **Scope key on Message and Notification**
  - repo: RTMFG-backend
  Add scopeType, scopeId and the stored scopeKey with a byScope index.

- [ ] **The backfill**
  - repo: RTMFG-backend
  Write the migration and dry-run it.

## Milestone 3 — the client

_done when: the dock reads the scope key and the E2E suite is green._

- [ ] **Read the scope key**
  - repo: RTMFG-frontend
  Point MessagingConversation at the new key.
`;

const REPOS = ["root", "contracts", "RTMFG-backend", "RTMFG-frontend"];

test("a task names the repo it works in, and the plan carries the order across them", () => {
  const plan = parsePlan(MULTI, REPOS);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.deepEqual(plan.milestones.map((m) => m.tasks.map((t) => t.repo)), [["contracts"], ["RTMFG-backend", "RTMFG-backend"], ["RTMFG-frontend"]]);
  // Two tasks in one milestone share a repo, so they are parallel inside it; the repos that
  // must land in order are in different milestones, which is what makes that order hold.
  const cost = costOf(plan.milestones);
  assert.deepEqual({ repos: cost.repos, tasks: cost.tasks, milestones: cost.milestones }, { repos: 3, tasks: 4, milestones: 3 });
});

test("a multi-repo project refuses a plan whose task does not say where it works", () => {
  const plan = parsePlan(MULTI.replace("  - repo: contracts\n", ""), REPOS);
  assert.ok(plan.problems.some((p) => /names no repo/.test(p)), plan.problems.join("; "));
});

test("a task naming a repo the project does not have is refused, and the message lists the real ones", () => {
  const plan = parsePlan(MULTI.replace("- repo: contracts", "- repo: RTMFG-backendd"), REPOS);
  const problem = plan.problems.find((p) => /is not one of/.test(p));
  assert.ok(problem, plan.problems.join("; "));
  assert.match(problem, /RTMFG-backend, RTMFG-frontend/);
});

test("a single-repo project may leave the repo line off, and every task gets that repo", () => {
  const plan = parsePlan(PLAN, ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.ok(plan.milestones.flatMap((m) => m.tasks).every((t) => t.repo === "root"));
});
