// Progress: what the mission has done, one card per task, and what it is asking. Open questions
// are pinned at the top as cards and answered there. Under them each milestone holds its tasks in
// plan order, each card a timeline of its attempts, with Cory's decisions as cards of their own
// beside the task they concern; every automatic move is folded under `show every move` as the
// ledger wrote it. Nothing rebuilds: cards patch by task id, timeline lines by attempt, and the
// raw rows only append, so a half-typed note or an opened fold survives a sweep.

import { answerControls } from "../answers.js";
import { card } from "../card.js";

/** The task's lamp, as the plan draws it. */
const LAMP = { passed: ["done", "work"], flying: ["busy", "work"], built: ["busy", "action"], reviewing: ["busy", "action"], "handed-back": ["blocked", "work"], pending: ["idle", "stale"] };

/** Lamp by kind, as the mockup draws them, for the raw rows. */
const lampFor = (ctx, entry) =>
  entry.kind === "question" ? ctx.lamp("idle", "stale")
    : entry.kind === "error" ? ctx.lamp("idle", "warm")
      : entry.kind === "response" || entry.who === "you" ? ctx.lamp("done", "work")
        : ctx.lamp("busy", "work");

/** A verdict's chip in the severity it asks for: a fail is fixed, a mixed one checked, notes are fine to ship. */
const VERDICT_CLS = { fail: "fix", mixed: "check", "pass with notes": "ship" };

