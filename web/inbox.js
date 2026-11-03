// The inbox: what a mission is asking, drawn inside that mission's own strip on the workspace. A
// mission is one strip, named by the mission, wherever it sits; its open questions are lines under
// it, each with its answers, answered where they sit through the same routes the mission page
// posts, so the workspace and the page cannot offer different answers to one question.

import { answerControls } from "./answers.js";
import { toast } from "./toast.js";

/**
 * The lines under a mission's strip for each open question: what it asks (its title, then its
 * body), the note an answer sends when one does, and the answers as the server ordered them, with
 * the hint for a missing note on a line of its own. An answer posts to
 * `/api/missions/<id>/<path>?project=`, says what it did in a toast (an error stays until closed),
 * and refreshes; one with `go` opens the mission page at that place.
 *
 * `ctx` is the workspace's: `el`, `post`, `refresh`, `projectId`.
 */
export const questionLines = (mission, ctx) => {
  const { el } = ctx;
  const btn = (label, onclick, cls = "") => el("button", { type: "button", class: cls, onclick }, label);
  const href = `/mission.html?project=${encodeURIComponent(ctx.projectId)}&mission=${encodeURIComponent(mission.id)}`;
  return mission.questions.map((q) => {
    const { buttons, note, hint } = answerControls(q, { el, btn, open: (go) => { location.href = `${href}#${go}`; }, submit: async (a, body) => {
      try {
        await ctx.post(`/api/missions/${encodeURIComponent(mission.id)}/${a.path}?project=${encodeURIComponent(ctx.projectId)}`, body);
      } catch (err) {
        toast(`Could not ${a.label} on ${mission.name}: ${err.message}`, { error: true });
        return;
      }
      toast(`${mission.name}: ${a.label}`);
      try {
        await ctx.refresh();
      } catch (err) {
        toast(`${a.label} was sent; the workspace did not redraw: ${err.message}`, { error: true });
      }
    } });
    hint.classList.add("empty");
    return el("div", { class: "strip-say inbox-q", "data-question": q.id },
      el("p", { class: "claude" }, el("span", { class: "who" }, "asks"), el("span", {}, el("b", {}, q.title), q.body ? el("span", { class: "inbox-body" }, q.body) : null)),
      note ? el("p", {}, el("span", { class: "who" }, "note"), note) : null,
      el("p", {}, el("span", { class: "who" }, "answer"), el("span", { class: "inbox-answers" }, ...buttons)),
      el("p", {}, el("span", { class: "who" }), hint));
  });
};
