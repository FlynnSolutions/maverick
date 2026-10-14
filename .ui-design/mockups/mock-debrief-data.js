/** The same invented mission as mock-data.js, after it landed: what a debrief has to show. */
export const flight = {
  name: "Orbit: sign-in, claims and the dashboard",
  project: "skyline",
  status: "landed",
  approved: "09:05", finished: "11:42", branch: "mission/orbit", pr: "#41",
  milestones: 3, merged: 3, tasks: 9, passed: 9, handedBack: 0,
  attempts: 14, firstPass: 5, blockersFound: 4, notesCarried: 3, unverified: 2,
  decisions: 4, auto: 11, held: 2,
  proofs: [{ n: 1, ok: false, at: "09:11" }, { n: 1, ok: true, at: "09:30" }, { n: 2, ok: true, at: "10:48" }, { n: 3, ok: true, at: "11:40" }],
  cost: { usd: 38.2, tokens: "4.1M", sessions: 23 },
};

export const tasks = [
  { id: "m1-t1", n: 1, title: "Session contract", attempts: [{ verdict: "pass", at: "09:22", rio: "RIO m1-t1" }], commits: 3, touches: ["src/session/"] },
  { id: "m1-t2", n: 1, title: "Claims codec", attempts: [
      { verdict: "fail", at: "09:18", rio: "RIO m1-t2", findings: "verdict: fail\n- BLOCKER: decode() accepts a buffer with a bad checksum; test only covers the happy path" },
      { verdict: "pass with notes", at: "09:27", rio: "RIO m1-t2", findings: "verdict: pass with notes\n- NOTE: the checksum test fixture is hand-typed hex; a helper would be clearer" }],
    commits: 5, touches: ["src/claims/codec.ts"], carried: ["the checksum test fixture is hand-typed hex"] },
  { id: "m2-t1", n: 2, title: "Sign-in form", attempts: [
      { verdict: "mixed", at: "09:48", rio: "RIO m2-t1", findings: "verdict: mixed\n- BLOCKER: the passkey fallback posts to /login, which does not exist on dev\n- NOTE: focus is lost after a failed submit" },
      { verdict: "pass with notes", at: "10:21", rio: "RIO m2-t1", findings: "verdict: pass with notes\n- NOTE: focus is lost after a failed submit (unchanged, the Wingman said it is out of scope)\n- UNVERIFIED: the real passkey sign-in; I had no authenticator" }],
    commits: 7, touches: ["web/signin/"], carried: ["focus is lost after a failed submit", "unverified: the real passkey sign-in"] },
  { id: "m2-t2", n: 2, title: "Claims worker", attempts: [{ verdict: "pass", at: "10:02", rio: "RIO m2-t2" }], commits: 4, touches: ["src/worker/"], deploys: ["compute"] },
  { id: "m2-t3", n: 2, title: "Audit log", attempts: [
      { verdict: "fail", at: "09:36", rio: "RIO m2-t3", findings: "verdict: fail\n- BLOCKER: no test at all for the writer" },
      { verdict: "mixed", at: "09:45", rio: "RIO m2-t3", findings: "verdict: mixed\n- BLOCKER: events emitted before AuditWriter.open() are lost\n- NOTE: a stray console.log in src/audit/writer.ts:41" },
      { verdict: "mixed", at: "09:52", rio: "RIO m2-t3", findings: "verdict: mixed\n- BLOCKER: events emitted before AuditWriter.open() are lost; test/audit.test.ts never exercises the window\n- NOTE: a stray console.log in src/audit/writer.ts:41\n- NOTE: the retry test asserts on a string that the message change will break" },
      { verdict: "pass", at: "10:40", rio: "RIO m2-t3", decision: "sent back out a fourth time (Cory, 10:06: the blocker is real, fix it)" }],
    commits: 9, touches: ["src/audit/"], strayed: ["src/worker/events.ts"] },
  { id: "m2-t4", n: 2, title: "Rate limits", attempts: [{ verdict: "pass", at: "10:44", rio: "RIO m2-t4" }], commits: 2, touches: ["src/limits/"] },
  { id: "m3-t1", n: 3, title: "Overview page", attempts: [{ verdict: "pass with notes", at: "11:20", rio: "RIO m3-t1", findings: "verdict: pass with notes\n- NOTE: the empty state says 'No data' with no hint of why\n- UNVERIFIED: the page on a phone; I rendered it at 1280 only" }], commits: 6, touches: ["web/overview/"], carried: ["unverified: the page on a phone"] },
  { id: "m3-t2", n: 3, title: "Export to CSV", attempts: [{ verdict: "pass", at: "10:30", rio: "RIO m3-t2" }], commits: 2, touches: ["src/export/"] },
  { id: "m3-t3", n: 3, title: "Deploy the dashboard", attempts: [{ verdict: "pass", at: "11:31", rio: "RIO m3-t3" }], commits: 1, touches: ["infra/dashboard/"], deploys: ["compute"] },
];

