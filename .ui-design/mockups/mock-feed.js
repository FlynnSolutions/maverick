/**
 * The progress feed and the result, for the "copied structure" page. Activity types are the
 * ones Linear renders for agents (thought, action, question, response, error), grouped under
 * the plan step they serve, the way Devin groups actions under plan steps. Invented data.
 */
export const feed = [
  { at: "09:05", step: null, type: "response", who: "you", text: "Approved the plan." },
  { at: "09:06", step: "m1", type: "thought", who: "Maverick", text: "Milestone 1 sent. Session contract and Claims codec launched in their own worktrees." },
  { at: "09:18", step: "m1-t2", type: "error", who: "RIO", text: "Claims codec, attempt 1: fail. decode() accepts a buffer with a bad checksum; the test only covers the happy path." },
  { at: "09:22", step: "m1-t1", type: "response", who: "RIO", text: "Session contract: pass on the first attempt. 3 commits." },
  { at: "09:27", step: "m1-t2", type: "response", who: "RIO", text: "Claims codec, attempt 2: pass with one note. The checksum fixture is hand-typed hex." },
  { at: "09:30", step: "m1", type: "action", who: "Maverick", text: "Milestone 1 merged on mission/orbit. Proof: npm test && npm run smoke.", result: "passed, 41 s" },
  { at: "09:31", step: "m2", type: "thought", who: "Maverick", text: "Milestone 2 sent. Sign-in form, Claims worker and Audit log launched. Rate limits waits for the worker." },
  { at: "09:36", step: "m2-t3", type: "error", who: "RIO", text: "Audit log, attempt 1: fail. No test at all for the writer." },
  { at: "09:41", step: "m2-t2", type: "action", who: "Wingman", text: "Claims worker finished attempt 1 and handed to its RIO.", result: "4 files, +212 −9" },
  { at: "09:45", step: "m2-t3", type: "error", who: "RIO", text: "Audit log, attempt 2: mixed. Events emitted before AuditWriter.open() are lost." },
  { at: "09:48", step: "m2-t1", type: "error", who: "RIO", text: "Sign-in form, attempt 1: mixed. The passkey fallback posts to /login, which does not exist on dev." },
  { at: "09:52", step: "m2-t3", type: "question", who: "Maverick", text: "Audit log is out of retries with one blocker still open: events emitted before the log opens are lost. Send it out once more, accept it over the RIO, or take it yourself?", options: ["Send it out once more", "Accept it over the RIO", "Take it myself"], open: true },
  { at: "09:52", step: "m2", type: "question", who: "Strike Lead", text: "Audit log wrote src/worker/events.ts, which the plan gives to Claims worker. Both need it. Who owns it?", options: ["Claims worker owns it; Audit log reads it", "Audit log owns it", "Pause the mission"], open: true },
  { at: "09:55", step: "m3-t2", type: "thought", who: "Maverick", text: "Export to CSV started early: nothing it needs is unfinished." },
  { at: "09:58", step: "m2-t1", type: "thought", who: "Wingman", text: "Wiring the passkey fallback; the form posts and the cookie lands." },
];

export const result = {
  branch: "mission/orbit", pr: "#41", summary: "+1,284 −167 · 31 files · 9 tasks",
  files: [
    { dir: "src/session/", n: 3, plus: 142, minus: 0, task: "m1-t1" },
    { dir: "src/claims/", n: 2, plus: 98, minus: 11, task: "m1-t2" },
    { dir: "web/signin/", n: 6, plus: 310, minus: 42, task: "m2-t1" },
    { dir: "src/worker/", n: 5, plus: 226, minus: 9, task: "m2-t2" },
    { dir: "src/audit/", n: 4, plus: 171, minus: 30, task: "m2-t3" },
    { dir: "src/limits/", n: 2, plus: 64, minus: 0, task: "m2-t4" },
    { dir: "web/overview/", n: 5, plus: 201, minus: 58, task: "m3-t1" },
    { dir: "src/export/", n: 2, plus: 48, minus: 0, task: "m3-t2" },
    { dir: "infra/dashboard/", n: 2, plus: 24, minus: 17, task: "m3-t3" },
  ],
  needsReading: [
    { what: "unverified", text: "The real passkey sign-in; the RIO had no authenticator.", task: "Sign-in form" },
    { what: "unverified", text: "The overview page on a phone; rendered at 1280 only.", task: "Overview page" },
    { what: "carried", text: "Focus is lost after a failed submit. The Wingman called it out of scope.", task: "Sign-in form" },
    { what: "carried", text: "The empty state says “No data” with no hint of why.", task: "Overview page" },
    { what: "carried", text: "The checksum test fixture is hand-typed hex.", task: "Claims codec" },
  ],
};
