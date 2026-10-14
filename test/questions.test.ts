/**
 * The questions a mission asks and its one word, read from records built by hand: every kind of
 * question, the order they come in, one primary answer each, and all four words.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Milestone, Mission, MissionTask } from "../src/missions.ts";
import { questionsOf, statusWord, type Question } from "../src/questions.ts";

const t = (id: string, status: MissionTask["status"], extra: Partial<MissionTask> = {}): MissionTask => ({ id, title: `title ${id}`, intent: "i", repo: "root", status, attempts: 2, ...extra });
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

test("a held milestone asks to be released, with the hold's kind; a landing hold also offers landing again, as its primary", () => {
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
    { label: "release", method: "POST", path: "milestones/3/release", body: ["note"] },
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

test("on a paused mission, retry and land give way to resume, which the server asks for first", () => {
  const mission = base({
    status: "paused",
    milestones: [ms(1, [t("a", "handed-back")]), ms(2, [], { hold: { kind: "landing", reason: "r", at: "2026-10-02T00:00:00.000Z" } })],
  });
  const qs = questionsOf(mission);
  assert.deepEqual(qs.find((q) => q.id === "task:a")!.answers, [
    { label: "resume", method: "POST", path: "resume", primary: true },
    { label: "accept it over the RIO", method: "POST", path: "tasks/a/accept", body: ["note"] },
  ]);
  assert.deepEqual(qs.find((q) => q.id === "hold:2")!.answers, [
    { label: "release", method: "POST", path: "milestones/2/release", body: ["note"] },
    { label: "resume", method: "POST", path: "resume", primary: true },
  ]);
  for (const q of qs) assert.ok(!q.answers.some((a) => a.path === "land" || a.path.endsWith("/retry")), q.id);
});

test("questions come oldest first, every one has exactly one primary answer and a unique id", () => {
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
  for (const q of qs) assert.equal(primaries(q).length, 1, q.id);
  assert.equal(new Set(qs.map((q) => q.id)).size, qs.length);
});

test("an ended mission asks nothing, because every action on it is refused", () => {
  const milestones = [ms(1, [t("a", "handed-back", { note: "stopped when the mission was abandoned" })])];
  assert.deepEqual(questionsOf(base({ status: "abandoned", milestones })), []);
  assert.deepEqual(questionsOf(base({ status: "closed", milestones })), []);
});

test("statusWord: done, waiting for you, error and working", () => {
  assert.equal(statusWord(base({ status: "closed" })), "done");
  assert.equal(statusWord(base({ status: "review", milestones: [ms(1, [t("a", "passed")], { merged: "m" })] })), "done");
  assert.equal(statusWord(base({ status: "flying", milestones: [ms(1, [t("a", "flying")])] })), "working");
  assert.equal(statusWord(base({ status: "interviewing" })), "working");

  assert.equal(statusWord(base({ status: "review", escalation: "e" })), "waiting for you");
  assert.equal(statusWord(base({ status: "blocked", milestones: [ms(1, [t("a", "handed-back")])] })), "waiting for you");
  assert.equal(statusWord(base({ status: "blocked", milestones: [ms(1, [], { hold: { kind: "collision", reason: "r", at: "a" } })] })), "waiting for you");
  assert.equal(statusWord(base({ status: "flying", escalation: "e" })), "waiting for you");
  assert.equal(statusWord(base({ status: "blocked", trouble: "title a is waiting on you in its own session" })), "waiting for you");
  assert.equal(statusWord(base({ status: "paused", pausedFor: "" })), "waiting for you");
  assert.equal(statusWord(base({ status: "planned" })), "waiting for you");

  assert.equal(statusWord(base({ status: "closed", trouble: "the report could not be written: EACCES" })), "error");
  assert.equal(statusWord(base({ status: "flying", trouble: "the ledger at deliverables/x.md could not be written: ENOSPC" })), "error");
  assert.equal(statusWord(base({ status: "blocked", trouble: "the proof failed after milestone 2 merged: running tests | (killed by SIGKILL)" })), "error");
  // A proof that failed on its own is a question, not an error: release it or fix it.
  assert.equal(statusWord(base({ status: "blocked", trouble: "the proof failed after milestone 2 merged: 1 failing" })), "waiting for you");
});
