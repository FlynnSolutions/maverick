/**
 * The parts of a mission that are pure: the plan the Strike Lead writes, and the claim the whole
 * design rests on — that mission membership survives an item moving lane, which is why it is
 * a field and not a `###` group.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ATTEMPTS, applyPlanState, costOf, parsePlan, mergeable, needsPerson, settleReview, startable, strays, type MissionTask } from "../src/missions.ts";
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
  assert.ok(problems(OWNED.replace("  - touches: src/alpha.ts, src/shared/\n", "  - touches: src/alpha.ts, src/shared/\n  - needs: m1-t2\n")).some((p) => /m1-t1 needs m1-t2 needs m1-t1: a loop/.test(p)));
  // A loop of three, which a check on pairs would let through, reported once.
  const three = OWNED.replace("- [ ] **Bravo**", "- [ ] **Delta**\n  - touches: src/delta.ts\n  - needs: m1-t1\n  Build delta.\n\n- [ ] **Bravo**").replace("  - touches: src/alpha.ts, src/shared/\n", "  - touches: src/alpha.ts, src/shared/\n  - needs: m1-t3\n").replace("- needs: m1-t1\n  Build bravo", "- needs: m1-t2\n  Build bravo");
  const loops = problems(three).filter((p) => /a loop/.test(p));
  assert.deepEqual(loops, ["m1-t1 needs m1-t3 needs m1-t2 needs m1-t1: a loop, so none of them could ever start"], problems(three).join("; "));
  assert.equal(problems(OWNED.replace("- needs: m1-t1\n", "- needs: m1-t2\n")).filter((p) => /loop/.test(p)).length, 0, "needing itself is said once, as that");
});

test("a dense plan with no loop parses in milliseconds, and a dense loop is reported once per back edge", () => {
  const dense = (n: number, loop: boolean) => ["# Mission: dense", "", "D.", "", "## Milestone 1 — all", "", "_done when: d._", "",
    ...Array.from({ length: n }, (_, i) => {
      const needs = Array.from({ length: i }, (_, j) => `m1-t${j + 1}`).concat(loop && i === 0 ? [`m1-t${n}`] : []);
      return [`- [ ] **T${i + 1}**`, ...(needs.length ? [`  - needs: ${needs.join(" ")}`] : []), "  Build it."].join("\n");
    })].join("\n\n") + "\n";
  const started = Date.now();
  const plan = parsePlan(dense(40, false), ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.slice(0, 3).join("; "));
  assert.ok(Date.now() - started < 500, `took ${Date.now() - started}ms`);
  // t1 needs t12 and every other task needs t1: eleven back edges, eleven lines, not one per path.
  const looped = parsePlan(dense(12, true), ["root"]).problems.filter((p) => /a loop/.test(p));
  assert.equal(looped.length, 11, looped.join("\n"));
});

test("a touches path that cannot be checked against a diff is a problem, and a path may hold a space", () => {
  const problems = (touches: string) => parsePlan(OWNED.replace("- touches: src/alpha.ts, src/shared/", `- touches: ${touches}`), ["root"]).problems;
  assert.ok(problems("/abs/path.ts").some((p) => /is absolute/.test(p)));
  assert.ok(problems("src/*.ts").some((p) => /is a glob/.test(p)));
  assert.ok(problems("src/../x.ts").some((p) => /steps through/.test(p)));
  assert.ok(problems("src\\x.ts").some((p) => /backslashes/.test(p)));
  assert.ok(problems("~/x.ts").some((p) => /is absolute/.test(p)));
  assert.ok(problems("src/a.ts src/b.ts").some((p) => /separate them with commas/.test(p)), "two paths and no comma");
  const spaced = parsePlan(OWNED.replace("- touches: src/alpha.ts, src/shared/", "- touches: docs/my file.md, src/alpha.ts, src/alpha.ts"), ["root"]);
  assert.deepEqual(spaced.milestones[0].tasks[0].touches, ["docs/my file.md", "src/alpha.ts"], "comma separated, duplicates dropped");
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
  assert.deepEqual(findingsOf("verdict: mixed\r\n- BLOCKER: the test is vacuous\n- **NOTE:** a stray log line\n1. note: lower case too\n- **BLOCKER: bold all through**\n- UNVERIFIED: the deploy\nprose that is not a list line\n  indented evidence under a finding\n---\n1.5 GB of logs"), { blockers: ["the test is vacuous", "bold all through"], notes: ["a stray log line", "lower case too", "unverified: the deploy"], unsorted: [] });
  assert.deepEqual(findingsOf("verdict: fail\n- the logger drops errors (major)\n- NOTE: stray log line\n- the deletion is keyed on the wrong id\n\nNote: I could not run the deploy."), { blockers: [], notes: ["stray log line"], unsorted: ["the logger drops errors (major)", "the deletion is keyed on the wrong id"] }, "a sentence is not a finding; an unsorted list line is kept for the verdict to judge");
  for (const text of ["verdict: fail", "verdict: fail\nThe logger drops every error.", "verdict: mixed\n| BLOCKER | logger |", "verdict: fail\n## Blockers\n\nprose"]) {
    assert.deepEqual(findingsOf(text), { blockers: [], notes: [], unsorted: [] }, text);
  }
  assert.deepEqual(findingsOf("verdict: mixed\n- NOTE: parent\n  - evidence: line 12\n+ BLOCKER: plus bullet\n-NOTE: no space\n  - BLOCKER: and the secret is committed"), { blockers: ["plus bullet", "and the secret is committed"], notes: ["parent", "no space"], unsorted: [] }, "indented evidence belongs to its finding, but an indented blocker is still a blocker");
});

test("the merge-with-notes rule: notes carry, a blocker stops, and retries come first", () => {
  const notes = "verdict: mixed\n- NOTE: a\n- NOTE: b";
  const blocker = "verdict: fail\n- BLOCKER: x\n- NOTE: y";
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass with notes\n- NOTE: tidy later", "pass with notes"), { status: "passed", carried: ["tidy later"] });
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass", "pass"), { status: "passed" });
  assert.deepEqual(settleReview({ attempts: 1 }, notes, "mixed"), { status: "retry" }, "attempts left: back out, whatever the severities");
  assert.deepEqual(settleReview({ attempts: MAX_ATTEMPTS }, notes, "mixed"), { status: "passed", note: "the RIO said mixed after 2 attempts with no blocker open; merged with 2 note(s) carried", carried: ["a", "b"] });
  assert.deepEqual(settleReview({ attempts: MAX_ATTEMPTS }, blocker, "fail"), { status: "handed-back", note: "the RIO said fail after 2 attempts with 1 blocker(s) open; this one is yours" });
  // In a fail or a mixed, an unsorted list line is a blocker, one sorted line does not let the rest through, and listing nothing is a blocker too.
  assert.equal(settleReview({ attempts: MAX_ATTEMPTS }, "verdict: fail\n- NOTE: tidy\n- the real defect\n\nNote: prose", "fail").status, "handed-back");
  for (const text of ["verdict: fail", "verdict: fail\nThe logger drops every error.", "verdict: mixed\n| BLOCKER | logger |"]) assert.equal(settleReview({ attempts: MAX_ATTEMPTS }, text, verdictOf(text)).status, "handed-back", text);
  assert.equal(settleReview({ attempts: MAX_ATTEMPTS }, "verdict: mixed\n- NOTE: a", "mixed").status, "passed", "mixed, notes only, out of retries: merges");
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass\n- BLOCKER: it does not build", "pass"), { status: "retry" }, "a pass with a blocker in it is a mixed");
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass\n- the deletion is keyed on the wrong id", "pass"), { status: "passed", carried: ["the deletion is keyed on the wrong id"] }, "on a pass an unsorted line rides as a note rather than vanishing");
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass with notes\n- NOTE: a\n- UNVERIFIED: the deploy", "pass with notes"), { status: "passed", carried: ["a", "unverified: the deploy"] });
});

test("a task starts when what it needs has passed, wherever that is, and a task with no needs starts with its milestone", () => {
  const t = (id: string, status: MissionTask["status"], needs?: string[]) => ({ id, title: id, intent: "i", repo: "root", status, attempts: 0, ...(needs ? { needs } : {}) });
  const mission = { milestones: [
    { n: 1, title: "a", done: "d", dispatched: "2026-10-09T00:00:00Z", tasks: [t("m1-t1", "passed"), t("m1-t2", "flying"), t("m1-t3", "pending", ["m1-t1"]), t("m1-t4", "pending", ["m1-t2"])] },
    { n: 2, title: "b", done: "d", tasks: [t("m2-t1", "pending", ["m1-t1"]), t("m2-t2", "pending"), t("m2-t3", "pending", ["m1-t1", "m1-t2"])] },
  ] };
  assert.deepEqual(startable(mission).map((s) => s.task.id), ["m1-t3", "m2-t1"], "a sibling whose need passed, and a later task whose need passed, start; m1-t4 and m2-t3 wait on m1-t2; m2-t2 waits for its milestone");
  (mission.milestones[1] as { dispatched?: string }).dispatched = "2026-10-09T01:00:00Z";
  assert.deepEqual(startable(mission).map((s) => s.task.id), ["m1-t3", "m2-t1", "m2-t2"], "once its milestone is sent, a task with no needs goes");
});

const CONTRACTED = `# Mission: contracted

What they share is named first.

## Milestone 1 — both

_done when: both pass._

- [ ] **The data module**
  - touches: src/data/
  Make the claims codec.

- [ ] **The worker**
  - touches: src/worker/
  - needs: m1-t1
  Read claims with the codec.

## Contracts

- **claimsCodec** (owner: m1-t1): encode(claim): string, decode(string): Claim, in src/data/claims.ts
- **CLAIMS_TABLE** (owner: m1-t1): the env flag naming the table
`;

test("contracts are named before fan-out: parsed with an owner and a shape, and a plan that builds on itself without them is warned", () => {
  const plan = parsePlan(CONTRACTED, ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.deepEqual(plan.contracts, [
    { name: "claimsCodec", owner: "m1-t1", shape: "encode(claim): string, decode(string): Claim, in src/data/claims.ts" },
    { name: "CLAIMS_TABLE", owner: "m1-t1", shape: "the env flag naming the table" },
  ]);
  assert.deepEqual(plan.warnings, []);
  const bare = parsePlan(CONTRACTED.slice(0, CONTRACTED.indexOf("## Contracts")), ["root"]);
  assert.equal(bare.problems.length, 0);
  assert.match(bare.warnings[0], /1 task\(s\) build on others and the plan names no contracts/);
  assert.ok(parsePlan(CONTRACTED.replace("(owner: m1-t1): encode", "(owner: m9-t9): encode"), ["root"]).problems.some((p) => /owned by m9-t9, which is not a task/.test(p)));
  assert.ok(parsePlan(CONTRACTED.replace(": the env flag naming the table", ""), ["root"]).problems.some((p) => /CLAIMS_TABLE" has no shape/.test(p)));
  assert.ok(parsePlan(CONTRACTED.replace("- **CLAIMS_TABLE** (owner: m1-t1): the env flag naming the table", "- just a line"), ["root"]).problems.some((p) => /is not "\*\*name\*\* \(owner/.test(p)));
  const odd = parsePlan(CONTRACTED.replace("- **CLAIMS_TABLE** (owner: m1-t1): the env flag naming the table", "- `TABLE` (Owner: M1-T1) the env flag\n- plain name (owner: m1-t1): shape\n- **claimsCodec** (owner: m1-t1): again"), ["root"]);
  assert.deepEqual(odd.contracts.slice(1).map((c) => [c.name, c.owner, c.shape]), [["TABLE", "m1-t1", "the env flag"], ["plain name", "m1-t1", "shape"], ["claimsCodec", "m1-t1", "again"]], "backticks, plain names, any case, a missing colon");
  assert.ok(odd.problems.some((p) => /"claimsCodec" is named twice/.test(p)));
  assert.ok(parsePlan(CONTRACTED.replace("- **CLAIMS_TABLE** (owner: m1-t1): the env flag naming the table", "- `claimsCodec` (owner: m1-t2): the same thing in backticks"), ["root"]).problems.some((p) => /is named twice/.test(p)), "the same name in another markdown style is the same contract");
  assert.ok(parsePlan(CONTRACTED.replace("- **CLAIMS_TABLE** (owner: m1-t1): the env flag naming the table", "- [ ] **X** (owner: m1-t1): s"), ["root"]).problems.some((p) => /is not "\*\*name/.test(p)), "a task bullet is not a contract");
});

test("milestones merge in order, and only once sent: a later one whose tasks all passed early waits", () => {
  const t = (id: string, status: MissionTask["status"]) => ({ id, title: id, intent: "i", repo: "root", status, attempts: 1 });
  const first = { n: 1, title: "a", done: "d", dispatched: "x", tasks: [t("m1-t1", "flying")] };
  const second = { n: 2, title: "b", done: "d", tasks: [t("m2-t1", "passed")] };
  assert.equal(mergeable({ milestones: [first, second] }, second), false, "not sent, and the one before it is still flying");
  const sent = { ...second, dispatched: "x" };
  assert.equal(mergeable({ milestones: [first, sent] }, sent), false, "sent, but the one before it has not merged");
  assert.equal(mergeable({ milestones: [{ ...first, merged: "x" }, sent] }, sent), true);
  const held = { ...sent, conflicts: ["root/a.ts"] };
  assert.equal(mergeable({ milestones: [{ ...first, merged: "x" }, held] }, held), false, "a held milestone is not merged again");
  assert.deepEqual(startable({ status: "paused", milestones: [{ ...first, tasks: [t("m1-t1", "pending")] }] }), [], "nothing starts while paused");
});

test("a person is needed for a handed-back task or a held milestone, and for nothing else", () => {
  const t = (id: string, status: MissionTask["status"], note?: string) => ({ id, title: id, intent: "i", repo: "root", status, attempts: 1, ...(note ? { note } : {}) });
  assert.deepEqual(needsPerson({ milestones: [{ n: 1, title: "a", done: "d", tasks: [t("m1-t1", "flying"), t("m1-t2", "passed")] }] }), []);
  assert.deepEqual(needsPerson({ milestones: [{ n: 1, title: "a", done: "d", tasks: [t("m1-t1", "handed-back", "the RIO said fail after 2 attempts")] }] }), ["m1-t1: the RIO said fail after 2 attempts"]);
  assert.deepEqual(needsPerson({ milestones: [{ n: 1, title: "a", done: "d", merged: "x", held: "could not land: svc", tasks: [t("m1-t1", "passed")] }] }), ["could not land: svc"], "a landing that failed holds its milestone");
  assert.deepEqual(needsPerson({ milestones: [{ n: 1, title: "a", done: "d", conflicts: ["root/a.ts"], held: "milestone 1 collided", tasks: [t("m1-t1", "passed")] }] }), ["milestone 1 collided"]);
});
