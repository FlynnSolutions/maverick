/**
 * One fixture mission both mockups draw from, so the question queue and the flight plan show
 * the same morning. Everything here is invented; no client, project or account is real.
 */
export const mission = {
  id: "orbit",
  name: "Orbit: sign-in, claims and the dashboard",
  project: "skyline",
  status: "blocked",
  branch: "mission/orbit",
  sweepAgo: 4,
  repos: [{ label: "root", path: "~/Projects/skyline" }],
  shared: ["dev"],
  proof: "npm test && npm run smoke",
  contracts: [
    { name: "Session", owner: "m1-t1", shape: "the cookie: id, user, expires" },
    { name: "claimsCodec", owner: "m1-t2", shape: "encode(claim) / decode(buf)" },
  ],
  milestones: [
    {
      n: 1, title: "Contracts and the schema", done: "both contracts have a test and the proof passes",
      state: "done", merged: "09:30", proof: { ok: true },
      tasks: [
        { id: "m1-t1", title: "Session contract", status: "passed", attempt: 1, verdict: "pass", touches: ["src/session/"], who: "Wingman m1-t1" },
        { id: "m1-t2", title: "Claims codec", status: "passed", attempt: 2, verdict: "pass with notes", notes: 1, touches: ["src/claims/codec.ts"], who: "Wingman m1-t2" },
      ],
    },
    {
      n: 2, title: "Sign-in and the claims pipeline", done: "a user signs in on dev and a claim round-trips through the worker",
      state: "flying", dispatched: "09:31",
      tasks: [
        { id: "m2-t1", title: "Sign-in form", status: "flying", attempt: 2, touches: ["web/signin/"], needs: ["m1-t1"], who: "Wingman m2-t1", since: "09:31", say: "Wiring the passkey fallback; the form posts and the cookie lands." },
        { id: "m2-t2", title: "Claims worker", status: "reviewing", attempt: 1, touches: ["src/worker/"], deploys: ["compute"], needs: ["m1-t2"], who: "RIO m2-t2", since: "09:41", say: "Running the worker against the parent commit to see which tests are new." },
        { id: "m2-t3", title: "Audit log", status: "handed-back", attempt: 3, verdict: "mixed", blockers: 1, notes: 2, touches: ["src/audit/"], strayed: ["src/worker/events.ts"], who: "handed back", since: "09:52" },
        { id: "m2-t4", title: "Rate limits", status: "pending", touches: ["src/limits/"], needs: ["m2-t2"], waits: "m2-t2 is with its RIO" },
      ],
    },
    {
      n: 3, title: "Dashboard", done: "the overview page shows live claims on dev",
      state: "pending",
      tasks: [
        { id: "m3-t1", title: "Overview page", status: "pending", touches: ["web/overview/"], needs: ["m2-t1"], waits: "m2-t1 is flying" },
        { id: "m3-t2", title: "Export to CSV", status: "next", touches: ["src/export/"], next: "nothing it needs is unfinished; starts on the next sweep" },
        { id: "m3-t3", title: "Deploy the dashboard", status: "pending", touches: ["infra/dashboard/"], deploys: ["compute"], waits: "compute is m2-t2's until it lands" },
      ],
    },
  ],
  questions: [
    {
      n: 1, kind: "plan", at: "09:52", from: "Strike Lead", lamp: "lock",
      title: "Who owns src/worker/events.ts?",
      body: "m2-t3 (Audit log) wrote src/worker/events.ts, which belongs to m2-t2 (Claims worker) under its touches. The plan gives the file to neither task by name, and both need it: the worker emits the events the audit log reads. This is a question about the plan, so I have not merged either side.",
      context: { label: "the plan, milestone 2", text: "- [ ] **Claims worker** `m2-t2`\n  touches: src/worker/\n  deploys: compute\n- [ ] **Audit log** `m2-t3`\n  touches: src/audit/" },
      answers: [
        { label: "m2-t2 owns it; m2-t3 reads it", primary: true, effect: "m2-t3 goes back out told to read the events from m2-t2's branch" },
        { label: "m2-t3 owns it", effect: "m2-t2's RIO is told the file moved; its touches widen to src/worker/events.ts" },
        { label: "Pause the mission", effect: "nothing new starts; I will sort it out myself" },
      ],
    },
    {
      n: 2, kind: "rio", at: "09:52", from: "RIO m2-t3", lamp: "lock",
      title: "Audit log is out of retries with one blocker",
      body: "Attempt 3 of 3 came back mixed. The blocker is real: the log drops events emitted before the writer opens. The two notes are style. The protocol stops here; a blocker never merges on its own.",
      context: { label: "findings, attempt 3", text: "verdict: mixed\n- BLOCKER: events emitted before AuditWriter.open() are lost; test/audit.test.ts never exercises the window\n- NOTE: a stray console.log in src/audit/writer.ts:41\n- NOTE: the retry test asserts on a string that the message change will break" },
      answers: [
        { label: "Send it back out, once more", primary: true, effect: "a fourth attempt, with these findings in its brief" },
        { label: "Accept it over the RIO", effect: "merges with the blocker carried; your note goes in the ledger", danger: true },
        { label: "Hand it to me", effect: "the task leaves the mission; the milestone waits on you" },
      ],
    },
    {
      n: 3, kind: "preflight", at: "09:05", from: "preflight", lamp: "acquire",
      title: "A passkey for the dev sign-in",
      body: "The plan's preflight says a person has to pass the dev sign-in once so the session cookie exists. Nothing is blocked on it yet; m2-t1 will need it to run its smoke test.",
      answers: [
        { label: "Done, the cookie is there", primary: true, effect: "the check is marked yours, confirmed 10:02" },
        { label: "Not yet", effect: "stays on the list; m2-t1's smoke test will wait" },
      ],
    },
  ],
  answered: [
    { n: 0, kind: "proof", at: "09:12", title: "Milestone 1's proof failed on the first run", answer: "Prove again", note: "flaky smoke; the second run passed", by: "Cory" },
  ],
  ledger: [
    { at: "09:55", kind: "auto", text: "m3-t2 started early: nothing it needs is unfinished" },
    { at: "09:52", kind: "held", text: "milestone 2: m2-t3 strayed into src/worker/events.ts, owned by m2-t2. A question about the plan." },
    { at: "09:52", kind: "auto", text: "m2-t3 handed back: RIO mixed (1 blocker, 2 notes), out of retries" },
    { at: "09:41", kind: "auto", text: "m2-t2 finished attempt 1; its RIO is in" },
    { at: "09:31", kind: "auto", text: "milestone 2 sent: m2-t1, m2-t2, m2-t3 launched; m2-t4 waits on m2-t2" },
    { at: "09:30", kind: "auto", text: "milestone 1 proved and landed on mission/orbit" },
    { at: "09:12", kind: "decision", text: "prove milestone 1 again (Cory: flaky smoke; the second run passed)" },
    { at: "09:11", kind: "held", text: "milestone 1: proof failed (npm run smoke exited 1)" },
    { at: "09:05", kind: "decision", text: "approved at the gate (Cory)" },
  ],
};

export const KIND = { plan: "question about the plan", rio: "RIO handed back", preflight: "yours to confirm", proof: "proof failed", collision: "collision" };

/** What each task state is called on a strip, and which lamp it wears. */
export const STATE = {
  passed: { label: "passed", lamp: ["done", "work"] },
  flying: { label: "flying", lamp: ["busy", "work"] },
  reviewing: { label: "RIO in", lamp: ["busy", "action"] },
  "handed-back": { label: "handed back", lamp: ["blocked", "work"] },
  pending: { label: "waits", lamp: ["idle", "stale"] },
  next: { label: "next out", lamp: ["idle", "warm"] },
};
