/**
 * Which questions are new between two polls of the workspace: matched by mission and question
 * id, never by title or time, and never across missions.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { newQuestions, type MissionQuestions } from "../src/notify.ts";
import type { Question } from "../src/questions.ts";

const q = (id: string, extra: Partial<Question> = {}): Question =>
  ({ id, kind: "gate", title: `title ${id}`, body: "b", at: "2026-10-14T00:00:00.000Z", answers: [], ...extra });
const m = (missionId: string, questions: Question[]): MissionQuestions => ({ missionId, missionName: `name ${missionId}`, questions });

test("a question in after and not in before is new, carrying its mission's id and name", () => {
  const fresh = q("task:m1-t1", { kind: "handed-back" });
  assert.deepEqual(newQuestions([m("a", [q("gate")])], [m("a", [q("gate"), fresh])]), [
    { missionId: "a", missionName: "name a", question: fresh },
  ]);
});

test("a question still open is not new, even when its title and time have moved", () => {
  const after = [m("a", [q("gate", { title: "reworded", at: "2026-10-15T00:00:00.000Z" })])];
  assert.deepEqual(newQuestions([m("a", [q("gate")])], after), []);
});

test("the same question id on another mission is new", () => {
  const out = newQuestions([m("a", [q("gate")])], [m("a", [q("gate")]), m("b", [q("gate")])]);
  assert.deepEqual(out.map((n) => [n.missionId, n.question.id]), [["b", "gate"]]);
});

test("a mission that was not there before brings all its questions, in its order", () => {
  const out = newQuestions([], [m("a", [q("hold:1"), q("paused")]), m("b", [q("gate")])]);
  assert.deepEqual(out.map((n) => [n.missionId, n.question.id]), [["a", "hold:1"], ["a", "paused"], ["b", "gate"]]);
});

test("a question that was answered is not reported, and one that comes back after going is new again", () => {
  assert.deepEqual(newQuestions([m("a", [q("gate")])], [m("a", [])]), []);
  assert.deepEqual(newQuestions([m("a", [])], [m("a", [q("gate")])]).map((n) => n.question.id), ["gate"]);
});

test("ids that would join into the same string are still told apart", () => {
  const out = newQuestions([m("a:b", [q("c")])], [m("a", [q("b:c")])]);
  assert.equal(out.length, 1);
});
