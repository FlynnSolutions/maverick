/** A session's strip says each thing once: a row never reads `done` beside a review still owed. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewOwed, stripState } from "../web/session-word.js";

const owing = (agentState?: string) => ({ auditView: { verdict: "pending", agentState } });

test("an ended session whose review is still owed says the review, never that it is done", () => {
  for (const status of ["done", "exited", "stopped", "down"]) {
    assert.deepEqual(stripState({ status }, owing("blocked")), { state: "review blocked", note: undefined }, status);
    assert.equal(stripState({ status }, owing("running")).state, "in review", status);
    assert.equal(stripState({ status }, owing(undefined)).state, "in review", `${status}: a reviewer not listed yet`);
    assert.equal(stripState({ status }, owing("done")).state, "review gave no verdict", status);
  }
});

test("a live session keeps its own word, and a review owed on it is the note beside it", () => {
  assert.deepEqual(stripState({ status: "busy" }, owing("blocked")), { state: "working", note: "review blocked" });
  assert.deepEqual(stripState({ status: "waiting", waitingFor: "permission" }, owing("running")), { state: "waiting for you", note: "permission · in review" });
});

test("with no review owed the strip says the session's own word, and a verdict owes nothing", () => {
  assert.deepEqual(stripState({ status: "done" }, undefined), { state: "ended", note: undefined });
  assert.deepEqual(stripState({ status: "done" }, { auditView: { verdict: "pass" } }), { state: "ended", note: undefined });
  assert.equal(stripState({ status: "busy", isShell: true }, null).state, "shell");
  assert.equal(reviewOwed({ auditView: { verdict: "none" } }), undefined);
  assert.equal(reviewOwed({ auditView: { verdict: "fail", agentState: "blocked" } }), undefined, "the review is written; the chip says its verdict");
});
