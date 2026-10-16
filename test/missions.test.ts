/**
 * The parts of a mission that are pure: the plan the Strike Lead writes, and the claim the whole
 * design rests on — that mission membership survives an item moving lane, which is why it is
 * a field and not a `###` group.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { config } from "../src/config.ts";
import { tempRepo } from "./fixtures.ts";
import { MAX_ATTEMPTS, applyPlanState, costOf, endFinished, markReading, missionView, movesOf, parsePlan, mergeable, needsPerson, runProof, sayToStrikeLead, settle, settleReview, startable, strays, summarizeMission, summaryState, sweepMissions, transitions, type Mission, type MissionTask } from "../src/missions.ts";
import { findingsOf, verdictOf } from "../src/audits.ts";
import { feedOf } from "../src/feed.ts";
import { addItem, applyMove, parseTracker, today } from "../src/trackers.ts";
import { closeTerminal, openTerminal } from "../src/terminal.ts";

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

test("a pass with notes writes how many it carried to the ledger, never the notes", () => {
  const before = parsePlan(FLOWN, ["root"]);
  const notes = Array.from({ length: 10 }, (_, i) => `NOTE(src/x, ship): note ${i}; with a semicolon`);
  const task = (carried: string[], patch: Partial<MissionTask> = {}) => ({ milestones: [{ n: 1, title: "the first", done: "d", tasks: [
    { ...before.milestones[0].tasks[0] },
    { ...before.milestones[0].tasks[1], id: "m1-t2", title: "In review now", status: "passed", verdict: "pass with notes", carried, ...patch }] }] }) as unknown as Mission;
  const [line] = transitions(before, task([...notes, "unverified: the deploy"]), "2026-10-14 10:00");
  assert.equal(line, "2026-10-14 10:00 m1-t2 In review now: reviewing to passed (RIO: pass with notes) with 10 notes carried, 1 unverified");
  assert.equal(transitions(before, task(notes.slice(0, 2)), "s")[0], "s m1-t2 In review now: reviewing to passed (RIO: pass with notes) with 2 notes carried", "no unverified clause when none is");
  assert.equal(transitions(before, task(["UNVERIFIED(deploy, check): not deployed"]), "s")[0], "s m1-t2 In review now: reviewing to passed (RIO: pass with notes) with 0 notes carried, 1 unverified");
  const auto = transitions(before, task(["NOTE: a"], { verdict: "mixed", note: "the RIO said mixed after 2 attempts with no blocker open" }), "s")[0];
  assert.equal(auto, "s auto: m1-t2 In review now: reviewing to passed (RIO: mixed) with 1 notes carried: the RIO said mixed after 2 attempts with no blocker open", "the count is said once, right after the verdict");
  assert.equal(transitions(before, task([], { verdict: "pass" }), "s")[0], "s m1-t2 In review now: reviewing to passed (RIO: pass)", "nothing carried, nothing counted");
  assert.doesNotMatch(applyPlanState(FLOWN, task(notes).milestones, [line]), /\[carried:|note 3/);
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
  assert.deepEqual(findingsOf("verdict: mixed\r\n- BLOCKER: the test is vacuous\n- **NOTE:** a stray log line\n1. note: lower case too\n- **BLOCKER: bold all through**\n- UNVERIFIED: the deploy\nprose that is not a list line\n  indented evidence under a finding\n---\n1.5 GB of logs"), { blockers: ["BLOCKER: the test is vacuous", "BLOCKER: bold all through"], notes: ["NOTE: a stray log line", "note: lower case too", "UNVERIFIED: the deploy"], unsorted: [] }, "each line is kept whole, as written, for src/findings.ts to read");
  assert.deepEqual(findingsOf("verdict: fail\n- the logger drops errors (major)\n- NOTE: stray log line\n- the deletion is keyed on the wrong id\n\nNote: I could not run the deploy."), { blockers: [], notes: ["NOTE: stray log line"], unsorted: ["the logger drops errors (major)", "the deletion is keyed on the wrong id"] }, "a sentence is not a finding; an unsorted list line is kept for the verdict to judge");
  for (const text of ["verdict: fail", "verdict: fail\nThe logger drops every error.", "verdict: mixed\n| BLOCKER | logger |", "verdict: fail\n## Blockers\n\nprose"]) {
    assert.deepEqual(findingsOf(text), { blockers: [], notes: [], unsorted: [] }, text);
  }
  assert.deepEqual(findingsOf("verdict: mixed\n- NOTE: parent\n  - evidence: line 12\n+ BLOCKER: plus bullet\n-NOTE: no space\n  - BLOCKER: and the secret is committed"), { blockers: ["BLOCKER: plus bullet", "BLOCKER: and the secret is committed"], notes: ["NOTE: parent", "NOTE: no space"], unsorted: [] }, "indented evidence belongs to its finding, but an indented blocker is still a blocker");
  assert.deepEqual(findingsOf("verdict: mixed\n- BLOCKER(src/worker, fix): a failed job is retried forever. line 42\n- NOTE(web/signin, ship): focus is lost. The Wingman called it out of scope.\n- **UNVERIFIED(deploy, check):** the staging deploy\n  - BLOCKER(src/auth, fix): the secret is committed"), { blockers: ["BLOCKER(src/worker, fix): a failed job is retried forever. line 42", "BLOCKER(src/auth, fix): the secret is committed"], notes: ["NOTE(web/signin, ship): focus is lost. The Wingman called it out of scope.", "UNVERIFIED(deploy, check): the staging deploy"], unsorted: [] }, "the (area, severity) shape sorts by its kind and is kept whole for src/findings.ts to read");
  assert.deepEqual(findingsOf("verdict: mixed\n- NOTE (web/x, ship): space before the parenthetical\n- note( src/a , fix ):lower case\n  - BLOCKER (src/b, fix): indented"), { blockers: ["BLOCKER (src/b, fix): indented"], notes: ["NOTE (web/x, ship): space before the parenthetical", "note( src/a , fix ):lower case"], unsorted: [] }, "a space before the parenthetical still sorts, and the line is not rewritten: parseFinding reads it as it is");
});

test("the merge-with-notes rule: notes carry, a blocker stops, and retries come first", () => {
  const notes = "verdict: mixed\n- NOTE: a\n- NOTE: b";
  const blocker = "verdict: fail\n- BLOCKER: x\n- NOTE: y";
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass with notes\n- NOTE: tidy later", "pass with notes"), { status: "passed", carried: ["NOTE: tidy later"] });
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass", "pass"), { status: "passed" });
  assert.deepEqual(settleReview({ attempts: 1 }, notes, "mixed"), { status: "retry" }, "attempts left: back out, whatever the severities");
  assert.deepEqual(settleReview({ attempts: MAX_ATTEMPTS }, notes, "mixed"), { status: "passed", note: "the RIO said mixed after 2 attempts with no blocker open", carried: ["NOTE: a", "NOTE: b"] });
  assert.deepEqual(settleReview({ attempts: MAX_ATTEMPTS }, blocker, "fail"), { status: "handed-back", note: "the RIO said fail after 2 attempts with 1 blocker(s) open; this one is yours" });
  // In a fail or a mixed, an unsorted list line is a blocker, one sorted line does not let the rest through, and listing nothing is a blocker too.
  assert.equal(settleReview({ attempts: MAX_ATTEMPTS }, "verdict: fail\n- NOTE: tidy\n- the real defect\n\nNote: prose", "fail").status, "handed-back");
  for (const text of ["verdict: fail", "verdict: fail\nThe logger drops every error.", "verdict: mixed\n| BLOCKER | logger |"]) assert.equal(settleReview({ attempts: MAX_ATTEMPTS }, text, verdictOf(text)).status, "handed-back", text);
  assert.equal(settleReview({ attempts: MAX_ATTEMPTS }, "verdict: mixed\n- NOTE: a", "mixed").status, "passed", "mixed, notes only, out of retries: merges");
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass\n- BLOCKER: it does not build", "pass"), { status: "retry" }, "a pass with a blocker in it is a mixed");
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass\n- the deletion is keyed on the wrong id", "pass"), { status: "passed", carried: ["the deletion is keyed on the wrong id"] }, "on a pass an unsorted line rides as a note rather than vanishing");
  assert.deepEqual(settleReview({ attempts: 1 }, "verdict: pass with notes\n- NOTE: a\n- UNVERIFIED: the deploy", "pass with notes"), { status: "passed", carried: ["NOTE: a", "UNVERIFIED: the deploy"] }, "a carried line keeps its kind, so the report and the page read it as the verdict did");
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
  const held = { ...sent, conflicts: ["root/a.ts"], hold: { kind: "collision", reason: "collided", at: "2026-10-09T00:00:00Z" } };
  assert.equal(mergeable({ milestones: [{ ...first, merged: "x" }, held] }, held), false, "a held milestone is not merged again");
  assert.deepEqual(startable({ status: "paused", milestones: [{ ...first, tasks: [t("m1-t1", "pending")] }] }), [], "nothing starts while paused");
});

test("a person is needed for a handed-back task or a held milestone, and for nothing else", () => {
  const t = (id: string, status: MissionTask["status"], note?: string) => ({ id, title: id, intent: "i", repo: "root", status, attempts: 1, ...(note ? { note } : {}) });
  assert.deepEqual(needsPerson({ milestones: [{ n: 1, title: "a", done: "d", tasks: [t("m1-t1", "flying"), t("m1-t2", "passed")] }] }), []);
  assert.deepEqual(needsPerson({ milestones: [{ n: 1, title: "a", done: "d", tasks: [t("m1-t1", "handed-back", "the RIO said fail after 2 attempts")] }] }), ["m1-t1: the RIO said fail after 2 attempts"]);
  assert.deepEqual(needsPerson({ milestones: [{ n: 1, title: "a", done: "d", merged: "x", hold: { kind: "landing", reason: "could not land: svc", at: "2026-10-09T00:00:00Z" }, tasks: [t("m1-t1", "passed")] }] }), ["could not land: svc"], "a landing that failed holds its milestone");
  assert.deepEqual(needsPerson({ milestones: [{ n: 1, title: "a", done: "d", conflicts: ["root/a.ts"], hold: { kind: "collision", reason: "milestone 1 collided", at: "2026-10-09T00:00:00Z" }, tasks: [t("m1-t1", "passed")] }] }), ["milestone 1 collided"]);
});

test("one deployer per stack per milestone, and a shared environment is nobody's to deploy from a task", () => {
  const plan = (deploys: string) => `# Mission: d\n\nD.\n\n## Milestone 1 — m\n\n_done when: d._\n\n- [ ] **Infra**\n  - deploys: data, compute\n  a\n\n- [ ] **App**\n  - deploys: ${deploys}\n  b\n`;
  const fine = parsePlan(plan("api"), ["root"], ["dev"]);
  assert.equal(fine.problems.length, 0, fine.problems.join("; "));
  assert.deepEqual(fine.milestones[0].tasks[0].deploys, ["data", "compute"]);
  assert.ok(parsePlan(plan("compute"), ["root"], ["dev"]).problems.some((p) => /m1-t1 and m1-t2 both deploy compute; one deployer per stack per milestone/.test(p)));
  assert.ok(parsePlan(plan("dev"), ["root"], ["dev"]).problems.some((p) => /deploys dev, which this project lists as shared; only the merged mission branch deploys there/.test(p)));
  assert.ok(parsePlan(plan("`Dev`"), ["root"], ["dev"]).problems.some((p) => /lists as shared/.test(p)), "backticks and case do not get a shared environment past the gate");
  assert.ok(parsePlan(plan("data; Compute"), ["root"], ["dev"]).problems.some((p) => /both deploy compute/.test(p)), "a semicolon splits, and Compute is compute");
  assert.equal(parsePlan(plan("dev"), ["root"]).problems.length, 0, "a project that names nothing shared has no such rule");
});

test("the proof runs where the milestone merged, and a proof that cannot run is a failed proof", async () => {
  const ok = await runProof(import.meta.dirname, "echo proven");
  assert.deepEqual({ ok: ok.ok, output: ok.output.trim() }, { ok: true, output: "proven" });
  const bad = await runProof(import.meta.dirname, "echo broke; exit 3");
  assert.equal(bad.ok, false);
  assert.match(bad.output, /broke/);
  assert.equal((await runProof("/nowhere/at/all", "true")).ok, false);
  // A server started in the background does not hold the proof open, and does not outlive it:
  // the proof prints its background pid and the test watches that one pid, nothing else on the host.
  const started = Date.now();
  const bg = await runProof(import.meta.dirname, "sleep 31.4159 & echo pid=$!");
  assert.equal(bg.ok, true);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms: judged by the shell's exit, not its pipes`);
  const pid = Number(bg.output.match(/pid=(\d+)/)?.[1]);
  assert.ok(pid > 0, bg.output);
  const alive = (): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 40 && alive(); i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(), false, "the group was killed after the proof");
  const slow = await runProof(import.meta.dirname, "sleep 20", 300);
  assert.equal(slow.ok, false);
  assert.match(slow.output, /timed out/);
});

test("a need in a held milestone is not a base to build on", () => {
  const t = (id: string, status: MissionTask["status"], needs?: string[]) => ({ id, title: id, intent: "i", repo: "root", status, attempts: 1, ...(needs ? { needs } : {}) });
  const held = { n: 1, title: "a", done: "d", dispatched: "x", merged: "x", hold: { kind: "landing", reason: "could not land: svc", at: "2026-10-09T00:00:00Z" }, tasks: [t("m1-t1", "passed")] };
  const later = { n: 2, title: "b", done: "d", tasks: [t("m2-t1", "pending", ["m1-t1"])] };
  assert.deepEqual(startable({ status: "blocked", milestones: [held, later] }), [], "the push never landed, so nothing builds on it");
  assert.deepEqual(startable({ status: "flying", milestones: [{ ...held, hold: undefined }, later] }).map((s) => s.task.id), ["m2-t1"]);
  // One deployer per stack in the air, and one owner per path in the air, whatever the milestones say.
  const flyer = { ...t("m1-t1", "flying"), deploys: ["compute"], touches: ["src/a/"] };
  const sameStack = { ...t("m1-t2", "pending"), deploys: ["Compute"] };
  const samePath = { ...t("m1-t3", "pending"), touches: ["src/a/b.ts"] };
  const apart = { ...t("m1-t4", "pending"), deploys: ["data"], touches: ["src/z.ts"] };
  assert.deepEqual(startable({ status: "flying", milestones: [{ n: 1, title: "a", done: "d", dispatched: "x", tasks: [flyer, sameStack, samePath, apart] }] }).map((s) => s.task.id), ["m1-t4"], "the two that would clash with the flyer wait their turn");
});

test("a session a mission is done with is ended while its process is up: finished ones while flying, any seated one once the mission has stopped flying", async () => {
  const t = (id: string, claudeId: string, review?: string) => ({ id, title: id, intent: "i", repo: "root", status: "passed" as const, attempts: 1, claudeId, ...(review ? { review: { claudeId: review, file: "f", started: "s" } } : {}) });
  const milestones = [
    { n: 1, title: "a", done: "d", merged: "m", tasks: [t("m1-t1", "w1", "r1"), t("m1-t2", "w2")], walkthrough: { claudeId: "b1", started: "s" } },
    { n: 2, title: "b", done: "d", tasks: [t("m2-t1", "w3", "r3")], resolve: { claudeId: "x1", repo: "root", branch: "b", started: "s", paths: [] } },
  ];
  const flying = { status: "flying", milestones, summary: { claudeId: "s1", started: "s" } } as unknown as Mission;
  // The listing: a pid means the process is up; a finished session without one has already gone.
  const agents = new Map([
    ["w1", { state: "done", pid: 11 }], ["r1", { state: "done" }], ["w2", { state: "exited", pid: 12 }], ["b1", { state: "done", pid: 13 }],
    ["w3", { state: "running", pid: 14 }], ["r3", { state: "blocked", pid: 15 }], ["x1", { state: "stopped", pid: 16 }], ["s1", { state: "done", pid: 17 }],
  ]);
  const stopped: string[] = [];
  const stop = async (id: string) => { stopped.push(id); };
  assert.deepEqual(await endFinished(flying, agents, stop), ["w1", "w2", "x1", "b1", "s1"], "finished with a process up, the flight's first; the one already gone, the Wingman still working and the RIO on a prompt are left alone");
  assert.deepEqual(await endFinished({ ...flying, status: "review" } as Mission, agents, stop), ["w1", "w2", "w3", "r3", "x1", "b1", "s1"], "past the gate the flight's sessions are done with whatever they are doing; the flight first, then the builders");
  const building = new Map([...agents, ["b1", { state: "running", pid: 13 }], ["s1", { state: "running", pid: 17 }]]);
  assert.deepEqual(await endFinished({ ...flying, status: "review" } as Mission, building, stop), ["w1", "w2", "w3", "r3", "x1"], "a builder or the summarizer still running at the gate is what the gate is for, and is left alone");
  const gone = new Map([...agents].map(([id, a]) => [id, { state: a.state }]));
  assert.deepEqual(await endFinished(flying, gone, stop), [], "once the listing drops the pid there is nothing to stop: the listing is the memory");
  assert.deepEqual(await endFinished({ ...flying, summary: { claudeId: "s9", started: "s" } } as Mission, agents, stop), ["w1", "w2", "x1", "b1"], "an id the listing does not know is not stopped");
});

test("settle is the one derivation of a mission's status: paused is the person's word, review is all merged and unheld, blocked is a person needed", () => {
  const t = (id: string, status: MissionTask["status"]) => ({ id, title: id, intent: "i", repo: "root", status, attempts: 1 });
  const base = { id: "x", project: "p", name: "X", brief: "b", created: "x", plan: "p.md", trackerIndex: 0, land: "merge", repos: [], status: "flying" } as unknown as Mission;
  const flying = settle({ ...base, milestones: [{ n: 1, title: "a", done: "d", dispatched: "x", tasks: [t("m1-t1", "flying")] }] });
  assert.deepEqual([flying.status, flying.trouble], ["flying", undefined]);
  const blocked = settle({ ...base, milestones: [{ n: 1, title: "a", done: "d", dispatched: "x", tasks: [{ ...t("m1-t1", "handed-back"), note: "yours" }] }] }, ["m1-t2 is waiting on you"]);
  assert.deepEqual([blocked.status, blocked.trouble], ["blocked", "m1-t1: yours · m1-t2 is waiting on you"]);
  const paused = settle({ ...base, pausedFor: "token expired", milestones: [{ n: 1, title: "a", done: "d", dispatched: "x", tasks: [{ ...t("m1-t1", "handed-back"), note: "yours" }] }] });
  assert.deepEqual([paused.status, paused.trouble], ["paused", "paused: token expired · m1-t1: yours"]);
  const review = settle({ ...base, milestones: [{ n: 1, title: "a", done: "d", dispatched: "x", merged: "x", tasks: [t("m1-t1", "passed")] }] });
  assert.equal(review.status, "review");
  const heldMerged = settle({ ...base, milestones: [{ n: 1, title: "a", done: "d", dispatched: "x", merged: "x", hold: { kind: "proof", reason: "the proof failed", at: "x" }, tasks: [t("m1-t1", "passed")] }] });
  assert.deepEqual([heldMerged.status, heldMerged.trouble], ["blocked", "the proof failed"], "merged but held is not review");
  const closed = settle({ ...base, status: "closed", milestones: [] } as Mission);
  assert.equal(closed.status, "closed", "an ended mission is not re-derived");
});

test("a merged milestone the project has not proved yet is not done: nothing builds on it, follows it, or counts it for review", () => {
  const t = (id: string, status: MissionTask["status"], needs?: string[]) => ({ id, title: id, intent: "i", repo: "root", status, attempts: 1, ...(needs ? { needs } : {}) });
  const merged = { n: 1, title: "a", done: "d", dispatched: "x", merged: "x", tasks: [t("m1-t1", "passed")] };
  const later = { n: 2, title: "b", done: "d", tasks: [t("m2-t1", "pending", ["m1-t1"])] };
  assert.deepEqual(startable({ status: "flying", proofRequired: true, milestones: [merged, later] }), [], "the proof is still running");
  assert.deepEqual(startable({ status: "flying", proofRequired: true, milestones: [{ ...merged, proof: { ok: true, at: "x", output: "" } }, later] }).map((s) => s.task.id), ["m2-t1"]);
  assert.deepEqual(startable({ status: "flying", proofRequired: false, milestones: [merged, later] }).map((s) => s.task.id), ["m2-t1"], "a project without a proof is done at the merge");
  const second = { n: 2, title: "b", done: "d", dispatched: "x", tasks: [t("m2-t1", "passed")] };
  assert.equal(mergeable({ proofRequired: true, milestones: [merged, second] }, second), false, "the one before it is not proved");
  assert.equal(mergeable({ proofRequired: true, milestones: [{ ...merged, proof: { ok: true, at: "x", output: "" } }, second] }, second), true);
  // Two pending tasks that would clash with each other: one goes, the other waits.
  const a = { ...t("m1-t2", "pending"), touches: ["src/a/"] };
  const b = { ...t("m1-t3", "pending"), touches: ["SRC/A/b.ts"] };
  assert.deepEqual(startable({ status: "flying", milestones: [{ n: 1, title: "a", done: "d", dispatched: "x", tasks: [a, b] }] }).map((s) => s.task.id), ["m1-t2"]);
});

/* ---------- the view, and the reply ---------- */

