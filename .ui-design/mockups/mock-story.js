/**
 * The mission as a story a person can follow: what was asked, what each milestone gives them,
 * what each task is for. The same three cards carry through before, during and after the flight;
 * only the right-hand column changes. Invented project, no real names.
 */
export const asked = {
  name: "Orbit",
  sentence: "People sign in to Skyline with a passkey, every claim they make goes through a worker that checks it, and a dashboard shows the claims as they land.",
  by: "Cory, with the Strike Lead, 2026-10-12 09:05",
  branch: "mission/orbit",
};

export const milestones = [
  {
    n: 1, title: "Contracts and the schema",
    gives: "Nothing you can see yet. The shape of a session and the way a claim is encoded now exist in one place, with tests, so the next two milestones build on the same definitions instead of inventing their own.",
    proof: "both contracts have a test and the proof passes",
    where: ["src/session/", "src/claims/"],
    tasks: [
      { id: "m1-t1", title: "Session contract", intent: "Define the session cookie: its id, user and expiry, and the one function that reads it.", during: { status: "passed", attempt: 1 }, after: { verdict: "pass", attempts: 1, commits: 3 } },
      { id: "m1-t2", title: "Claims codec", intent: "Encode a claim to bytes and back, with a checksum, so the worker and the dashboard agree on what a claim is.", during: { status: "passed", attempt: 2 }, after: { verdict: "pass with notes", attempts: 2, commits: 5, read: ["The checksum test fixture is hand-typed hex."] } },
    ],
    before: { starts: "first; nothing else can start until both pass" },
    during: { state: "landed", at: "09:30", note: "proof failed once at 09:11 (flaky smoke), you said prove again, passed 09:30" },
    after: { landed: "09:30", attempts: 3 },
  },
  {
    n: 2, title: "Sign-in and the claims pipeline",
    gives: "A person can sign in on dev with a passkey, and a claim they make reaches the worker, gets checked, and is written to the audit log.",
    proof: "a user signs in on dev and a claim round-trips through the worker",
    where: ["web/signin/", "src/worker/", "src/audit/", "src/limits/"],
    try: "Open dev, sign in with your passkey, make a claim, and watch it appear in the audit log.",
    tasks: [
      { id: "m2-t1", title: "Sign-in form", intent: "The sign-in page: passkey first, a password fallback, and the session cookie set on success.", during: { status: "flying", attempt: 2, say: "Wiring the passkey fallback; the form posts and the cookie lands." }, after: { verdict: "pass with notes", attempts: 2, commits: 7, read: ["The real passkey sign-in was not verified; the RIO had no authenticator.", "Focus is lost after a failed submit. The Wingman called it out of scope."] } },
      { id: "m2-t2", title: "Claims worker", intent: "A background worker that takes each claim off the queue, checks it, and emits an event.", during: { status: "reviewing", attempt: 1, say: "Running the worker against the parent commit to see which tests are new." }, after: { verdict: "pass", attempts: 1, commits: 4 } },
      { id: "m2-t3", title: "Audit log", intent: "Every event the worker emits is written to an append-only log a person can read.", during: { status: "handed-back", attempt: 3, say: "Out of retries with one blocker: events emitted before the log opens are lost. Your call." }, after: { verdict: "pass", attempts: 4, commits: 9, story: "Three attempts failed on the same blocker. You sent it out a fourth time at 10:06 and it passed." } },
      { id: "m2-t4", title: "Rate limits", intent: "No one can make more than a set number of claims a minute.", during: { status: "pending", waits: "m2-t2 is with its RIO" }, after: { verdict: "pass", attempts: 1, commits: 2 } },
    ],
    before: { starts: "when milestone 1 lands; Rate limits waits for the worker" },
    during: { state: "flying", at: "09:31", note: "1 flying, 1 with its RIO, 1 handed back to you, 1 waiting" },
    after: { landed: "10:48", attempts: 8 },
  },
  {
    n: 3, title: "Dashboard",
    gives: "An overview page that shows live claims from dev, with an export to CSV, deployed to the shared dev environment.",
    proof: "the overview page shows live claims on dev",
    where: ["web/overview/", "src/export/", "infra/dashboard/"],
    try: "Open the overview on dev. The claims you made in milestone 2 are on it. Export them.",
    tasks: [
      { id: "m3-t1", title: "Overview page", intent: "A page that lists claims as they land, newest first, and updates without a reload.", during: { status: "pending", waits: "the sign-in form is flying" }, after: { verdict: "pass with notes", attempts: 1, commits: 6, read: ["Not checked on a phone; rendered at 1280 only.", "The empty state says “No data” with no hint of why."] } },
      { id: "m3-t2", title: "Export to CSV", intent: "One button that downloads the claims on screen as a CSV.", during: { status: "next", note: "nothing it needs is unfinished; starts on the next sweep" }, after: { verdict: "pass", attempts: 1, commits: 2 } },
      { id: "m3-t3", title: "Deploy the dashboard", intent: "Put the overview on dev. The only task in this milestone that deploys.", during: { status: "pending", waits: "compute is the worker's until it lands" }, after: { verdict: "pass", attempts: 1, commits: 1 } },
    ],
    before: { starts: "when milestone 2 lands; Export can start earlier, it needs nothing" },
    during: { state: "not sent", note: "Export to CSV starts early" },
    after: { landed: "11:40", attempts: 3 },
  },
];

export const calls = [
  { at: "09:05", text: "Approved the plan at the gate." },
  { at: "09:12", text: "Milestone 1's proof failed once. You said prove again.", note: "flaky smoke; the second run passed" },
  { at: "10:06", text: "Audit log was out of retries with a real blocker. You sent it out a fourth time, and gave src/worker/events.ts to the worker.", note: "the blocker is real, fix it" },
  { at: "11:41", text: "Closed the mission: pushed mission/orbit and opened PR #41." },
];
