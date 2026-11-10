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

/**
 * A strip's state and note. A session whose review is still owed is not done, whatever its own
 * agent says: a Wingman read `done` beside `auditing (blocked)` while its RIO sat on an expired
 * login. Once the session has ended the review is its state; while it runs, the review is the
 * note beside its own word. Either way the row says each thing once.
 */
export const stripState = (s, record) => {
  const owed = reviewOwed(record);
  if (owed && finished(s.status)) return { state: owed, note: s.waitingFor };
  return { state: stateWord(s), note: [s.waitingFor, owed].filter(Boolean).join(" · ") || undefined };
};