/** A question's anchor: what a page hash names. */
const anchorOf = (q) => `q-${q.id}`;
/** A triage row's id, cut as result.js and card.js cut it. */
const rowId = (key) => `rd-${String(key).replace(/[^a-z0-9-]/gi, "-")}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const mount = (host, view, ctx) => {
  const { el, text, fmtTime } = ctx;
  let current = view;
  let shown = 0;
  let lastGroup;
  let sweptAt = Date.now();
  let scrolledTo = "";
  /** Each milestone's block, by its number or "gate": its cards, its fold of raw moves and their count. */
  const groups = new Map();
  /** Each task's card, by task id, and its timeline's lines by attempt. */
  const tasks = new Map();
  /** The open questions on screen, by question id. */
  const asked = new Map();

  const count = el("span", { class: "n" });
  const pins = el("div", { class: "prog-pins", "aria-label": "Open questions" });
  const board = el("div", { class: "prog-board" });
  const live = el("div", { class: "prog-live" });

  /* ---------- the milestone blocks ---------- */
  const groupLabel = (g) => {
    if (g === "gate") return text("At the gate");
    const m = current.milestones.find((x) => x.n === g);
    return el("b", {}, m ? `milestone ${g}, ${m.title}` : `milestone ${g}`);
  };

  /** A block is made when first needed and placed in plan order, the gate first. */
  const groupFor = (g) => {
    if (groups.has(g)) return groups.get(g);
    const cards = el("div", { class: "prog-cards" });
    const feed = el("ol", { class: "prog-feed", role: "log", "aria-label": g === "gate" ? "Every move at the gate" : `Every move in milestone ${g}` });
    const label = el("span", {});
    const moves = el("details", { class: "prog-moves", hidden: true }, el("summary", {}, label), feed);
    const node = el("div", { class: "prog-group" }, el("h3", { class: "prog-group-head" }, groupLabel(g)), cards, moves);
    const group = { g, node, cards, feed, moves, label, n: 0 };
    groups.set(g, group);
    const order = (x) => (x === "gate" ? -Infinity : x);
    const after = [...groups.values()].filter((o) => o !== group && order(o.g) > order(g)).sort((a, b) => order(a.g) - order(b.g))[0];
    board.insertBefore(node, after?.node ?? null);
    return group;
  };

  /* ---------- the task cards ---------- */
  /** Where a chip for this task lands in Result: its first triage row of that severity, else its first row. */
  const targetOf = (taskId, cls) => {
    const readings = (current.readings ?? []).filter((r) => r.taskId === taskId);
    const r = readings.find((x) => x.severity === cls) ?? readings[0];
    return r ? rowId(r.key) : null;
  };
  const linked = (taskId) => (current.readings ?? []).some((r) => r.taskId === taskId);

  /** The chips of a task's last move: how many attempts, then what its last verdict carried. */
  const chipsOf = (taskId, moves) => {
    const last = moves.at(-1);
    const href = linked(taskId) ? `#rd-${taskId}` : undefined;
    const c = last?.counts;
    return [
      moves.length > 1 ? { text: `${moves.length} attempts` } : null,
      c?.notes ? { text: plural(c.notes, "note"), cls: "ship", href } : null,
      c?.unverified ? { text: `${c.unverified} unverified`, cls: "check", href } : null,
      c?.blockers ? { text: c.blockers === 1 ? "blocker" : `${c.blockers} blockers`, cls: "fix", href } : null,
    ].filter(Boolean);
  };

  /** One attempt as a line: `attempt 1 · out 09:42 · built 09:45 · reviewed 09:48 · pass with notes`. */
  const attemptLine = (taskId, m) => {
    const parts = [`attempt ${m.attempt}`];
    if (m.out) parts.push(`out ${fmtTime(m.out)}`);
    if (m.built) parts.push(`built ${fmtTime(m.built)}`);
    if (m.reviewed) parts.push(`reviewed ${fmtTime(m.reviewed)}`);
    if (m.end === "retry") parts.push(`retried ${fmtTime(m.ended)}`);
    else if (m.end === "handed-back") parts.push(`handed back ${fmtTime(m.ended)}`);
    else if (m.end === "passed" && !m.verdict) parts.push(`passed ${fmtTime(m.ended)}`);
    const li = el("li", { class: "prog-attempt" }, `${parts.join(" · ")}${m.verdict ? " · " : ""}`);
    if (m.verdict) {
      const cls = VERDICT_CLS[m.verdict] ?? "";
      const label = `${m.verdict}, read the triage rows for ${taskId}`;
      li.append(linked(taskId)
        ? el("a", { class: `chip ${cls}`.trim(), href: `#rd-${taskId}`, "aria-label": label }, m.verdict)
        : el("span", { class: `chip ${cls}`.trim() }, m.verdict));
    }
    return li;
  };

  /** A line is redrawn only when it would read differently; a focused verdict chip keeps its focus. */
  const patchAttempt = (t, m) => {
    const key = JSON.stringify([m, linked(m.taskId)]);
    const was = t.attempts.get(m.attempt);
    if (was?.key === key) return;
    const li = attemptLine(m.taskId, m);
    const focused = was?.li.contains(document.activeElement);
    if (was) was.li.replaceWith(li);
    else t.timeline.append(li);
    t.attempts.set(m.attempt, { li, key });
    if (focused) li.querySelector("a")?.focus({ preventScroll: true });
  };

  const settleTask = (task, milestone, moves) => {
    let t = tasks.get(task.id);
    if (!t) {
      const timeline = el("ol", { class: "prog-timeline", "aria-label": `Attempts at ${task.title}` });
      t = { timeline, attempts: new Map(), shown: "" };
      t.spec = { key: task.id, kind: "task", title: task.title };
      t.handle = card(t.spec, ctx);
      t.handle.node.classList.add("prog-task");
      t.handle.node.dataset.task = task.id;
      groupFor(milestone).cards.append(t.handle.node);
      tasks.set(task.id, t);
    }
    for (const m of moves) patchAttempt(t, m);
    const spec = { key: task.id, kind: "task", lamp: LAMP[task.status] ?? LAMP.pending, title: task.title, chips: chipsOf(task.id, moves), headline: moves.length ? t.timeline : undefined };
    const shape = JSON.stringify({ ...spec, headline: Boolean(spec.headline) });
    if (shape === t.shown) return;
    t.shown = shape;
    const focused = t.timeline.contains(document.activeElement) ? document.activeElement : null;
    t.handle.update(spec);
    focused?.focus({ preventScroll: true });
  };

  const settleTasks = () => {
    const moves = current.moves ?? [];
    for (const m of current.milestones) {
      groupFor(m.n);
      for (const task of m.tasks) settleTask(task, m.n, moves.filter((x) => x.taskId === task.id));
    }
  };

  /* ---------- the ledger's entries: decisions as cards, the rest folded ---------- */
  const groupOf = (entry) => entry.milestone ?? lastGroup ?? "gate";

  const where = (taskId) => {
    const task = current.milestones.flatMap((m) => m.tasks).find((t) => t.id === taskId);
    return el("span", { class: "prog-where" }, task ? `${task.title} (${taskId})` : taskId);
  };

  const rowFor = (entry) => el("li", { class: `prog-entry ${entry.kind}` },
    el("span", { class: "prog-at" }, entry.at ? fmtTime(entry.at) : ""),
    lampFor(ctx, entry),
    el("span", { class: "prog-text" }, el("span", { class: "prog-who" }, entry.who), entry.text),
    entry.taskId ? where(entry.taskId) : null);

  /** A decision is the person's words: its head as the title, the whole note folded under it. */
  const decisionCard = (entry, i) => {
    const cut = entry.text.indexOf(": ");
    const title = cut > 0 ? entry.text.slice(0, cut) : entry.text;
    const note = cut > 0 ? entry.text.slice(cut + 2) : undefined;
    const { node } = card({ key: `decision-${i}`, kind: "decision", title, chips: entry.at ? [{ text: fmtTime(entry.at) }] : [], detail: note }, ctx);
    node.classList.add("prog-decision");
    return node;
  };

  /** After the card of the task it concerns and any decision already there, in time order; else at the block's end. */
  const placeDecision = (group, node, taskId) => {
    let at = taskId ? tasks.get(taskId)?.handle.node : null;
    if (!at || at.parentNode !== group.cards) return group.cards.append(node);
    while (at.nextElementSibling?.classList.contains("prog-decision")) at = at.nextElementSibling;
    at.after(node);
  };

  const append = (entries, from) => {
    entries.forEach((entry, j) => {
      const g = groupOf(entry);
      lastGroup = g;
      const group = groupFor(g);
      if (entry.who === "you") return placeDecision(group, decisionCard(entry, from + j), entry.taskId);
      group.feed.append(rowFor(entry));
      group.n += 1;
      group.label.textContent = `show every move (${group.n})`;
      group.moves.hidden = false;
    });
  };

  /* ---------- the open questions ---------- */
  /** The answer row, posted through the shell's `act`. `kept` is a note carried over from the row this replaces. */
  const controls = (q, kept) => {
    const { node, note } = answerControls(q, { el, btn: ctx.btn, submit: (a, body) => ctx.act(a.path, body, `${q.title}: ${a.label}`) });
    if (note) note.value = kept;
    return node;
  };

  const offeredOf = (q) => q.answers.map((a) => a.path).join(" ");

  /** A question's card: its body, then its answers. Answers that changed (a pause, a resume) are swapped, keeping the note. */
  const settleQuestion = (q, i) => {
    let on = asked.get(q.id);
    if (!on) {
      const body = el("p", { class: "prog-ask" });
      const answers = controls(q, "");
      const headline = el("div", {}, body, answers);
      const handle = card({ key: anchorOf(q), kind: "question", lamp: ["blocked", "work"], title: q.title, headline }, ctx);
      handle.node.id = anchorOf(q);
      handle.node.classList.add("prog-q");
      on = { handle, body, answers, headline, offered: offeredOf(q), shown: "" };
      asked.set(q.id, on);
    } else if (on.offered !== offeredOf(q)) {
      const kept = on.answers.querySelector(".mv-note")?.value ?? "";
      const next = controls(q, kept);
      on.answers.replaceWith(next);
      on.answers = next;
      on.offered = offeredOf(q);
    }
    on.body.textContent = q.body ?? "";
    const shape = JSON.stringify([q.title, q.at]);
    if (shape !== on.shown) {
      on.shown = shape;
      const focused = on.headline.contains(document.activeElement) ? document.activeElement : null;
      on.handle.update({ key: anchorOf(q), kind: "question", lamp: ["blocked", "work"], title: q.title, chips: q.at ? [{ text: fmtTime(q.at) }] : [], headline: on.headline });
      focused?.focus({ preventScroll: true });
    }
    if (pins.children[i] !== on.handle.node) pins.insertBefore(on.handle.node, pins.children[i] ?? null);
  };

  const settleQuestions = () => {
    const questions = current.questions ?? [];
    const ids = new Set(questions.map((q) => q.id));
    for (const [id, on] of asked) {
      if (ids.has(id)) continue;
      on.handle.node.remove();
      asked.delete(id);
    }
    questions.forEach(settleQuestion);
    pins.hidden = !questions.length;
  };

  /* ---------- where links land ---------- */
  /** Scroll to the question the hash names, once it is on the page; and to a new one when the hash changes. */
  const toHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id.startsWith("q-") || id === scrolledTo) return;
    const target = document.getElementById(id);
    if (!target || !host.contains(target)) return;
    scrolledTo = id;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center" });
      target.querySelector("button.primary, .mv-answers button")?.focus({ preventScroll: true });
    });
  };

  /**
   * A chip names its task (`#rd-<taskId>`); the row it lands on is that task's first triage row of
   * the chip's severity in Result, whose bucket is opened if it is folded. The page's hash is left alone.
   */
  host.addEventListener("click", (e) => {
    const chip = e.target.closest?.('a.chip[href^="#rd-"]');
    if (!chip || !host.contains(chip)) return;
    e.preventDefault();
    const taskId = chip.getAttribute("href").slice(4);
    const cls = ["fix", "check", "ship"].find((c) => chip.classList.contains(c));
    const id = targetOf(taskId, cls);
    const row = (id && document.getElementById(id)) ?? document.getElementById("result");
    if (!row) return;
    for (let d = row.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
    row.scrollIntoView({ block: "center" });
    row.focus({ preventScroll: true });
  });

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
      const res = await ctx.post(ctx.actionUrl("say"), { text: said });
      say.value = "";
      heard.textContent = res.sent ? "the Strike Lead has it" : "kept in the ledger; no Strike Lead session is open";
    } catch (err) {
      heard.textContent = err.message;
      heard.classList.add("error");
    } finally {
      send.disabled = false;
    }
  } }, say, send, heard);

  /** Task cards first, so a decision about a task finds its card on the first paint. */
  const update = (next) => {
    current = next;
    sweptAt = Date.now();
    const feed = next.feed ?? [];
    settleTasks();
    append(feed.slice(shown), shown);
    shown = Math.max(shown, feed.length);
    settleQuestions();
    count.textContent = `${shown} entries · live`;
    tick();
    toHash();
  };

  host.append(el("h2", { class: "prog-head" }, "Progress", count), pins, board, live, reply);
  // A hidden tab has no one reading the clock; it catches up on the next tick that is seen.
  setInterval(() => { if (!document.hidden) tick(); }, 1000);
  window.addEventListener("hashchange", () => { scrolledTo = ""; toHash(); });
  update(view);
  return { update };
};
