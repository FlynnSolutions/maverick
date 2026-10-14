/** The feed: the ledger's lines, in the shapes `transitions` and `recorded` write them, read back as typed entries. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { feedOf } from "../src/feed.ts";
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
  assert.deepEqual(one("2026-10-09 09:00 auto: m1-t2 The worker: reviewing to passed (RIO: mixed): the RIO said mixed after 2 attempts with no blocker open; merged with 1 note(s) carried [carried: a stray log line]"), {
    at: "2026-10-09T09:00", kind: "response", who: "RIO", text: "m1-t2 The worker: reviewing to passed (RIO: mixed): the RIO said mixed after 2 attempts with no blocker open; merged with 1 note(s) carried [carried: a stray log line]", milestone: 1, taskId: "m1-t2",
  });
  assert.deepEqual(one("2026-10-09 09:55 held: milestone 2 (since x): could not land: svc"), { at: "2026-10-09T09:55", kind: "question", who: "Maverick", text: "milestone 2 (since x): could not land: svc", milestone: 2 });
  assert.deepEqual(one("2026-10-09 10:00 decision: resumed by Cory"), { at: "2026-10-09T10:00", kind: "response", who: "you", text: "resumed by Cory" });
  assert.equal(one("2026-10-09T10:00:00.000Z m1-t1 Parse the plan document: reviewing to passed (RIO: pass)").at, "2026-10-09T10:00:00.000Z", "an ISO stamp is kept as it is");
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