// Records are read through `config.sessionsDir` at call time, so pointing it at a temp dir here
// keeps these tests off the real console's missions.
const made: string[] = [];
const sessions = mkdtempSync(join(tmpdir(), "mv-m1-t3-sessions-"));
made.push(sessions);
config.sessionsDir = sessions;
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** A project repo, its integration worktree on the mission branch holding the FLOWN ledger, and a record for it. */
const viewFixture = (id: string, patch: Partial<Mission> = {}) => {
  const root = tempRepo("mv-m1-t3-root");
  const integration = tempRepo("mv-m1-t3-integration", `mission/${id}`);
  made.push(root.dir, integration.dir);
  writeFileSync(join(integration.dir, "plan.md"), FLOWN, "utf8");
  integration.git("add", "plan.md");
  integration.git("commit", "-q", "-m", "the plan");
  const project = { id: "p-m1-t3", name: "P", path: root.dir, trackers: [] } as never;
  const mission = {
    id, project: "p-m1-t3", name: id, brief: "b", status: "flying", created: "2026-10-09T07:00:00Z",
    approved: "2026-10-09T07:30:00Z", plan: "plan.md", trackerIndex: 0, land: "merge", rev: 1,
    repos: [{ label: "root", path: root.dir, base: "main", branch: `mission/${id}`, integration: integration.dir, land: "merge" }],
    milestones: [{ n: 1, title: "the first", done: "both tasks pass", dispatched: "2026-10-09T07:30:00Z", tasks: [
      { id: "m1-t1", title: "Already passed", intent: "Build the first thing.", repo: "root", status: "passed", attempts: 1, verdict: "pass" },
      { id: "m1-t2", title: "In review now", intent: "Build the second thing.", repo: "root", status: "handed-back", attempts: 2, verdict: "mixed", note: "the RIO said mixed after 2 attempts" }] }],
    ...patch,
  };
  mkdirSync(join(sessions, "missions", "p-m1-t3"), { recursive: true });
  writeFileSync(join(sessions, "missions", "p-m1-t3", `${id}.json`), JSON.stringify(mission), "utf8");
  return { project, ledger: join(integration.dir, "plan.md"), integration };
};

