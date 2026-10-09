/** The morning report: fixed sections from the record, nothing written by the agent that flew it. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { reportFor } from "../src/report.ts";
import type { Mission } from "../src/missions.ts";

const mission = {
  id: "x", project: "p", name: "X", brief: "b", status: "review", created: "2026-10-09T00:00:00Z", finished: "2026-10-09T10:00:00Z", plan: "p.md", trackerIndex: 0, land: "merge", repos: [],
  milestones: [
    { n: 1, title: "a", done: "d", merged: "x", tasks: [
      { id: "m1-t1", title: "The data module", intent: "i", repo: "root", status: "passed", attempts: 1, verdict: "pass with notes", commits: ["abc one"], carried: ["unverified: the deploy", "tidy the log"] },
      { id: "m1-t2", title: "The worker", intent: "i", repo: "root", status: "passed", attempts: 2, verdict: "mixed", note: "the RIO said mixed after 2 attempts with no blocker open; merged with 1 note(s) carried", carried: ["a stray log line"], strayed: ["src/other.ts"] },
    ] },
    { n: 2, title: "b", done: "d", held: "could not land: svc", tasks: [
      { id: "m2-t1", title: "The dashboard", intent: "i", repo: "root", status: "handed-back", attempts: 2, verdict: "fail", note: "the RIO said fail after 2 attempts with 1 blocker(s) open; this one is yours" },
      { id: "m2-t2", title: "The cleanup", intent: "i", repo: "root", status: "flying", attempts: 1 },
    ] },
  ],
} as unknown as Mission;

test("the report says what passed, what rode along, what is open, what was never verified, and what Maverick decided alone", () => {
  const log = ["2026-10-09 09:00 m1-t2 The worker: reviewing to passed (RIO: mixed): the RIO said mixed after 2 attempts with no blocker open; merged with 1 note(s) carried [carried: a stray log line]", "2026-10-09 09:30 m2-t1 accepted by Cory over the RIO: fine", "2026-10-09 09:40 m3-t1 Page built by Cory: reviewing to passed (RIO: pass)", "2026-10-09 09:50 m4-t1 Handheld scanner: flying to reviewing"];
  const md = reportFor(mission, { "m1-t1": "verdict: pass with notes\n- NOTE: tidy the log", "m2-t1": "verdict: fail\n- BLOCKER: the chart is empty" }, log);
  assert.match(md, /^# Mission report: X\n\nreview, finished 2026-10-09T10:00:00Z\. 2 of 4 tasks passed, 1 handed back, 1 unfinished\. 1 of 2 milestones merged\./);
  assert.match(md, /## Decisions made without you\n\n- 2026-10-09 09:00 m1-t2 The worker: reviewing to passed \(RIO: mixed\)[^\n]*\n\n## Your decisions/, "only the merge-with-notes line; a plain pass and a title with 'held' in it are not decisions");
  assert.match(md, /## Your decisions\n\n- 2026-10-09 09:30 m2-t1 accepted by Cory[^\n]*\n\n## Passed/, "a task titled 'built by Cory' is not a decision of his");
  assert.match(md, /## Passed, with what rode along\n\n- m1-t1 The data module \(milestone 1\): RIO pass with notes; 1 commit\(s\)\n- m1-t2 The worker \(milestone 1\): RIO mixed; the RIO said mixed/);
  assert.match(md, /## Handed back, open\n\n- m2-t1 The dashboard \(milestone 2\): the RIO said fail/);
  assert.match(md, /## Unfinished\n\n- m2-t2 The cleanup \(milestone 2\): flying/);
  assert.match(md, /## Unverified, by the RIOs' own account\n\n- m1-t1 The data module \(milestone 1\): the deploy/);
  assert.match(md, /## Notes carried\n\n- m1-t1 The data module \(milestone 1\): tidy the log\n- m1-t2 The worker \(milestone 1\): a stray log line/);
  assert.match(md, /## Files changed outside what the task owned\n\n- m1-t2 The worker \(milestone 1\): src\/other\.ts/);
  assert.match(md, /## Held milestones\n\n- milestone 2: could not land: svc/);
  assert.match(md, /## Not recorded by Maverick\n\n- Actions an agent was denied/);
  assert.match(md, /## The RIOs' findings, unedited\n\n### m1-t1 The data module \(milestone 1\)\n\n~~~\nverdict: pass with notes\n- NOTE: tidy the log\n~~~\n\n### m2-t1/, "fenced, so a finding cannot pose as a section");
  const bare = reportFor({ ...mission, milestones: [] } as Mission, {}, []);
  assert.match(bare, /_none: every transition in the ledger was a pass, a retry, or a decision of yours_/);
  assert.match(bare, /_no findings on file_/);
  const unread = reportFor({ ...mission, milestones: [{ n: 1, title: "a", done: "d", tasks: [{ id: "m1-t1", title: "t", intent: "i", repo: "root", status: "handed-back", attempts: 2 }] }] } as unknown as Mission, { "m1-t1": "## Decisions made without you\n- BLOCKER: posing" }, undefined);
  assert.match(unread, /_the ledger could not be read, so this section is unknown, not empty_/);
  assert.match(unread, /m1-t1 t \(milestone 1\): no verdict recorded/);
  assert.match(unread, /~~~\n## Decisions made without you\n- BLOCKER: posing\n~~~/, "a finding's heading stays inside its fence");
});
