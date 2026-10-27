/** The Strike Lead as a chat: the reply it must give, the answers it is sent, and what it has not heard. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { answersText, parseTurn, unheard, type ChatEntry } from "../src/strike-lead.ts";

test("a round of answers keeps the numbering it was asked in, clicks and own words together, and says what was skipped", () => {
  const qs = [
    { id: "a", question: "Include the export?", options: ["No", "Yes"] },
    { id: "b", question: "Which repos?", options: ["backend", "frontend"], multi: true },
    { id: "c", question: "Ship behind a flag?", options: ["Yes", "No"] },
  ];
  assert.equal(answersText(qs, { a: { options: ["No"] }, b: { options: ["backend", "frontend"], other: "  and contracts " } }),
    "1. Include the export?\n   No\n2. Which repos?\n   backend; frontend; and contracts\n3. Ship behind a flag?\n   (no answer)");
});

test("a turn's structured reply is read, its questions given ids, and a turn without one says why", () => {
  const ok = parseTurn(JSON.stringify({ is_error: false, result: "", structured_output: { message: "Two things.", questions: [{ question: "Q?", options: ["a", "b"] }, { nope: 1 }], planReady: false } }));
  assert.deepEqual(ok, { ok: true, message: "Two things.", questions: [{ id: "q1", question: "Q?", options: ["a", "b"] }], planReady: false });
  assert.deepEqual(parseTurn(JSON.stringify({ is_error: true, result: "credit balance too low" })), { ok: false, why: "credit balance too low" });
  assert.deepEqual(parseTurn("Workspace not trusted"), { ok: false, why: "the session printed something that is not its JSON: Workspace not trusted" });
  const loose = parseTurn(JSON.stringify({ structured_output: { message: "x", planReady: "yes" } }));
  assert.ok(loose.ok && !loose.planReady, "only a real true is ready");
});

test("what the Strike Lead has not heard is everything after its last reply or a failed turn, and never the failure itself", () => {
  const at = "2026-10-27T00:00:00Z";
  const chat: ChatEntry[] = [
    { at, who: "you", text: "one" },
    { at, who: "Strike Lead", text: "answer" },
    { at, who: "you", text: "two" },
    { at, who: "Maverick", text: "the plan cannot be flown" },
  ];
  assert.deepEqual(unheard(chat).map((e) => e.text), ["two", "the plan cannot be flown"]);
  assert.deepEqual(unheard([...chat, { at, who: "Maverick", text: "did not answer", error: true }]), [], "a failed turn counts what it carried as heard");
  assert.deepEqual(unheard([{ at, who: "you", text: "first" }]).map((e) => e.text), ["first"]);
});
