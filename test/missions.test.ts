/**
 * The parts of a mission that are pure: the plan the Strike Lead writes, and the claim the whole
 * design rests on — that mission membership survives an item moving lane, which is why it is
 * a field and not a `###` group.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ATTEMPTS, applyPlanState, costOf, parsePlan, settleReview, strays } from "../src/missions.ts";
import { findingsOf, verdictOf } from "../src/audits.ts";
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
  - repo: orbit-api
  Add scopeType, scopeId and the stored scopeKey with a byScope index.

- [ ] **The backfill**
  - repo: orbit-api
  Write the migration and dry-run it.

## Milestone 3 — the client

_done when: the dock reads the scope key and the E2E suite is green._

- [ ] **Read the scope key**
  - repo: orbit-web
  Point MessagingConversation at the new key.
`;

const REPOS = ["root", "contracts", "orbit-api", "orbit-web"];

test("a task names the repo it works in, and the plan carries the order across them", () => {
  const plan = parsePlan(MULTI, REPOS);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.deepEqual(plan.milestones.map((m) => m.tasks.map((t) => t.repo)), [["contracts"], ["orbit-api", "orbit-api"], ["orbit-web"]]);
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
  const plan = parsePlan(MULTI.replace("- repo: contracts", "- repo: orbit-apid"), REPOS);
  const problem = plan.problems.find((p) => /is not one of/.test(p));
  assert.ok(problem, plan.problems.join("; "));
  assert.match(problem, /orbit-api, orbit-web/);
});

test("a single-repo project may leave the repo line off, and every task gets that repo", () => {
  const plan = parsePlan(PLAN, ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.ok(plan.milestones.flatMap((m) => m.tasks).every((t) => t.repo === "root"));
});

const FLOWN = `# Mission: flown

Half way through.

## Milestone 1 — the first

_done when: both tasks pass._

- [x] **Already passed**
  - repo: root
  - status: passed
  - attempt: 1
  - verdict: pass
  - commit: abc1234
  Build the first thing.

- [~] **In review now**
  - status: reviewing
  - attempt: 2
  Build the second thing.

## Log

- 2026-10-09 08:00 m1-t1 Already passed: pending to flying
- 2026-10-09 09:00 m1-t1 Already passed: reviewing to passed (RIO: pass)
`;

test("the plan on the mission branch is the ledger: parsePlan reads the state and the log back", () => {
  const plan = parsePlan(FLOWN, ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  const [done, reviewing] = plan.milestones[0].tasks;
  assert.deepEqual({ status: done.status, attempts: done.attempts, verdict: done.verdict, head: done.head }, { status: "passed", attempts: 1, verdict: "pass", head: "abc1234" });
  assert.deepEqual({ status: reviewing.status, attempts: reviewing.attempts, verdict: reviewing.verdict }, { status: "reviewing", attempts: 2, verdict: undefined });
  assert.equal(reviewing.intent, "Build the second thing.");
  assert.equal(plan.log.length, 2);
  assert.match(plan.log[1], /reviewing to passed/);
});

test("a state the ledger cannot have is a problem, not a guess", () => {
  const plan = parsePlan(FLOWN.replace("- status: reviewing", "- status: flown"), ["root"]);
  assert.ok(plan.problems.some((p) => /status "flown"/.test(p)), plan.problems.join("; "));
  const verdict = parsePlan(FLOWN.replace("- verdict: pass", "- verdict: maybe"), ["root"]);
  assert.ok(verdict.problems.some((p) => /verdict "maybe"/.test(p)), verdict.problems.join("; "));
});

test("applyPlanState writes the state under each task and reads back equal, leaving the Lead's words alone", () => {
  const { milestones } = parsePlan(PLAN, ["root"]);
  milestones[0].tasks[0] = { ...milestones[0].tasks[0], status: "passed", attempts: 1, verdict: "pass", head: "deadbee" };
  milestones[0].tasks[1] = { ...milestones[0].tasks[1], status: "reviewing", attempts: 2 };
  const once = applyPlanState(PLAN, milestones, ["2026-10-09 10:00 m1-t1 Parse the plan document: reviewing to passed (RIO: pass)"]);
  const back = parsePlan(once, ["root"]);
  assert.equal(back.problems.length, 0, back.problems.join("; "));
  assert.deepEqual(back.milestones.map((m) => m.tasks.map((t) => [t.status, t.attempts, t.verdict, t.head])), [[["passed", 1, "pass", "deadbee"], ["reviewing", 2, undefined, undefined]], [["pending", 0, undefined, undefined]]]);
  // The prose, the done lines and the intro are untouched; only the state moved.
  assert.deepEqual(back.milestones.map((m) => m.tasks.map((t) => t.intent)), parsePlan(PLAN, ["root"]).milestones.map((m) => m.tasks.map((t) => t.intent)));
  assert.equal(back.intro, parsePlan(PLAN, ["root"]).intro);
  assert.match(once, /^- \[x\] \*\*Parse the plan document\*\*\n  - status: passed\n  - attempt: 1\n  - verdict: pass\n  - commit: deadbee\n  Read the Strike Lead's/m);
  assert.deepEqual(back.log, ["2026-10-09 10:00 m1-t1 Parse the plan document: reviewing to passed (RIO: pass)"]);
  // Writing the same state again changes nothing, and a new entry lands after the old one.
  assert.equal(applyPlanState(once, milestones), once);
  const twice = applyPlanState(once, milestones, ["2026-10-09 10:05 m1-t2 Write the plan into the tracker: reviewing to passed (RIO: pass)"]);
  assert.deepEqual(parsePlan(twice, ["root"]).log.map((l) => l.slice(0, 16)), ["2026-10-09 10:00", "2026-10-09 10:05"]);
  assert.ok(twice.endsWith("(RIO: pass)\n"), JSON.stringify(twice.slice(-80)));
});

const OWNED = `# Mission: owned

Who touches what.

## Milestone 1 — parallel

_done when: both pass._

- [ ] **Alpha**
  - touches: src/alpha.ts, src/shared/
  Build alpha.

- [ ] **Bravo**
  - touches: src/bravo.ts, ./src/shared/types.ts
  - needs: m1-t1
  Build bravo on alpha.

## Milestone 2 — after

_done when: it lands._

- [ ] **Charlie**
  - touches: src/charlie/
  - needs: m1-t2 m1-t1
  Build charlie.
`;

test("touches and needs are read from the plan, and an overlap inside one milestone is named", () => {
  const plan = parsePlan(OWNED, ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  const [alpha, bravo] = plan.milestones[0].tasks;
  assert.deepEqual(alpha.touches, ["src/alpha.ts", "src/shared"]);
  assert.deepEqual(bravo.touches, ["src/bravo.ts", "src/shared/types.ts"], "a leading ./ and a trailing / are noise");
  assert.deepEqual(bravo.needs, ["m1-t1"]);
  assert.deepEqual(plan.milestones[1].tasks[0].needs, ["m1-t2", "m1-t1"]);
  assert.deepEqual(plan.overlaps, ["milestone 1: m1-t1 and m1-t2 both touch src/shared"], "a file inside a directory another task owns");
  assert.deepEqual(parsePlan(OWNED.replace("./src/shared/types.ts", "src/other.ts"), ["root"]).overlaps, []);
});

test("a need that is missing, itself, later, or mutual is a problem", () => {
  const problems = (text: string) => parsePlan(text, ["root"]).problems;
  assert.ok(problems(OWNED.replace("- needs: m1-t1\n", "- needs: m9-t9\n")).some((p) => /needs "m9-t9", which is not a task/.test(p)));
  assert.ok(problems(OWNED.replace("- needs: m1-t1\n", "- needs: m1-t2\n")).some((p) => /needs itself/.test(p)));
  assert.ok(problems(OWNED.replace("- needs: m1-t1\n", "- needs: m2-t1\n")).some((p) => /flies later, in milestone 2/.test(p)));
  assert.ok(problems(OWNED.replace("  - touches: src/alpha.ts, src/shared/\n", "  - touches: src/alpha.ts, src/shared/\n  - needs: m1-t2\n")).some((p) => /need each other/.test(p)));
});

test("strays are the files a Wingman changed that none of its touches cover", () => {
  assert.deepEqual(strays(["src/alpha.ts", "src/shared/a.ts", "src/other.ts", "test/alpha.test.ts"], ["src/alpha.ts", "src/shared"]), ["src/other.ts", "test/alpha.test.ts"]);
  assert.deepEqual(strays(["anything"], undefined), [], "a task that owns nothing in particular has no strays");
  assert.deepEqual(strays(["src/alpha.tsx"], ["src/alpha.ts"]), ["src/alpha.tsx"], "a prefix is not a match");
});

test("a task whose title is not bold survives the marker the ledger puts on it", () => {
  const plain = "# Mission: plain\n\nP.\n\n## Milestone 1 — m\n\n_done when: d._\n\n- [ ] Plain title task\n  Do the plain thing.\n";
  const { milestones } = parsePlan(plain, ["root"]);
  milestones[0].tasks[0] = { ...milestones[0].tasks[0], status: "flying", attempts: 1 };
  const back = parsePlan(applyPlanState(plain, milestones), ["root"]);
  assert.equal(back.milestones[0].tasks[0].title, "Plain title task");
  // A plain title has always been read into the intent as well (the legacy one-line shape); what matters is that the marker is not.
  assert.equal(back.milestones[0].tasks[0].intent, parsePlan(plain, ["root"]).milestones[0].tasks[0].intent);
  assert.doesNotMatch(back.milestones[0].tasks[0].intent, /\[~\]/);
  assert.equal(back.milestones[0].tasks[0].status, "flying");
});

test("a RIO's verdict is one of four, and its findings sort into blockers and notes", () => {
  assert.equal(verdictOf("verdict: pass with notes\n- NOTE: x"), "pass with notes");
  assert.equal(verdictOf("verdict: Pass\n"), "pass");
  assert.equal(verdictOf("verdict: mixed"), "mixed");
  assert.equal(verdictOf("no verdict here"), "pending");
  assert.deepEqual(findingsOf("verdict: mixed\n- BLOCKER: the test is vacuous\n- **NOTE:** a stray log line\n* note: lower case too\nnot a finding", "mixed"), { blockers: ["the test is vacuous"], notes: ["a stray log line", "lower case too"] });
  assert.deepEqual(findingsOf("verdict: fail\n- the logger drops errors (major)", "fail").blockers, ["findings not sorted into BLOCKER and NOTE; all read as blockers"]);
  assert.deepEqual(findingsOf("verdict: pass\n", "pass"), { blockers: [], notes: [] });
});

test("the merge-with-notes rule: notes carry, a blocker stops, and retries come first", () => {
  const notes = "verdict: mixed\n- NOTE: a\n- NOTE: b";
  const blocker = "verdict: fail\n- BLOCKER: x\n- NOTE: y";
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass with notes\n- NOTE: tidy later", "pass with notes"), { status: "passed", carried: ["tidy later"] });
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass", "pass"), { status: "passed" });
  assert.deepEqual(settleReview({ attempts: 1 }, notes, "mixed"), { status: "retry" }, "attempts left: back out, whatever the severities");
  assert.deepEqual(settleReview({ attempts: MAX_ATTEMPTS }, notes, "mixed"), { status: "passed", note: "the RIO said mixed after 2 attempts with no blocker open; merged with 2 note(s) carried", carried: ["a", "b"] });
  assert.deepEqual(settleReview({ attempts: MAX_ATTEMPTS }, blocker, "fail"), { status: "handed-back", note: "the RIO said fail after 2 attempts with 1 blocker(s) open; this one is yours" });
  assert.equal(settleReview({ attempts: MAX_ATTEMPTS }, "verdict: fail\n- something unsorted", "fail").status, "handed-back", "unsorted findings are blockers");
});