export const timeline = [
  { at: "09:05", kind: "decision", text: "approved at the gate", by: "Cory", n: 0 },
  { at: "09:06", kind: "auto", text: "milestone 1 sent: m1-t1, m1-t2 launched", n: 1 },
  { at: "09:11", kind: "held", text: "milestone 1: proof failed (npm run smoke exited 1)", n: 1 },
  { at: "09:12", kind: "decision", text: "prove milestone 1 again", by: "Cory", note: "flaky smoke; the second run passed", n: 1 },
  { at: "09:30", kind: "auto", text: "milestone 1 proved and landed on mission/orbit", n: 1 },
  { at: "09:31", kind: "auto", text: "milestone 2 sent: m2-t1, m2-t2, m2-t3 launched; m2-t4 waits on m2-t2", n: 2 },
  { at: "09:52", kind: "held", text: "milestone 2: m2-t3 strayed into src/worker/events.ts, owned by m2-t2. A question about the plan.", n: 2 },
  { at: "09:55", kind: "auto", text: "m3-t2 started early: nothing it needs is unfinished", n: 3 },
  { at: "10:06", kind: "decision", text: "m2-t2 owns src/worker/events.ts; m2-t3 reads it. m2-t3 sent back out a fourth time", by: "Cory", note: "the blocker is real, fix it", n: 2 },
  { at: "10:21", kind: "auto", text: "m2-t1 passed with notes on attempt 2; one step unverified", n: 2 },
  { at: "10:48", kind: "auto", text: "milestone 2 proved and landed on mission/orbit", n: 2 },
  { at: "10:49", kind: "auto", text: "milestone 3 sent: m3-t1, m3-t3 launched", n: 3 },
  { at: "11:40", kind: "auto", text: "milestone 3 proved and landed on mission/orbit", n: 3 },
  { at: "11:41", kind: "decision", text: "close: push mission/orbit and open the pull request", by: "Cory", n: 3 },
  { at: "11:42", kind: "auto", text: "pushed; PR #41 opened; report committed beside the ledger", n: 3 },
];

export const report = {
  "Decisions made without you": [
    "m3-t2 started early at 09:55: nothing it needed was unfinished",
    "m1-t2 merged on attempt 2 with one note carried (pass with notes)",
    "m2-t1 merged on attempt 2 with one note and one unverified step carried",
  ],
  "Unverified, by the RIOs' own account": [
    "m2-t1 Sign-in form: the real passkey sign-in; the RIO had no authenticator",
    "m3-t1 Overview page: the page on a phone; rendered at 1280 only",
  ],
  "Notes carried": [
    "m1-t2 Claims codec: the checksum test fixture is hand-typed hex",
    "m2-t1 Sign-in form: focus is lost after a failed submit",
    "m3-t1 Overview page: the empty state says 'No data' with no hint of why",
  ],
  "Files changed outside what the task owned": ["m2-t3 Audit log: src/worker/events.ts (settled 10:06: m2-t2 owns it)"],
  "Not recorded by Maverick": [
    "Actions an agent was denied and why: not captured; in each Wingman's transcript",
    "Spend by key, and resources created outside the project's stacks: read the usage view and the stacks",
    "Amendments to fixed decisions: in the project's decision log, if the Wingman followed its brief",
  ],
};
