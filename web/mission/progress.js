// Progress: what the mission has done, in the ledger's order, and what it is asking. Open
// questions are pinned at the top and answered where they were asked, in the feed. The list is
// append-only like the ledger it reads, so an update adds rows at the bottom and takes the
// buttons off what has been answered; it never rebuilds, so a half-typed note survives a sweep.

/** Lamp by kind, as the mockup draws them. An answered question no longer wants anyone. */
const lampFor = (ctx, entry, open) =>
  entry.kind === "question" ? (open ? ctx.lamp("blocked", "work") : ctx.lamp("idle", "stale"))
    : entry.kind === "error" ? ctx.lamp("idle", "warm")
      : entry.kind === "response" || entry.who === "you" ? ctx.lamp("done", "work")
        : ctx.lamp("busy", "work");

/** A question's anchor: what the pins link to and what a page hash names. */
const anchorOf = (q) => `q-${q.id}`;

const tasksOf = (view) => (view.milestones ?? []).flatMap((m) => m.tasks ?? []);

export const mount = (host, view, ctx) => {
  const { el, text } = ctx;
  let current = view;
  let shown = 0;
  let lastGroup;
  let sweptAt = Date.now();
  let scrolledTo = "";
  /** Each feed row, by its index in `view.feed`, and the entry it was drawn from. */
  const rows = [];
  /** The open questions on screen, by question id: the row carrying them and the controls added to it. */
  const asked = new Map();

  const count = el("span", { class: "n" });
  const pins = el("div", { class: "prog-pins" });
  const list = el("ol", { class: "prog-feed", role: "log", "aria-label": "Mission feed" });
  /** Questions no feed entry asks (an escalation, a pause, the gate): answered here, under the feed. */
  const loose = el("ol", { class: "prog-feed prog-loose", "aria-label": "Questions not in the feed" });
  const live = el("div", { class: "prog-live" });

  const groupOf = (entry) => entry.milestone ?? lastGroup ?? "gate";
  const groupLabel = (g) => {
    if (g === "gate") return text("At the gate");
    const m = (current.milestones ?? []).find((x) => x.n === g);
    return el("b", {}, m ? `milestone ${g}, ${m.title}` : `milestone ${g}`);
  };
  const where = (taskId) => {
    const task = tasksOf(current).find((t) => t.id === taskId);
    return el("span", { class: "prog-where" }, task ? `${task.title} (${taskId})` : taskId);
  };

  const rowFor = (entry) => el("li", { class: `prog-entry ${entry.kind}` },
    el("span", { class: "prog-at" }, entry.at ? ctx.fmtTime(entry.at) : ""),
    lampFor(ctx, entry, false),
    el("span", { class: "prog-text" }, el("span", { class: "prog-who" }, entry.who), entry.text),
    entry.taskId ? where(entry.taskId) : null);

  const append = (entries) => {
    for (const entry of entries) {
      const g = groupOf(entry);
      if (g !== lastGroup) {
        lastGroup = g;
        list.append(el("li", { class: "prog-group" }, groupLabel(g)));
      }
      const li = rowFor(entry);
      rows.push({ li, entry });
      list.append(li);
    }
  };

  /** The answers as buttons and the note beside them, posted through the shell's `act`. */
  const controls = (q) => {
    const note = el("input", { type: "text", placeholder: "why, in a line; kept in the ledger", "aria-label": `Note for: ${q.title}` });
    const hint = el("span", { class: "prog-hint", role: "status" });
    const buttons = q.answers.map((a) => ctx.btn(a.label, async () => {
      const said = note.value.trim();
      const keys = a.body ?? [];
      if (keys.length && !said) {
        hint.textContent = `${a.label} needs a line of why first`;
        note.setAttribute("aria-invalid", "true");
        note.focus();
        return;
      }
      note.removeAttribute("aria-invalid");
      hint.textContent = "";
      for (const b of buttons) b.disabled = true;
      try {
        await ctx.act(a.path, Object.fromEntries(keys.map((k) => [k, said])), `${q.title}: ${a.label}`);
      } finally {
        for (const b of buttons) b.disabled = false;
      }
    }, a.primary ? "primary" : ""));
    return [el("div", { class: "prog-opts" }, ...buttons), el("div", { class: "prog-note" }, note, hint)];
  };

  /** The feed row that asks `q`: the latest question entry for its task, else for its milestone. */
  const askedIn = (q, claimed) => {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const { li, entry } = rows[i];
      if (entry.kind !== "question" || claimed.has(li)) continue;
      if (q.taskId ? entry.taskId === q.taskId : q.milestone !== undefined && entry.milestone === q.milestone) return li;
    }
    return null;
  };

  const looseRow = (q) => el("li", { class: "prog-entry question" },
    el("span", { class: "prog-at" }, q.at ? ctx.fmtTime(q.at) : ""),
    ctx.lamp("blocked", "work"),
    el("span", { class: "prog-text" }, el("span", { class: "prog-who" }, "Maverick"), `${q.title}: ${q.body}`));

  const close = (id) => {
    const on = asked.get(id);
    asked.delete(id);
    if (on.loose) return on.li.remove();
    for (const node of on.added) node.remove();
    on.li.classList.remove("open");
    on.li.removeAttribute("id");
    on.li.querySelector(".lamp").replaceWith(lampFor(ctx, on.entry, false));
  };

  const open = (q, li) => {
    const entry = rows.find((r) => r.li === li)?.entry;
    const target = li ?? looseRow(q);
    const added = controls(q);
    target.append(...added);
    target.classList.add("open");
    target.id = anchorOf(q);
    if (li) li.querySelector(".lamp").replaceWith(lampFor(ctx, entry, true));
    else loose.append(target);
    asked.set(q.id, { li: target, entry, added, loose: !li });
  };

  /** Task questions claim their rows first, so a hold on the same milestone cannot take a task's row. */
  const settleQuestions = () => {
    const questions = current.questions ?? [];
    const ids = new Set(questions.map((q) => q.id));
    for (const id of [...asked.keys()]) if (!ids.has(id)) close(id);
    const claimed = new Set();
    const ordered = [...questions.filter((q) => q.taskId), ...questions.filter((q) => !q.taskId)];
    for (const q of ordered) {
      const li = askedIn(q, claimed);
      if (li) claimed.add(li);
      const on = asked.get(q.id);
      // A question asked again (a task handed back a second time) moves to the row that asked it last.
      if (on && on.li === (li ?? on.li) && on.loose === !li) continue;
      if (on) close(q.id);
      open(q, li);
    }
    loose.hidden = !loose.children.length;
    pins.replaceChildren(...questions.map((q) => el("p", { class: "prog-pin" }, ctx.lamp("blocked", "work"),
      el("span", {}, q.title), el("a", { href: `#${anchorOf(q)}` }, "answer below"))));
  };

  /** Scroll to the question the hash names, once it is on the page; and to a new one when the hash changes. */
  const toHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id.startsWith("q-") || id === scrolledTo) return;
    const target = document.getElementById(id);
    if (!target || !host.contains(target)) return;
    scrolledTo = id;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center" });
      target.querySelector("button")?.focus({ preventScroll: true });
    });
  };

  const tick = () => {
    const s = Math.max(0, Math.round((Date.now() - sweptAt) / 1000));
    live.textContent = `swept ${s} s ago · the next entry lands here`;
  };

  const say = el("input", { type: "text", placeholder: "say something to the Strike Lead", "aria-label": "Reply to the Strike Lead" });
  const send = el("button", { type: "submit" }, "send");
  const heard = el("span", { class: "prog-heard", role: "status" });
  const reply = el("form", { class: "prog-reply", onsubmit: async (e) => {
    e.preventDefault();
    const said = say.value.trim();
    if (!said) return say.focus();
    send.disabled = true;
    heard.classList.remove("error");
    try {
      const res = await ctx.post(`/api/missions/${encodeURIComponent(ctx.missionId)}/say?project=${encodeURIComponent(ctx.projectId)}`, { text: said });
      say.value = "";
      heard.textContent = res.sent ? "the Strike Lead has it" : "kept in the ledger; no Strike Lead session is open";
    } catch (err) {
      heard.textContent = err.message;
      heard.classList.add("error");
    } finally {
      send.disabled = false;
    }
  } }, say, send, heard);

  const update = (next) => {
    current = next;
    sweptAt = Date.now();
    const feed = next.feed ?? [];
    append(feed.slice(shown));
    shown = Math.max(shown, feed.length);
    settleQuestions();
    count.textContent = `${shown} entries · live`;
    tick();
    toHash();
  };

  host.append(el("h2", { class: "prog-head" }, "Progress", count), pins, list, loose, live, reply);
  // The clock stops once the section has been on the page and left it.
  let attached = false;
  const ticker = setInterval(() => {
    if (host.isConnected) attached = true;
    else if (attached) return clearInterval(ticker);
    tick();
  }, 1000);
  window.addEventListener("hashchange", () => { scrolledTo = ""; toHash(); });
  update(view);
  return { update };
};
