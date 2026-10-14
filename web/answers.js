// The one answer row every page draws for a question: its buttons, the note an answer sends,
// the empty-note check and the posting state. The server emits each question's answers already
// filtered and ordered (primary first, only what it will accept in the mission's state), so this
// renders them as given and never re-sorts or drops one. The inbox, the plan and the feed differ
// only in what `submit` does with the answer.

/**
 * answerControls(question, { el, btn, submit }) → { node, hint, buttons, note }
 *   submit(answer, body)  awaited with the buttons disabled; `body` is the note under each key
 *                         the answer names, so a caller posts it as it is or wraps it
 *   node                  the row: the buttons, then the note and the hint on a line of their own
 *   hint                  the status span, which the caller may fill
 *   buttons, note         the parts, for a page that lays the row out on its own grid (the inbox)
 */
export const answerControls = (question, { el, btn, submit }) => {
  const answers = question.answers;
  const wanted = answers.some((a) => a.body?.length);
  const note = wanted ? el("input", { type: "text", class: "mv-note", placeholder: "why, in a line; kept in the ledger", "aria-label": `Note for: ${question.title}` }) : null;
  // A question with nothing the server would take is what a paused mission leaves on every question but the pause.
  const hint = el("span", { class: "mv-hint", role: "status" }, answers.length ? "" : "resume the mission first");
  const buttons = answers.map((a) => btn(a.label, async () => {
    const said = note?.value.trim() ?? "";
    if (a.body?.length && !said) {
      hint.textContent = `${a.label} needs a line of why first`;
      note.setAttribute("aria-invalid", "true");
      note.focus();
      return;
    }
    note?.removeAttribute("aria-invalid");
    hint.textContent = "";
    for (const b of buttons) b.disabled = true;
    try {
      await submit(a, Object.fromEntries((a.body ?? []).map((k) => [k, said])));
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  }, a.primary ? "primary" : ""));
  const node = el("div", { class: "mv-answers" },
    el("div", { class: "mv-opts" }, ...buttons),
    note ? el("div", { class: "mv-note-row" }, note, hint) : hint);
  return { node, hint, buttons, note };
};
