// Where a mission is in its life, read the same way by the shell and every module, so a new
// status is taught to the page once.

/** Closed or stopped: nothing on it can be acted on, and nothing on it is live. */
export const isEnded = (status) => status === "closed" || status === "abandoned";

/** Every milestone merged and the close not yet given: the result is the action. */
export const atReview = (status) => status === "review";

/** The word a mission shows. A stopped mission is not a finished one: "done" in the good colour is for work that landed. */
export const missionWord = (m) => (m.status === "abandoned" && m.word !== "error" ? "stopped" : m.word ?? "working");
