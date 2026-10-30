/**
 * The questions a mission asks and its one word, read from records built by hand: every kind of
 * question, the order they come in, one primary answer each, and all four words.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Milestone, Mission, MissionTask } from "../src/missions.ts";
import { questionsOf, statusWord, type Question } from "../src/questions.ts";

const t = (id: string, status: MissionTask["status"], extra: Partial<MissionTask> = {}): MissionTask => ({ id, title: `title ${id}`, intent: "i", repo: "root", status, attempts: 2, claudeId: "w", ...extra });
const ms = (n: number, tasks: MissionTask[], extra: Partial<Milestone> = {}): Milestone => ({ n, title: `m${n}`, done: "d", tasks, ...extra });
const base = (extra: Partial<Mission> = {}): Mission =>
  ({ id: "x", project: "p", name: "X", brief: "the brief", created: "2026-10-01T00:00:00.000Z", plan: "p.md", trackerIndex: 0, land: "merge", repos: [], status: "flying", milestones: [], ...extra }) as unknown as Mission;

const primaries = (q: Question) => q.answers.filter((a) => a.primary);

test("a handed-back task asks retry or accept, and quotes the first blocker when the view carries findings", () => {
  const task = t("m1-t1", "handed-back", { verdict: "fail", note: "the RIO failed it", review: { claudeId: "c", file: "f", started: "2026-10-02T00:00:00.000Z" } });
  const mission = { ...base({ status: "blocked", milestones: [ms(1, [task])] }), findings: { "m1-t1": "verdict: fail\n- NOTE: a nit\n- BLOCKER: the test cannot fail\n- BLOCKER: second" } };
  const [q] = questionsOf(mission);
  assert.equal(q.kind, "handed-back");
  assert.equal(q.taskId, "m1-t1");
  assert.equal(q.milestone, 1);
  assert.equal(q.at, "2026-10-02T00:00:00.000Z");
  assert.equal(q.body, "title m1-t1, attempt 2, the RIO said fail: the test cannot fail");
  assert.deepEqual(q.answers, [
    { label: "send it out again", method: "POST", path: "tasks/m1-t1/retry", primary: true },
    { label: "accept it over the RIO", method: "POST", path: "tasks/m1-t1/accept", body: ["note"] },
  ]);
  // Without findings the task's own note is the reason.
  assert.match(questionsOf(base({ milestones: [ms(1, [task])] }))[0].body, /: the RIO failed it$/);
});

test("a held milestone asks to be released, with the hold's kind; a landing hold offers landing again instead, which is all the server takes", () => {
  const hold = (kind: "collision" | "landing" | "proof", at: string) => ({ kind, reason: `${kind} reason`, at });
  const mission = base({ status: "blocked", milestones: [ms(1, [], { hold: hold("collision", "2026-10-03T00:00:00.000Z") }), ms(2, [], { hold: hold("proof", "2026-10-04T00:00:00.000Z") }), ms(3, [], { hold: hold("landing", "2026-10-05T00:00:00.000Z") })] });
  const qs = questionsOf(mission);
  assert.deepEqual(qs.map((q) => [q.kind, q.milestone, q.body, q.at]), [
    ["collision", 1, "collision reason", "2026-10-03T00:00:00.000Z"],
    ["proof", 2, "proof reason", "2026-10-04T00:00:00.000Z"],
    ["landing", 3, "landing reason", "2026-10-05T00:00:00.000Z"],
  ]);
  assert.deepEqual(qs[0].answers, [{ label: "release", method: "POST", path: "milestones/1/release", body: ["note"], primary: true }]);
  assert.deepEqual(qs[2].answers, [
    { label: "try landing again", method: "POST", path: "land", primary: true },
  ]);
});

test("an escalation, a pause and the gate each ask their own question", () => {
  const [plan] = questionsOf(base({ escalation: "the plan collides" }));
  assert.equal(plan.kind, "plan");
  assert.equal(plan.body, "the plan collides");
  assert.deepEqual(plan.answers, [{ label: "pause", method: "POST", path: "pause", body: ["note"], primary: true }]);
  const [paused] = questionsOf(base({ status: "paused", pausedFor: "credential expired" }));
  assert.equal(paused.kind, "paused");
  assert.equal(paused.body, "credential expired");
  assert.deepEqual(paused.answers, [{ label: "resume", method: "POST", path: "resume", primary: true }]);
  const [gate] = questionsOf(base({ status: "planned" }));
  assert.equal(gate.kind, "gate");
  assert.deepEqual(gate.answers, [{ label: "approve", method: "POST", path: "approve", primary: true }]);
});

test("an escalation offers only what the server takes in the mission's state", () => {
  const answers = (status: Mission["status"]) => questionsOf(base({ status, escalation: "collides" })).find((q) => q.kind === "plan")?.answers;
  assert.deepEqual(answers("blocked"), [{ label: "pause", method: "POST", path: "pause", body: ["note"], primary: true }]);
  assert.deepEqual(answers("paused"), [{ label: "resume", method: "POST", path: "resume", primary: true }]);
  // Never cleared, so it rides into review, where neither pause nor resume is taken.
  assert.equal(answers("review"), undefined);
  assert.equal(answers("interviewing"), undefined);
});

test("only what the server takes is offered: a landing hold lands again, never releases; while paused, retry and land are gone and resume is the paused question's alone", () => {
  const milestones = [ms(1, [t("a", "handed-back")]), ms(2, [], { hold: { kind: "landing", reason: "r", at: "2026-10-02T00:00:00.000Z" } })];
  const flying = questionsOf(base({ status: "blocked", milestones }));
  assert.deepEqual(flying.find((q) => q.id === "hold:2")!.answers, [{ label: "try landing again", method: "POST", path: "land", primary: true }]);
  const qs = questionsOf(base({ status: "paused", milestones }));
  assert.deepEqual(qs.find((q) => q.id === "task:a")!.answers, [{ label: "accept it over the RIO", method: "POST", path: "tasks/a/accept", body: ["note"], primary: true }]);
  assert.deepEqual(qs.find((q) => q.id === "hold:2")!.answers, []);
  assert.equal(qs.filter((q) => q.answers.some((a) => a.path === "resume")).length, 1, "resume is offered once, by the paused question");
  for (const q of qs) assert.ok(!q.answers.some((a) => a.path === "land" || a.path.endsWith("/retry")), q.id);
});

test("questions come oldest first, every one has at most one primary answer, first, and a unique id", () => {
  const mission = base({
    status: "paused",
    pausedFor: "lunch",
    escalation: "collides",
    created: "2026-10-01T00:00:00.000Z",
    milestones: [
      ms(1, [t("a", "handed-back", { review: { claudeId: "c", file: "f", started: "2026-10-09T00:00:00.000Z" } }), t("b", "passed")], { hold: { kind: "proof", reason: "r", at: "2026-10-07T00:00:00.000Z" } }),
      ms(2, [t("c", "handed-back", { ended: "2026-10-02T00:00:00.000Z" })]),
    ],
  });
  const qs = questionsOf(mission);
  assert.deepEqual(qs.map((q) => q.id), ["escalation", "paused", "task:c", "hold:1", "task:a"]);
  assert.deepEqual(qs.map((q) => q.at), [...qs.map((q) => q.at)].sort());
  for (const q of qs) {
    assert.ok(primaries(q).length <= 1, q.id);
    if (q.answers.length) assert.ok(q.answers[0].primary, `${q.id}: the primary comes first`);
  }
  assert.equal(new Set(qs.map((q) => q.id)).size, qs.length);
});

test("a mission at review asks for each walkthrough still to walk, how far through it is, then the close", () => {
  const walked = (total: number, verdicts: string[]) => ({ doc: "d.html", progress: { total, answered: verdicts.length, verdicts: Object.fromEntries(verdicts.map((v, i) => [`c${i}`, v])), updatedAt: "a" } });
  const built = t("a", "passed", { commits: ["c"] });
  const at = (h: number) => `2026-10-04T0${h}:00:00.000Z`;
  const mission = base({ status: "review", finished: "2026-10-05T00:00:00.000Z", milestones: [
    ms(1, [built], { merged: at(1), walkthrough: { ...walked(5, []), waived: { note: "n", at: "a" } } }),
    ms(2, [t("b", "passed")], { merged: at(2) }),
    ms(3, [built], { merged: at(3), walkthrough: walked(14, ["fail"]) }),
    ms(4, [built], { merged: at(4), walkthrough: walked(5, []) }),
    ms(5, [built], { merged: at(5), walkthrough: { claudeId: "c" } }),
  ] });
  const [q] = questionsOf(mission);
  assert.equal(q.kind, "walk");
  assert.equal(q.id, "walk:5", "named for the latest milestone in it, so a newly merged one asks again");
  assert.equal(q.at, at(3), "as old as the oldest walk it asks for");
  assert.equal(q.title, "ready to review: walk 3 milestones, then close");
  assert.equal(q.body, "milestone 3, m3: 1 of 14 answered, 1 failed. milestone 4, m4: 0 of 5 answered. milestone 5, m5: its walkthrough is still being written. Then close the mission.");
  assert.deepEqual(q.answers, [
    { label: "walk milestone 3", go: "milestone-3", primary: true },
    { label: "walk milestone 4", go: "milestone-4" },
    { label: "walk milestone 5", go: "milestone-5" },
  ]);
  assert.equal(statusWord(mission), "waiting for you");

  // One walkthrough per mission reads the same: whatever milestones carry one are what is asked.
  const one = base({ status: "review", milestones: [ms(1, [built], { merged: at(1), walkthrough: walked(9, ["pass", "blocked"]) })] });
  assert.equal(questionsOf(one)[0].title, "ready to review: walk milestone 1, then close");
  assert.match(questionsOf(one)[0].body, /^milestone 1, m1: 2 of 9 answered, 1 blocked\./);

  const done = base({ status: "review", milestones: [ms(1, [built], { merged: at(1), walkthrough: walked(2, ["pass", "pass"]) })] });
  const [close] = questionsOf(done);
  assert.deepEqual([close.id, close.kind, close.title], ["review", "review", "ready to close"]);
  assert.deepEqual(close.answers, [{ label: "close", go: "close", primary: true }]);
});

test("a mission in flight asks for the walk of every merged milestone waiting on it, and never the close", () => {
  const built = t("a", "passed", { commits: ["c"] });
  const walking = { doc: "d.html", progress: { total: 6, answered: 2, verdicts: { c0: "pass", c1: "fail" }, updatedAt: "a" } };
  const mission = base({ status: "flying", milestones: [
    ms(1, [built], { merged: "2026-10-04T01:00:00.000Z", walkthrough: walking }),
    ms(2, [t("b", "flying", { commits: ["c"] })]),
  ] });
  const [q] = questionsOf(mission);
  assert.deepEqual([q.id, q.kind, q.title], ["walk:1", "walk", "walk milestone 1"]);
  assert.equal(q.body, "milestone 1, m1: 2 of 6 answered, 1 failed.", "an unmerged milestone with commits is not asked yet");
  assert.deepEqual(q.answers, [{ label: "walk milestone 1", go: "milestone-1", primary: true }]);
  assert.equal(statusWord(mission), "waiting for you", "a mission waiting on a walk is waiting for you, never done");
  assert.deepEqual(questionsOf(base({ status: "flying", milestones: [ms(1, [built])] })), [], "nothing merged, nothing to walk");
  // Paused, the walk still opens: it posts nothing the pause refuses.
  assert.equal(questionsOf({ ...mission, status: "paused" } as Mission).find((x) => x.kind === "walk")?.answers.length, 1);
});

test("a change asked of the Strike Lead after the work was done is said in the review question, not lost in the chat", () => {
  const chat = [
    { at: "2026-10-04T00:00:00.000Z", who: "you" as const, text: "before it finished" },
    { at: "2026-10-06T00:00:00.000Z", who: "you" as const, text: "rename rounds to cuts\nand the rest" },
    { at: "2026-10-06T00:01:00.000Z", who: "Strike Lead" as const, text: "I can't, this seat is read-only" },
  ];
  const [q] = questionsOf(base({ status: "review", finished: "2026-10-05T00:00:00.000Z", chat }));
  assert.match(q.body, /You asked the Strike Lead for a change after the work was done \(last: "rename rounds to cuts"\)\. A mission at review takes no new work/);
  assert.doesNotMatch(questionsOf(base({ status: "review", finished: "2026-10-07T00:00:00.000Z", chat }))[0].body, /Strike Lead/);
});

test("an ended mission asks nothing, because every action on it is refused", () => {
  const milestones = [ms(1, [t("a", "handed-back", { note: "stopped when the mission was abandoned" })])];
  assert.deepEqual(questionsOf(base({ status: "abandoned", milestones })), []);
  assert.deepEqual(questionsOf(base({ status: "closed", milestones })), []);
});

test("statusWord follows the questions: done, waiting for you, error and working", () => {
  assert.equal(statusWord(base({ status: "closed" })), "done");
  assert.equal(statusWord(base({ status: "flying", milestones: [ms(1, [t("a", "flying")])] })), "working");
  assert.equal(statusWord(base({ status: "interviewing" })), "working");

  assert.equal(statusWord(base({ status: "blocked", milestones: [ms(1, [t("a", "handed-back")])] })), "waiting for you");
  assert.equal(statusWord(base({ status: "blocked", milestones: [ms(1, [], { hold: { kind: "collision", reason: "r", at: "a" } })] })), "waiting for you");
  assert.equal(statusWord(base({ status: "flying", escalation: "e" })), "waiting for you");
  assert.equal(statusWord(base({ status: "paused", pausedFor: "" })), "waiting for you");
  assert.equal(statusWord(base({ status: "planned" })), "waiting for you");
  // Nothing open is never waiting, whatever the record carries (Cory's call on m1-t1).
  assert.equal(statusWord(base({ status: "review", escalation: "stale" })), "waiting for you", "a stale escalation on a review mission is history; the review question is what waits");
  assert.deepEqual(questionsOf(base({ status: "review", escalation: "stale" })).map((q) => q.kind), ["review"]);
  assert.equal(statusWord(base({ status: "blocked", trouble: "title a is waiting on you in its own session" })), "working");
  assert.equal(statusWord(base({ status: "flying" }), [{ id: "x" } as never]), "waiting for you", "the questions passed in decide");

  assert.equal(statusWord(base({ status: "closed", trouble: "the report could not be written: EACCES" })), "error");
  assert.equal(statusWord(base({ status: "flying", trouble: "the ledger at deliverables/x.md could not be written: ENOSPC" })), "error");
  assert.equal(statusWord(base({ status: "blocked", trouble: "the proof failed after milestone 2 merged: running tests | (killed by SIGKILL)" })), "error");
  // A proof that failed on its own holds the milestone, which is a question, not an error: release it or fix it.
  assert.equal(statusWord(base({ status: "blocked", trouble: "the proof failed after milestone 2 merged: 1 failing", milestones: [ms(2, [], { merged: "m", hold: { kind: "proof", reason: "1 failing", at: "a" } })] })), "waiting for you");
});

test("a task that never launched says so and offers only to send it out again: there is no work to accept", () => {
  const task = t("m1-t1", "handed-back", { attempts: 0, claudeId: undefined, note: "could not launch: claude --bg did not start in /w: Workspace not trusted.", started: "2026-10-02T00:00:00.000Z" });
  const [q] = questionsOf(base({ milestones: [ms(1, [task])] }));
  assert.equal(q.title, "title m1-t1 never started");
  assert.match(q.body, /Workspace not trusted/);
  assert.deepEqual(q.answers.map((a) => a.path), ["tasks/m1-t1/retry"]);
  assert.equal(primaries(q).length, 1);
  assert.deepEqual(questionsOf(base({ status: "paused", milestones: [ms(1, [task])] })).find((x) => x.kind === "handed-back")!.answers, [], "paused: resume first");
});