test("missionView carries the word, the questions and the feed read from the ledger", async () => {
  const { project } = viewFixture("view");
  const view = await missionView(project, "view");
  assert.equal(view.word, "waiting for you");
  assert.deepEqual(view.questions.map((q) => [q.kind, q.taskId]), [["handed-back", "m1-t2"]]);
  assert.equal(view.feed.length, 2, "one entry per line of the ledger's log");
  assert.deepEqual(view.feed.map((e) => [e.at, e.taskId, e.who]), [["2026-10-09T08:00", "m1-t1", "Maverick"], ["2026-10-09T09:00", "m1-t1", "RIO"]]);
  assert.match(view.feed[1].text, /reviewing to passed/);
});

test("missionView carries one move per attempt: a task over two attempts is two moves with their stamps, the first a retry", async () => {
  const { project, ledger } = viewFixture("moves");
  writeFileSync(ledger, FLOWN.replace(/## Log\n[\s\S]*$/, `## Log

- 2026-10-09 08:00 m1-t1 Already passed: pending to flying
- 2026-10-09 08:05 m1-t2 In review now: pending to flying
- 2026-10-09 08:20 m1-t2 In review now: flying to built
- 2026-10-09 08:21 m1-t2 In review now: built to reviewing
- 2026-10-09 08:30 m1-t2 In review now: reviewing to flying
- 2026-10-09 08:50 m1-t2 In review now: flying to reviewing
- 2026-10-09 09:00 m1-t1 Already passed: reviewing to passed (RIO: pass)
- 2026-10-09 09:10 m1-t2 In review now: reviewing to handed-back (RIO: mixed): 2 blocker(s) open
`), "utf8");
  const view = await missionView(project, "moves");
  assert.deepEqual(view.moves, [
    { taskId: "m1-t1", attempt: 1, out: "2026-10-09T08:00", ended: "2026-10-09T09:00", end: "passed", verdict: "pass" },
    { taskId: "m1-t2", attempt: 1, out: "2026-10-09T08:05", built: "2026-10-09T08:20", reviewed: "2026-10-09T08:21", ended: "2026-10-09T08:30", end: "retry" },
    { taskId: "m1-t2", attempt: 2, out: "2026-10-09T08:30", built: "2026-10-09T08:50", reviewed: "2026-10-09T08:50", ended: "2026-10-09T09:10", end: "handed-back", verdict: "mixed", counts: { notes: 0, unverified: 0, blockers: 2 } },
  ], "plan order, then attempt order; the sweep that saw flying to reviewing stamps the hand-off and the review alike");
});

test("movesOf: a launch after a hand-back opens a new attempt without calling the last a retry, a pass straight from flying stamps the hand-off, and a person's words are not moves", () => {
  const mission = { milestones: [{ n: 2, tasks: [{ id: "m2-t1", title: "The worker" }] }] } as unknown as Mission;
  const at = (n: number) => `2026-10-14T10:0${n}`;
  const moves = movesOf(feedOf([
    `${at(0)} m2-t1 The worker: pending to flying`,
    `${at(1)} m2-t1 The worker: reviewing to handed-back (RIO: fail): the RIO said fail after 1 attempts with 1 blocker(s) open`,
    `${at(2)} decision: m2-t1 The worker: handed-back to flying`,
    `${at(3)} m2-t1 The worker: handed-back to flying`,
    `${at(4)} m2-t1 The worker: flying to passed (RIO: pass with notes) with 10 notes carried, 1 unverified`,
    `${at(5)} m9-t9 Not in the plan: pending to flying`,
  ], mission), mission);
  assert.deepEqual(moves, [
    { taskId: "m2-t1", attempt: 1, out: at(0), ended: at(1), end: "handed-back", verdict: "fail", counts: { notes: 0, unverified: 0, blockers: 1 } },
    { taskId: "m2-t1", attempt: 2, out: at(3), built: at(4), ended: at(4), end: "passed", verdict: "pass with notes", counts: { notes: 10, unverified: 1, blockers: 0 } },
  ]);
});

test("missionView's word is the word rule's, not the bare status word: a stale escalation on a review mission is done", async () => {
  const { project } = viewFixture("reviewed", { status: "review", escalation: "the plan needs a look", milestones: [{ n: 1, title: "the first", done: "d", dispatched: "2026-10-09T07:30:00Z", merged: "2026-10-09T10:00:00Z", tasks: [
    { id: "m1-t1", title: "Already passed", intent: "Build the first thing.", repo: "root", status: "passed", attempts: 1, verdict: "pass" }] }] as never });
  const view = await missionView(project, "reviewed");
  assert.deepEqual(view.questions, []);
  assert.equal(view.word, "done");
});

test("missionView's feed is empty before approval and when the ledger cannot be read, and never throws", async () => {
  const { project } = viewFixture("unblessed", { approved: undefined, status: "interviewing" });
  assert.deepEqual((await missionView(project, "unblessed")).feed, []);
  const { project: gone } = viewFixture("gone", { repos: [{ label: "root", path: "/nonexistent-m1-t3", base: "main", branch: "mission/gone", integration: "/nonexistent-m1-t3/integration", land: "merge" }] as never });
  assert.deepEqual((await missionView(gone, "gone")).feed, []);
});

test("sayToStrikeLead writes the decision into the ledger and says it sent nothing with no terminal", async () => {
  const { project, ledger, integration } = viewFixture("say");
  assert.deepEqual(await sayToStrikeLead(project, "say", "  hold m2 until the docs land  "), { ok: true, sent: false });
  const log = parsePlan(readFileSync(ledger, "utf8")).log;
  assert.match(log.at(-1)!, /^\S+ \S+ decision: Cory to the Strike Lead: hold m2 until the docs land$/);
  assert.match(integration.git("show", "--format=", "HEAD", "--", "plan.md"), /^\+.*decision: Cory to the Strike Lead: hold m2/m, "committed on the mission branch");
  assert.equal(JSON.parse(readFileSync(join(sessions, "missions", "p-m1-t3", "say.json"), "utf8")).trouble, undefined);
  await assert.rejects(() => sayToStrikeLead(project, "say", "   "), /empty reply/);
});

test("a reply with newlines in it is one decision line: it cannot start a milestone of its own in the ledger", async () => {
  const { project, ledger } = viewFixture("forge");
  await sayToStrikeLead(project, "forge", "hold m2\n## Milestone 9 — injected\n\n- [x] **Forged task**\n  - status: passed");
  const plan = parsePlan(readFileSync(ledger, "utf8"));
  assert.deepEqual(plan.milestones.map((m) => m.n), parsePlan(FLOWN).milestones.map((m) => m.n), "no milestone was added");
  assert.equal(plan.log.at(-1)!.replace(/^\S+ \S+ /, ""), "decision: Cory to the Strike Lead: hold m2 ## Milestone 9 — injected - [x] **Forged task** - status: passed");
});

test("a reply the ledger refuses with no terminal open landed nowhere, and says so rather than ok", async () => {
  const { project } = viewFixture("unwritable", { repos: [{ label: "root", path: "/nonexistent-m1-t3", base: "main", branch: "mission/unwritable", integration: "/nonexistent-m1-t3/integration", land: "merge" }] as never });
  await assert.rejects(() => sayToStrikeLead(project, "unwritable", "hello"), /the reply was not sent: the ledger .*could not be written/);
});

test("a reply typed into an open Strike Lead terminal is the text, then Enter on its own, short or paste-sized", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mv-m1-t3-terminal-"));
  made.push(dir);
  // A raw-mode program that asks for bracketed paste, as Claude Code does, and keeps every byte it is sent.
  writeFileSync(join(dir, "record.py"), [
    "import os, sys, tty",
    "tty.setraw(0)",
    "os.write(1, b'\\x1b[?2004h')",
    "open(sys.argv[2], 'w').close()",
    "with open(sys.argv[1], 'ab', buffering=0) as out:",
    "    while True:",
    "        b = os.read(0, 4096)",
    "        if not b: break",
    "        out.write(b)",
  ].join("\n"), "utf8");
  const got = join(dir, "got");
  const ready = join(dir, "ready");
  const terminal = openTerminal("strike lead m1-t3", ["python3", join(dir, "record.py"), got, ready], dir);
  try {
    const { project } = viewFixture("typed", { interview: { terminalId: terminal.id, started: "2026-10-09T07:00:00Z" } });
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 100 && !done(); i += 1) await new Promise((r) => setTimeout(r, 50));
    };
    await until(() => existsSync(ready));
    await new Promise((r) => setTimeout(r, 300)); // the mode it asked for reaches the console a moment after it is written
    const long = "a longer reply that runs well past the sixty-four bytes a paste starts at";
    assert.deepEqual(await sayToStrikeLead(project, "typed", "short reply"), { ok: true, sent: true });
    assert.deepEqual(await sayToStrikeLead(project, "typed", long), { ok: true, sent: true });
    const want = `short reply\r\x1b[200~${long}\x1b[201~\r`;
    await until(() => existsSync(got) && readFileSync(got, "latin1").length >= want.length);
    assert.equal(readFileSync(got, "latin1"), want);
  } finally {
    closeTerminal(terminal.id);
  }
});

test("before approval with no Strike Lead terminal, a reply has nowhere to go and is refused", async () => {
  const { project, ledger } = viewFixture("nowhere", { approved: undefined, status: "interviewing" });
  await assert.rejects(() => sayToStrikeLead(project, "nowhere", "hello"), /nowhere to say it/);
  assert.equal(readFileSync(ledger, "utf8"), FLOWN, "nothing was written");
});

/* ---------- the readings ---------- */

/** The key as the contract spells it, worked out here rather than through `keyOf`, so a drift in either is caught. */
const keyFor = (taskId: string, raw: string) => `${taskId}:${createHash("sha1").update(raw).digest("hex").slice(0, 8)}`;

const CARRIED = [
  "NOTE(web/signin, ship): focus is lost. The Wingman called it out of scope.",
  "unverified: the migration was not run on a copy.",
  "UNVERIFIED(deploy, check): the stack was not deployed. Only synthesized.",
  "the copy on the empty state reads oddly.",
];

/** The view fixture with a passed task carrying two lines of each shape and a handed-back task whose findings file holds one blocker of each. */
const readingsFixture = (id: string, patch: Partial<Mission> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "mv-m1-t3-findings-"));
  made.push(dir);
  const file = join(dir, "m1-t2.md");
  writeFileSync(file, "verdict: mixed\n\n- BLOCKER: the lock leaks on retry.\n- BLOCKER(src/worker/, fix): the worker never stops. It spins on an empty queue.\n", "utf8");
  return viewFixture(id, { milestones: [{ n: 1, title: "the first", done: "d", dispatched: "2026-10-09T07:30:00Z", tasks: [
    { id: "m1-t1", title: "Already passed", intent: "Build the first thing.", repo: "root", status: "passed", attempts: 1, verdict: "pass with notes", carried: CARRIED },
    { id: "m1-t2", title: "In review now", intent: "Build the second thing.", repo: "root", status: "handed-back", attempts: 2, verdict: "mixed", note: "the RIO said mixed", review: { claudeId: "c-m1-t3", file, started: "2026-10-09T08:00:00Z" } }] }] as never, ...patch });
};

test("missionView's readings are every carried and handed-back finding, keyed by task and line, in triage order grouped by area", async () => {
  const { project } = readingsFixture("readings");
  const view = await missionView(project, "readings");
  assert.deepEqual(view.readings.map((r) => [r.severity, r.area, r.kind, r.taskId, r.headline]), [
    ["fix", "general", "BLOCKER", "m1-t2", "the lock leaks on retry."],
    ["fix", "src/worker", "BLOCKER", "m1-t2", "the worker never stops."],
    ["check", "general", "UNVERIFIED", "m1-t1", "the migration was not run on a copy."],
    ["check", "deploy", "UNVERIFIED", "m1-t1", "the stack was not deployed."],
    ["ship", "web/signin", "NOTE", "m1-t1", "focus is lost."],
    ["ship", "general", "NOTE", "m1-t1", "the copy on the empty state reads oddly."],
  ]);
  assert.deepEqual(view.readings.filter((r) => r.taskId === "m1-t1").map((r) => r.key).sort(), CARRIED.map((line) => keyFor("m1-t1", line)).sort());
  assert.equal(view.readings[0].key, keyFor("m1-t2", "BLOCKER: the lock leaks on retry."), "a blocker the file did not shape is read, and keyed, as one");
  assert.equal(view.readings[1].key, keyFor("m1-t2", "BLOCKER(src/worker/, fix): the worker never stops. It spins on an empty queue."));
  assert.deepEqual(view.readings.map((r) => [r.taskTitle, r.milestone, r.state]).slice(0, 1), [["In review now", 1, undefined]]);
  assert.equal(view.readings[4].detail, "The Wingman called it out of scope.");
});

test("markReading records read, and later also puts one backlog item on the mission's tracker and a decision in the ledger, once", async () => {
  const { project: bare, ledger } = readingsFixture("marked", { trackerIndex: 1 });
  const root = (bare as { path: string }).path;
  const checklist = join(root, "CHECKLIST.md");
  writeFileSync(checklist, "# Checklist\n\n## 🔥 Priority\n\n- [ ] `[ENG]` **Something urgent**\n\n## 📋 Backlog\n\n- [ ] `[ENG]` **An old idea**\n\n## ✅ Shipped\n", "utf8");
  execFileSync("git", ["-C", root, "add", "CHECKLIST.md"]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "the tracker"]);
  // The mission's tracker is the second one, so a write to the first would be caught.
  const project = { ...(bare as object), trackers: [{ label: "ELSEWHERE", path: join(root, "ELSEWHERE.md") }, { label: "CHECKLIST", path: checklist }] } as never;
  const read = keyFor("m1-t1", CARRIED[3]);
  const later = keyFor("m1-t1", CARRIED[0]);

  await assert.rejects(() => markReading(project, "marked", "m1-t1", "m1-t1:00000000", "read"), /no finding "m1-t1:00000000"/);
  await assert.rejects(() => markReading(project, "marked", "m1-t1", read, "soon" as never), /"read" or "later"/);

  const once = await markReading(project, "marked", "m1-t1", read, "read");
  assert.deepEqual(once.milestones[0].tasks[0].readings, { [read]: "read" });
  assert.equal(execFileSync("git", ["-C", root, "log", "-1", "--format=%s"], { encoding: "utf8" }).trim(), "the tracker", "read touches no tracker");

  await markReading(project, "marked", "m1-t1", later, "later");
  await markReading(project, "marked", "m1-t1", later, "later");
  const view = await missionView(project, "marked");
  assert.deepEqual(view.readings.filter((r) => r.state).map((r) => [r.key, r.state]), [[later, "later"], [read, "read"]]);
  const tracker = readFileSync(checklist, "utf8");
  assert.equal(tracker.split("\n").filter((l) => l === `  - finding: ${later}`).length, 1, "a second later writes no second item");
  const backlog = parseTracker(tracker).sections.find((s) => s.heading === "📋 Backlog")!;
  const items = backlog.groups.flatMap((g) => g.items);
  assert.deepEqual(items.map((i) => i.firstLine), ["- [ ] `[ENG]` **An old idea**", "- [ ] `[ENG]` **focus is lost.**"]);
  assert.deepEqual(items[1].fields, { created: today(), source: "mission marked, Already passed", mission: "marked", area: "web/signin", finding: later }, "written the way the mission's own items are, with the finding's key to find it by");
  assert.match(items[1].body, /The Wingman called it out of scope\./, "the detail rides under the headline");
  assert.equal(existsSync(join(root, "ELSEWHERE.md")), false, "the first tracker is not the mission's");
  assert.match(execFileSync("git", ["-C", root, "log", "-1", "--format=%s"], { encoding: "utf8" }), /^console: later from mission "marked": focus is lost\./);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }), "", "committed, nothing left loose");
  const decisions = parsePlan(readFileSync(ledger, "utf8")).log.filter((l) => / decision: /.test(l));
  assert.deepEqual(decisions.map((l) => l.replace(/^\S+ \S+ /, "")), ['decision: m1-t1 finding "focus is lost." marked later by Cory']);
});

/* ---------- the summarizer ---------- */

test("summaryState is the one word the page and the sweep share: unmerged, none, running, failed, written", () => {
  const on = (summary: Mission["summary"], merged = true): Mission => ({ milestones: [{ merged: merged ? "2026-10-14T09:00:00Z" : undefined }], summary }) as unknown as Mission;
  assert.equal(summaryState(on(undefined, false)), "unmerged");
  assert.equal(summaryState(on(undefined)), "none");
  assert.equal(summaryState(on({ started: "s" })), "running");
  assert.equal(summaryState(on({ started: "s", claudeId: "c", failed: "it died" })), "failed");
  assert.equal(summaryState(on({ at: "a", text: "- one" })), "written");
});

/**
 * A `claude` of the test's own, first on PATH: `agents` prints what the test put in agents.json,
 * anything else is a spawn, which records its working directory and arguments and prints the
 * line `spawnBackgroundAgent` reads the id from, or fails while a `fail` file exists.
 */
const fakeClaude = mkdtempSync(join(tmpdir(), "mv-m3-t1-claude-"));
made.push(fakeClaude);
writeFileSync(join(fakeClaude, "claude"), `#!/bin/sh
if [ "$1" = agents ]; then cat "${fakeClaude}/agents.json"; exit 0; fi
if [ -e "${fakeClaude}/fail" ]; then echo "no credits" >&2; exit 1; fi
pwd > "${fakeClaude}/cwd"
printf '%s\\0' "$@" > "${fakeClaude}/args"
echo "backgrounded · 5eed1"
`, "utf8");
chmodSync(join(fakeClaude, "claude"), 0o755);
const agentsSay = (list: Array<{ id: string; state: string }>) => writeFileSync(join(fakeClaude, "agents.json"), JSON.stringify(list.map((a) => ({ ...a, kind: "background" }))), "utf8");
const spawnedWith = () => readFileSync(join(fakeClaude, "args"), "utf8").split("\0").slice(0, -1);
const realPath = process.env.PATH;
process.env.PATH = `${fakeClaude}:${realPath}`;
after(() => { process.env.PATH = realPath; });

/** A mission on its own project, so a sweep here never reaches the other tests' flying records. Milestone 1 merged unless told otherwise. */
const summaryFixture = (id: string, patch: Partial<Mission> = {}) => {
  const root = tempRepo("mv-m3-t1-root");
  made.push(root.dir);
  const project = { id: "p-m3-t1", name: "P", path: root.dir, trackers: [] } as never;
  const mission = {
    id, project: "p-m3-t1", name: id, brief: "b", status: "review", created: "2026-10-14T07:00:00Z",
    approved: "2026-10-14T07:30:00Z", plan: "plan.md", trackerIndex: 0, land: "merge", rev: 1,
    repos: [{ label: "root", path: root.dir, base: "main", branch: `mission/${id}`, integration: root.dir, land: "merge" }],
    milestones: [{ n: 1, title: "the first", done: "d", dispatched: "2026-10-14T07:30:00Z", merged: "2026-10-14T09:00:00Z", tasks: [
      { id: "m1-t1", title: "The worker", intent: "Build the worker.", repo: "root", status: "passed", attempts: 1, verdict: "pass with notes", carried: ["NOTE(src/worker, ship): the worker logs every poll. Noisy, not wrong."] }] }],
    ...patch,
  };
  mkdirSync(join(sessions, "missions", "p-m3-t1"), { recursive: true });
  writeFileSync(join(sessions, "missions", "p-m3-t1", `${id}.json`), JSON.stringify(mission), "utf8");
  return { project, root: root.dir, file: join(sessions, "missions", "p-m3-t1", `${id}-summary.md`) };
};
const recordOf = (id: string): Mission => JSON.parse(readFileSync(join(sessions, "missions", "p-m3-t1", `${id}.json`), "utf8")) as Mission;

test("summarizeMission refuses a mission that has merged nothing, and touches no record or agent", async () => {
  rmSync(join(fakeClaude, "args"), { force: true });
  const { project } = summaryFixture("unmerged", { status: "planned", milestones: [{ n: 1, title: "the first", done: "d", dispatched: "2026-10-14T07:30:00Z", tasks: [{ id: "m1-t1", title: "t", intent: "i", repo: "root", status: "passed", attempts: 1 }] }] as never });
  await assert.rejects(() => summarizeMission(project, "unmerged"), /has merged nothing yet/);
  assert.equal(recordOf("unmerged").summary, undefined);
  assert.equal(existsSync(join(fakeClaude, "args")), false, "nothing was spawned");
});

test("summarizeMission spawns one read-only rio in the project, records it, and refuses a second while it runs", async () => {
  const { project, root, file } = summaryFixture("asked");
  writeFileSync(file, "- a summary from an earlier run\n", "utf8");
  const mission = await summarizeMission(project, "asked");
  const id = mission.summary?.claudeId;
  assert.equal(id, "5eed1");
  assert.ok(mission.summary?.started && !mission.summary.at && !mission.summary.failed);
  assert.deepEqual(recordOf("asked").summary, mission.summary, "the record on disk carries the claim and the id");
  assert.equal(existsSync(file), false, "an earlier summary's file is gone, so it cannot be read as this one's");
  assert.equal(readFileSync(join(fakeClaude, "cwd"), "utf8").trim(), root, "spawned in the project path");
  const args = spawnedWith();
  assert.equal(args[args.indexOf("--agent") + 1], "rio");
  assert.equal(args[args.indexOf("--tools") + 1], "Bash,Read,Grep,Glob");
  const brief = args.at(-1)!;
  assert.ok(brief.includes(`Write the three bullets to ${file}`), "the brief names the file");
  assert.match(brief, /exactly three markdown bullets/);
  assert.match(brief, /ship · src\/worker · NOTE · m1-t1 The worker: the worker logs every poll\. Noisy, not wrong\./, "the brief carries the findings");
  assert.match(brief, /# Mission report: asked/, "the brief carries the report");
  await assert.rejects(() => summarizeMission(project, "asked"), /already being summarized/);
  assert.equal(recordOf("asked").summary?.claudeId, id, "the refusal left the running claim alone");
});

// The agent listing is cached per project path for a sweep's lifetime and longer, so each of
// these asks it once, on a fixture of its own.
test("the sweep leaves a summary alone while its session is still working, even with a file half written", async () => {
  const { project, file } = summaryFixture("working");
  const { summary } = await summarizeMission(project, "working");
  agentsSay([{ id: summary!.claudeId!, state: "working" }]);
  writeFileSync(file, "- Fix the sign-in page first.\n", "utf8");
  await sweepMissions(project);
  assert.deepEqual(recordOf("working").summary, summary);
});

test("the sweep reads the summary once its session has ended, and the view carries it", async () => {
  const { project, file } = summaryFixture("landed");
  const { summary } = await summarizeMission(project, "landed");
  const bullets = "- Fix the sign-in page: it loses focus.\n- Nobody checked the deploy.\n- The worker is safe to merge.\n";
  writeFileSync(file, bullets, "utf8");
  agentsSay([{ id: summary!.claudeId!, state: "done" }]);
  await sweepMissions(project);
  const landed = recordOf("landed").summary!;
  assert.deepEqual(Object.keys(landed).sort(), ["at", "raw", "text"]);
  assert.equal(landed.text, bullets.trim());
  assert.equal(landed.raw, bullets.trim());
  assert.ok(!Number.isNaN(Date.parse(landed.at!)));
  const view = await missionView(project, "landed");
  assert.deepEqual(view.summary, landed);
  assert.equal(view.summaryState, "written", "the view says where the summary stands, so the page does not work it out again");
  const again = await summarizeMission(project, "landed");
  assert.ok(again.summary?.started && !again.summary.at, "a landed summary can be asked for again");
});

test("a summary file with five bullets lands as three, and the record keeps all five as raw", async () => {
  const { project, file } = summaryFixture("five");
  const { summary } = await summarizeMission(project, "five");
  const five = "# Summary\n\n- Fix the sign-in page.\n- Nobody checked the deploy.\n- The worker is safe.\n- The docs are thin.\n- The tests are slow.\n";
  writeFileSync(file, five, "utf8");
  agentsSay([{ id: summary!.claudeId!, state: "done" }]);
  await sweepMissions(project);
  const landed = recordOf("five").summary!;
  assert.equal(landed.text, "- Fix the sign-in page.\n- Nobody checked the deploy.\n- The worker is safe.");
  assert.equal(landed.raw, five.trim());
});

test("a summary file with nothing to make a bullet of keeps the session's words as its text, never an empty summary", async () => {
  const { project, file } = summaryFixture("headed");
  const { summary } = await summarizeMission(project, "headed");
  writeFileSync(file, "Summary\n=======\n", "utf8");
  agentsSay([{ id: summary!.claudeId!, state: "done" }]);
  await sweepMissions(project);
  const landed = recordOf("headed").summary!;
  assert.equal(landed.text, "Summary\n=======");
  assert.equal(landed.raw, landed.text);
});

test("a summarizer that ends without its file is a failed summary with the reason, and the button is live again", async () => {
  const { project, file } = summaryFixture("silent");
  const { summary } = await summarizeMission(project, "silent");
  agentsSay([{ id: summary!.claudeId!, state: "exited" }]);
  await sweepMissions(project);
  const failed = recordOf("silent").summary!;
  assert.equal(failed.failed, `the session finished without writing ${file}`);
  assert.equal(failed.at, undefined);
  assert.equal((await missionView(project, "silent")).summary?.failed, failed.failed);
  assert.ok((await summarizeMission(project, "silent")).summary?.claudeId, "a failed summary does not block the next");
});

test("the sweep settles a summary on a mission still in the air, in the same pass as its walkthroughs", async () => {
  const { project, file } = summaryFixture("paused", { status: "paused", pausedFor: "lunch" });
  const { summary } = await summarizeMission(project, "paused");
  writeFileSync(file, "- one\n- two\n- three\n", "utf8");
  agentsSay([{ id: summary!.claudeId!, state: "done" }]);
  await sweepMissions(project);
  assert.equal(recordOf("paused").summary?.text, "- one\n- two\n- three");
});

test("a summarizer that cannot be spawned says why on the record and leaves the button live", async () => {
  const { project } = summaryFixture("unspawned");
  writeFileSync(join(fakeClaude, "fail"), "", "utf8");
  try {
    const mission = await summarizeMission(project, "unspawned");
    assert.match(mission.summary?.failed ?? "", /^could not start the summarizer: .*no credits/s);
    assert.equal(recordOf("unspawned").summary?.failed, mission.summary?.failed);
  } finally {
    rmSync(join(fakeClaude, "fail"), { force: true });
  }
  assert.ok((await summarizeMission(project, "unspawned")).summary?.claudeId);
});
