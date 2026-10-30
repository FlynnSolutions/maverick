// The inbox: what a mission is asking, drawn as strips for the workspace's Needs you rack. One
// strip per open question, answered where it sits through the same routes the mission page
// posts, so the workspace and the page cannot offer different answers to one question.

import { answerControls } from "./answers.js";

/** What the state column says for each kind of question. */
const KIND = { "handed-back": "handed back", collision: "collision", landing: "landing", proof: "proof", plan: "plan", paused: "paused", gate: "gate", review: "review" };

/**
 * One strip per open question on `mission`: the lock lamp, the question as the name, its body on
 * the `strip-say` line, and its answers on a line of their own under it, as the server ordered
 * them. The acts column is 66/52/64 px, sized for one-word verbs; "send it out again" does not
 * fit it, so the answers sit where the body's width is. A note line appears above them when an
 * answer sends one, and the hint gets a line of its own under them, so a long label cannot
 * squeeze it. An answer posts to `/api/missions/<id>/<path>?project=` and then refreshes.
 *
 * `ctx` is the workspace's: `el`, `post`, `refresh`, `projectId`, and the `stripLine`, `pageStrip`
 * and `age` every strip on that page goes through, so these cannot drift from the others.
 */
export const inboxRows = (mission, ctx) => {
  const { el, stripLine, pageStrip, age } = ctx;
  const btn = (label, onclick, cls = "") => el("button", { type: "button", class: cls, onclick }, label);
  const href = `/mission.html?project=${encodeURIComponent(ctx.projectId)}&mission=${encodeURIComponent(mission.id)}`;
  const open = () => { location.href = href; };
  return mission.questions.map((q) => {
    const { buttons, note, hint } = answerControls(q, { el, btn, open: (go) => { location.href = `${href}#${go}`; }, submit: async (a, body) => {
      try {
        await ctx.post(`/api/missions/${encodeURIComponent(mission.id)}/${a.path}?project=${encodeURIComponent(ctx.projectId)}`, body);
      } catch (err) {
        hint.textContent = `${a.label} failed: ${err.message}`;
        return;
      }
      try {
        await ctx.refresh();
      } catch (err) {
        hint.textContent = `${a.label} was sent; the workspace did not redraw: ${err.message}`;
      }
    } });
    hint.classList.add("empty");
    return pageStrip({ status: "blocked", title: `${q.title} · ${mission.name}`, open },
      stripLine({
        status: "blocked",
        name: el("h4", { class: "strip-name", title: q.title }, q.title),
        state: KIND[q.kind] ?? q.kind,
        when: age(Date.parse(q.at)),
        where: mission.name,
        acts: [el("button", { type: "button", class: "act", title: "open this mission", onclick: open }, "open")],
      }),
      el("div", { class: "strip-say" },
        el("p", { class: "claude" }, el("span", { class: "who" }, "asks"), q.body),
        note ? el("p", {}, el("span", { class: "who" }, "note"), note) : null,
        el("p", {}, el("span", { class: "who" }, "answer"), el("span", { class: "inbox-answers" }, ...buttons)),
        el("p", {}, el("span", { class: "who" }), hint)));
  });
};
