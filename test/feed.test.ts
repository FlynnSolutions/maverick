/** The feed: the ledger's lines, in the shapes `transitions` and `recorded` write them, read back as typed entries. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { feedOf, updatesOf, type FeedEntry } from "../src/feed.ts";
import type { Mission } from "../src/missions.ts";

const mission = {
  id: "x", project: "p", name: "X", brief: "b", status: "flying", created: "2026-10-09T00:00:00Z", plan: "p.md", trackerIndex: 0, land: "merge", repos: [],
  milestones: [
    { n: 1, title: "a", done: "d", tasks: [{ id: "m1-t1", title: "Parse the plan document", intent: "i", repo: "root", status: "passed", attempts: 1 }, { id: "m1-t2", title: "The worker", intent: "i", repo: "root", status: "passed", attempts: 2 }] },
    // A task filed under a milestone its id does not name: the record wins over the id.
    { n: 2, title: "b", done: "d", tasks: [{ id: "m3-t1", title: "Page built by Cory", intent: "i", repo: "root", status: "passed", attempts: 1 }] },
  ],
} as unknown as Mission;

const one = (line: string) => feedOf([line], mission)[0];

test("every kind, from the lines the ledger actually holds", () => {
  const cases: Array<[string, string]> = [
    // held: a milestone waiting on a person, whatever held it.
    ["2026-10-09 09:55 held: milestone 2 (since x): could not land: svc", "question"],
    ["2026-10-09 10:20 held: milestone 1 (since 2026-10-09T10:19:00.000Z): the proof failed after milestone 1 merged: 1 failing | exit 1", "question"],
    // A task handed back to Cory: by the review rule, or because Maverick could not go on.
    ["2026-10-09 10:30 m2-t1 The dashboard: built to handed-back (RIO: fail): the RIO said fail after 2 attempts with 1 blocker(s) open; this one is yours", "question"],
    ["2026-10-09 10:31 m1-t2 The worker: pending to handed-back: could not launch: no such branch", "question"],
    // A pass, an automatic merge with notes, a verdict of pass, and Cory's decisions.
    ["2026-10-09 10:00 m1-t1 Parse the plan document: reviewing to passed (RIO: pass)", "response"],
    ["2026-10-09 09:00 auto: m1-t2 The worker: reviewing to passed (RIO: mixed): the RIO said mixed after 2 attempts with no blocker open; merged with 1 note(s) carried [carried: a stray log line]", "response"],
    ["2026-10-09 09:20 m1-t1 Parse the plan document: reviewing to built (RIO: pass with notes): the RIO said pass with notes", "response"],
    ["2026-10-09 09:30 decision: m2-t1 accepted by Cory over the RIO: fine", "response"],
    ["2026-10-09 11:00 decision: closed by Cory: 3 item(s) ticked, https://example.test/pull/1", "response"],
    // A fail from the RIO before the review rule has settled it.
    ["2026-10-09 09:25 m1-t2 The worker: reviewing to built (RIO: fail): the RIO said fail", "error"],
    // A launch, a retry's spawn, a RIO sent in.
    ["2026-10-09 08:00 m1-t1 Already passed: pending to flying", "action"],
    ["2026-10-09 10:40 m1-t2 The worker: handed-back to flying", "action"],
    ["2026-10-09 09:50 m4-t1 Show when paused by Cory: flying to reviewing", "action"],
    // Anything else.
    ["2026-10-09 07:00 m1-t1 Parse the plan document: new to pending", "thought"],
    ["2026-10-09 09:10 m1-t1 Parse the plan document: flying to built", "thought"],
    ["2026-10-09 09:21 m1-t2 The worker: reviewing to built (RIO: mixed): the RIO said mixed", "thought"],
  ];
  for (const [line, kind] of cases) assert.equal(one(line).kind, kind, line);
});

test("a stamped line in no shape the ledger writes is kept as a thought, never guessed from its words", () => {
  // The ledger types a line by its mark or its transition; anything else is read as written. A new
  // kind gets a mark in `transitions`, not a word list here.
  assert.equal(one("2026-10-09 12:00 milestone 1 collided in root").kind, "thought");
  assert.equal(one("2026-10-09 12:00 milestone 1 merged into root").kind, "thought");
  assert.equal(one("2026-10-09 12:00 swept, nothing to do").kind, "thought");
});

test("who: you for a decision, the RIO for a verdict, the Wingman for a hand-off, else Maverick", () => {
  assert.equal(one("2026-10-09 09:30 decision: m2-t1 accepted by Cory over the RIO: fine").who, "you", "a decision is his even when it names the RIO");
  assert.equal(one("2026-10-09 10:00 decision: resumed by Cory").who, "you");
  assert.equal(one("2026-10-09 10:00 m1-t1 Parse the plan document: reviewing to passed (RIO: pass)").who, "RIO");
  assert.equal(one("2026-10-09 09:00 auto: m1-t2 The worker: reviewing to passed (RIO: mixed): the RIO said mixed after 2 attempts with no blocker open; merged with 1 note(s) carried [carried: a stray log line]").who, "RIO");
  assert.equal(one("2026-10-09 09:10 m1-t1 Parse the plan document: flying to built").who, "Wingman");
  assert.equal(one("2026-10-09 08:00 m1-t1 Already passed: pending to flying").who, "Maverick");
  assert.equal(one("2026-10-09 09:50 m4-t1 Show when paused by Cory: flying to reviewing").who, "Maverick", "a title that says 'by Cory' is not his");
  assert.equal(one("2026-10-09 09:55 held: milestone 2 (since x): could not land: svc").who, "Maverick");
  assert.equal(one("2026-10-09 10:31 m1-t2 The worker: pending to handed-back: could not launch: no such branch").who, "Maverick");
});

test("the stamp and the mark come off the text, and the stamp becomes the time", () => {
  assert.deepEqual(one("2026-10-09 09:00 auto: m1-t2 The worker: reviewing to passed (RIO: mixed) with 1 notes carried: the RIO said mixed after 2 attempts with no blocker open"), {
    at: "2026-10-09T09:00", kind: "response", who: "RIO", text: "m1-t2 The worker: reviewing to passed (RIO: mixed) with 1 notes carried: the RIO said mixed after 2 attempts with no blocker open", milestone: 1, taskId: "m1-t2", move: { taskId: "m1-t2", was: "reviewing", now: "passed", verdict: "mixed" }, counts: { notes: 1, unverified: 0, blockers: 0 },
  });
  assert.deepEqual(one("2026-10-09 09:55 held: milestone 2 (since x): could not land: svc"), { at: "2026-10-09T09:55", kind: "question", who: "Maverick", text: "milestone 2 (since x): could not land: svc", milestone: 2 });
  assert.deepEqual(one("2026-10-09 10:00 decision: resumed by Cory"), { at: "2026-10-09T10:00", kind: "response", who: "you", text: "resumed by Cory" });
  assert.equal(one("2026-10-09T10:00:00.000Z m1-t1 Parse the plan document: reviewing to passed (RIO: pass)").at, "2026-10-09T10:00:00.000Z", "an ISO stamp is kept as it is");
});

test("the move: a transition's task, states and verdict, and none on a person's words however they read", () => {
  assert.deepEqual(one("2026-10-09 08:00 m1-t1 Already passed: pending to flying").move, { taskId: "m1-t1", was: "pending", now: "flying" });
  assert.deepEqual(one("2026-10-09 10:30 m2-t1 The dashboard: built to handed-back (RIO: fail): this one is yours").move, { taskId: "m2-t1", was: "built", now: "handed-back", verdict: "fail" });
  assert.equal("move" in one("2026-10-09 09:30 decision: m2-t1 The worker: handed-back to flying"), false);
  assert.equal("move" in one("2026-10-09 09:55 held: milestone 2 (since x): could not land: svc"), false);
});

test("the milestone and the task: named, else the record's, else the id's", () => {
  assert.equal(one("2026-10-09 10:00 decision: milestone 2 released by Cory: fine").milestone, 2);
  assert.equal(one("2026-10-09 10:00 decision: milestone 2 released by Cory: fine").taskId, undefined);
  assert.equal(one("2026-10-09 09:40 m3-t1 Page built by Cory: reviewing to passed (RIO: pass)").milestone, 2, "the record says where the task lives");
  assert.equal(one("2026-10-09 09:50 m4-t1 Show when paused by Cory: flying to reviewing").milestone, 4, "not in the record, so the id says");
  assert.equal(one("2026-10-09 10:40 decision: m1-t2 sent back out by Cory").taskId, "m1-t2");
  assert.equal(one("2026-10-09 10:40 decision: m1-t2 sent back out by Cory").milestone, 1);
});

test("a line the parser cannot read is kept, raw, as a thought; the order is the ledger's", () => {
  const log = ["2026-10-09 08:00 m1-t1 Already passed: pending to flying", "a line someone typed by hand", "", "2026-10-09 09:00 m1-t1 Already passed: reviewing to passed (RIO: pass)"];
  const feed = feedOf(log, mission);
  assert.equal(feed.length, 4, "nothing dropped");
  assert.deepEqual(feed[1], { at: "", kind: "thought", who: "Maverick", text: "a line someone typed by hand" });
  assert.deepEqual(feed[2], { at: "", kind: "thought", who: "Maverick", text: "" });
  assert.deepEqual(feed.map((e) => e.at), ["2026-10-09T08:00", "", "", "2026-10-09T09:00"]);
  assert.deepEqual(feedOf([], mission), []);
});

test("counts: a pass says how many notes it carried, an old ledger's block is read into them and cut, a hand-back says its blockers", () => {
  const counted = one("2026-10-14 10:00 m1-t1 Parse the plan document: reviewing to passed (RIO: pass with notes) with 10 notes carried, 1 unverified");
  assert.deepEqual(counted.counts, { notes: 10, unverified: 1, blockers: 0 });
  assert.equal(counted.text, "m1-t1 Parse the plan document: reviewing to passed (RIO: pass with notes) with 10 notes carried, 1 unverified", "the new line is kept as written");
  assert.deepEqual(one("2026-10-14 10:00 m1-t1 Parse the plan document: reviewing to passed (RIO: pass with notes) with 2 notes carried").counts, { notes: 2, unverified: 0, blockers: 0 }, "no unverified clause is none unverified");

  const old = one("2026-10-09 09:00 auto: m1-t2 The worker: reviewing to passed (RIO: mixed): the RIO said mixed after 2 attempts with no blocker open; merged with 4 note(s) carried [carried: NOTE(web/signin, ship): focus is lost; unverified: the migration was not run; UNVERIFIED(deploy, check): not deployed; a stray log line]");
  assert.deepEqual(old.counts, { notes: 2, unverified: 2, blockers: 0 }, "an `unverified:` prefix and an `UNVERIFIED(` lead both count as unverified");
  assert.equal(old.text, "m1-t2 The worker: reviewing to passed (RIO: mixed): the RIO said mixed after 2 attempts with no blocker open; merged with 4 note(s) carried", "the notes themselves are off the text");
  assert.equal(old.kind, "response");

  assert.deepEqual(one("2026-10-09 10:30 m2-t1 The dashboard: built to handed-back (RIO: fail): the RIO said fail after 2 attempts with 3 blocker(s) open; this one is yours").counts, { notes: 0, unverified: 0, blockers: 3 });

  for (const line of [
    "2026-10-09 10:00 m1-t1 Parse the plan document: reviewing to passed (RIO: pass)",
    "2026-10-09 10:31 m1-t2 The worker: pending to handed-back: could not launch: no such branch",
    "2026-10-09 08:00 m1-t1 Already passed: pending to flying",
  ]) assert.equal("counts" in one(line), false, `a line that says neither has no counts: ${line}`);

  const said = one("2026-10-09 09:30 decision: m2-t1 accepted by Cory over the RIO: the 2 blocker(s) open are fine [carried: my words, kept]");
  assert.equal(said.text, "m2-t1 accepted by Cory over the RIO: the 2 blocker(s) open are fine [carried: my words, kept]", "a decision is his words, kept whole");
  assert.equal("counts" in said, false);
});

test("counts: an old block's notes hold `; ` themselves, so the record's carried list is counted, and the split only without one", () => {
  const carried = ["the poll runs twice; the second is a no-op. Harmless.", "UNVERIFIED(deploy, check): not deployed; nobody ran it", "focus is lost on close; tab order is fine"];
  const recorded = { ...mission, milestones: [{ ...mission.milestones[0], tasks: [{ ...mission.milestones[0].tasks[0], carried }] }] } as unknown as Mission;
  const line = `2026-10-09 09:00 m1-t1 Parse the plan document: reviewing to passed (RIO: pass with notes) [carried: ${carried.join("; ")}]`;
  const [entry] = feedOf([line], recorded);
  assert.deepEqual(entry.counts, { notes: 2, unverified: 1, blockers: 0 }, "three lines carried, not the six pieces a split on `; ` makes");
  assert.equal(entry.text, "m1-t1 Parse the plan document: reviewing to passed (RIO: pass with notes)", "the block is still cut");
  assert.deepEqual(one(line).counts, { notes: 5, unverified: 1, blockers: 0 }, "no record for the task: the split is all there is");
});

test("Maverick's lines in the chat are the moves worth a text, said plainly, and never a person's own decision", () => {
  const at = "2026-10-27T12:29";
  const mv = (taskId: string, was: string, now: string, verdict?: string): FeedEntry => ({ at, kind: now === "passed" ? "response" : now === "handed-back" ? "question" : "action", who: "Maverick", text: "raw", taskId, move: { taskId, was, now, ...(verdict ? { verdict } : {}) } });
  const mission = { milestones: [{ n: 1, title: "a", done: "d", tasks: [{ id: "m1-t1", title: "The worker", intent: "i", repo: "root", status: "passed" as const, attempts: 1 }] }] };
  const feed: FeedEntry[] = [
    mv("m1-t1", "pending", "flying"),
    mv("m1-t1", "flying", "reviewing"),
    mv("m1-t1", "reviewing", "passed", "pass with notes"),
    mv("m1-t1", "reviewing", "handed-back"),
    mv("m1-t1", "handed-back", "flying"),
    { at, kind: "response", who: "Maverick", text: "milestone 1 (a) is on the mission branch", milestone: 1 },
    { at, kind: "response", who: "you", text: "Cory to the Strike Lead: why?" },
    { at, kind: "thought", who: "Maverick", text: "something the ledger did not type" },
  ];
  assert.deepEqual(updatesOf(feed, mission).map((u) => u.text), [
    "out: m1-t1 The worker",
    "passed (pass with notes): m1-t1 The worker",
    "came back and needs you: m1-t1 The worker",
    "sent back out: m1-t1 The worker",
    "milestone 1 (a) is on the mission branch",
  ]);
});
