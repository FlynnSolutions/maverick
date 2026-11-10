// The words a session's strip says about where it stands. Pure, so the rule that one row never
// says two things at once is pinned in a test rather than found in a screenshot.

/**
 * A session that has ended. `blocked` is deliberately not here: it is running and stopped at a
 * prompt, which is the loudest thing on the page, not the quietest. Counting it as finished put
 * the same session in "Needs you" and in "Background · done" at once, because those two filters
 * run independently over one list, and painted a lock lamp on a strip marked finished.
 */
export const finished = (s) => /^(done|exited|stopped|down)$/.test(s ?? "");

/** One word per fact in the state column: the registry's words differ by where the session runs, not by what it is doing. */
const STATE_WORD = { busy: "working", running: "working", waiting: "waiting for you", shell: "idle", done: "ended", exited: "ended" };
const stateWord =(s) => (s.isShell ? "shell" : STATE_WORD[s.status] ?? s.status);

/**
 * Where a review the record still waits on stands, read off the reviewer's own agent: stopped at
 * a prompt, gone without writing a verdict, or still at it. Undefined when no review is owed.
 */
export const reviewOwed = (record) => {
  const v = record?.auditView;
  if (v?.verdict !== "pending") return undefined;
  if (v.agentState === "blocked") return "review blocked";
  return finished(v.agentState) ? "review gave no verdict" : "in review";
};

/** An owed review whose reviewer is stopped at a prompt: the RIO is what a strip's open reaches. */
export const reviewBlocked = (record) => record?.auditView?.verdict === "pending" && record.auditView.agentState === "blocked";

/** An owed review that cannot go on without the person: its reviewer is stopped at a prompt, or ended with no verdict. */
export const reviewWantsYou = (record) => reviewBlocked(record) || (record?.auditView?.verdict === "pending" && finished(record.auditView.agentState));

/** A session that has ended with its review still owed: not done, and filed by its review. */
export const owesReview = (s, record) => finished(s.status) && Boolean(reviewOwed(record));

/**
 * What belongs with what has ended: a session that has ended and owes nothing. One whose review is
 * still owed is not done, so it is filed by its review: a review that wants the person is in Needs
 * you, one still running is work. A Wingman read `review blocked` from the Archive, styled finished.
 */
export const settled = (s, record) => finished(s.status) && !owesReview(s, record);

/**
 * A strip's state and note. A session whose review is still owed is not done, whatever its own
 * agent says: a Wingman read `done` beside `auditing (blocked)` while its RIO sat on an expired
 * login. Once the session has ended the review is its state; while it runs, the review is the
 * note beside its own word. Either way the row says each thing once.
 */
export const stripState = (s, record) => {
  const owed = reviewOwed(record);
  // A reviewer at a prompt is the RIO the strip's open reaches, so the note says whose prompt it is.
  if (owed && finished(s.status)) return { state: owed, note: reviewBlocked(record) ? "its RIO is at a prompt" : s.waitingFor };
  return { state: stateWord(s), note: [s.waitingFor, owed].filter(Boolean).join(" · ") || undefined };
};
