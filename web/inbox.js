// The inbox: what a mission is asking, drawn as strips for the workspace's Needs you rack. One
// strip per open question, answered where it sits through the same routes the mission page
// posts, so the workspace and the page cannot offer different answers to one question.

/** What the state column says for each kind of question. */
const KIND = { "handed-back": "handed back", collision: "collision", landing: "landing", proof: "proof", plan: "plan", paused: "paused", gate: "gate" };

const ago = (at) => {
  const ms = Date.parse(at);
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/**
 * Only the answers the server will take (Cory's call on m1-t1), as the mission page's progress
 * module filters them: never `release` on a landing hold, since landing again is its release, and
 * while the mission is paused only the pause itself offers `resume`. The primary answer first.
 */
const answersFor = (q, paused) => q.answers
  .filter((a) => !(q.kind === "landing" && a.path.endsWith("/release")) && !(paused && q.id !== "paused" && a.path === "resume"))
  .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));

/**
 * One strip per open question on `mission`: the lock lamp, the question as the name, its body on
 * the `strip-say` line, and its answers on a row of their own under it, the primary first. The
 * acts column is 66/52/64 px, sized for one-word verbs; "send it out again" does not fit it, so
 * the answers sit where the body's width is and the column is left empty to hold the grid. A note
 * field appears above them when an answer sends one. An answer posts to
 * `/api/missions/<id>/<path>?project=` and then refreshes. The strip opens the mission on click,
 * Enter or Space, as every page strip on the workspace does.
 */
export const inboxRows = (mission, ctx) => {
  const { el } = ctx;
  // The paused question is there exactly when the mission is paused, so it says so without the status.
  const paused = (mission.questions ?? []).some((q) => q.id === "paused");
  const href = `/mission.html?project=${encodeURIComponent(ctx.projectId)}&mission=${encodeURIComponent(mission.id)}`;
  return (mission.questions ?? []).map((q) => {
    const answers = answersFor(q, paused);
    const wanted = answers.some((a) => a.body?.length);
    const note = wanted ? el("input", { type: "text", placeholder: "why, in a line; kept in the ledger", "aria-label": `Note for: ${q.title}` }) : null;
    const hint = el("span", { class: "empty", role: "status" }, answers.length ? "" : "resume the mission first");
    const settle = (said) => {
      hint.textContent = said;
      for (const b of buttons) b.disabled = false;
    };
    const buttons = answers.map((a) => el("button", {
      type: "button",
      class: a.primary ? "primary" : "",
      title: `${a.label}: ${q.title}`,
      onclick: async () => {
        const said = note?.value.trim() ?? "";
        const keys = a.body ?? [];
        if (keys.length && !said) {
          hint.textContent = `${a.label} needs a line of why first`;
          note.setAttribute("aria-invalid", "true");
          note.focus();
          return;
        }
        note?.removeAttribute("aria-invalid");
        hint.textContent = "";
        for (const b of buttons) b.disabled = true;
        try {
          await ctx.post(`/api/missions/${encodeURIComponent(mission.id)}/${a.path}?project=${encodeURIComponent(ctx.projectId)}`, Object.fromEntries(keys.map((k) => [k, said])));
        } catch (err) {
          settle(`${a.label} failed: ${err.message}`);
          return;
        }
        try {
          await ctx.refresh();
        } catch (err) {
          settle(`${a.label} was sent; the workspace did not redraw: ${err.message}`);
        }
      },
    }, a.label));
    const open = () => { location.href = href; };
    return el("article", {
      class: "strip blocked full",
      "data-mission": mission.id,
      "data-question": q.id,
      tabindex: "0",
      title: `${q.title} · ${mission.name}`,
      onclick: (e) => { if (!e.target.closest("button, input, a")) open(); },
      onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } },
    },
      el("div", { class: "strip-line" },
        ctx.lamp("blocked"),
        el("div", { class: "strip-id" }, el("h4", { class: "strip-name", title: q.title }, q.title)),
        el("span", { class: "strip-state", title: KIND[q.kind] ?? q.kind }, el("b", {}, KIND[q.kind] ?? q.kind)),
        el("span", { class: "strip-when", title: q.at }, ago(q.at)),
        el("span", { class: "strip-where", title: mission.name }, el("a", { href }, mission.name)),
        el("div", { class: "strip-acts" })),
      el("div", { class: "strip-say" },
        el("p", { class: "claude" }, el("span", { class: "who" }, "asks"), q.body),
        note ? el("p", {}, el("span", { class: "who" }, "note"), note) : null,
        el("p", {}, el("span", { class: "who" }, "answer"), ...buttons, hint)));
  });
};
