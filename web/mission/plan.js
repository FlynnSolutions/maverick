// The plan, as the mission page mounts it after approval: one step per milestone with a status
// word, one row per task with its intent, and the handed-back task's question answered in place.
// The page keeps a stream open and calls update() on every event, so nothing here rebuilds: rows
// are patched by id, and a session opened under a row is still open after the next event.

import { answerControls } from "../answers.js";
import { stopWalkthrough, walkthroughPanel } from "../walkthrough.js";

/** The task's lamp and word, the map in /mockups/mission.html; Progress draws the same lamp on its cards. `built` is between the two: the Wingman is done and its RIO is on the way. */
export const LAMP = { passed: ["done", "work"], flying: ["busy", "work"], built: ["busy", "action"], reviewing: ["busy", "action"], "handed-back": ["blocked", "work"], pending: ["idle", "stale"] };
const WORD = { passed: "done", flying: "working", built: "built", reviewing: "in review", "handed-back": "waiting for you", pending: "waiting" };
const STEP_LAMP = { done: ["done", "work"], waiting: ["blocked", "work"], working: ["busy", "work"], pending: ["idle", "stale"] };
/** The states with a session worth opening: a Wingman flying, a RIO reading, or the last of either before it was handed back. */
const LIVE = new Set(["flying", "reviewing", "handed-back"]);

const stepState = (m) =>
  m.merged ? "done"
    : m.hold || m.tasks.some((t) => t.status === "handed-back") ? "waiting"
      : m.dispatched || m.tasks.some((t) => t.status !== "pending") ? "working"
        : "pending";
/** A milestone started early has no dispatch stamp; its first task's start stands in. */
const since = (m) => m.dispatched ?? m.tasks.map((t) => t.started).filter(Boolean).sort()[0];

export const mount = (host, view, ctx) => {
  const { el, text, btn, lamp, fmtTime, act, post, actionUrl, openSession, projectId } = ctx;
  const steps = new Map();
  const rows = new Map();
  let current = view;

  const stepWord = (m, s) =>
    s === "done" ? `done ${fmtTime(m.merged)}`
      : s === "waiting" ? "waiting for you"
        : s === "working" ? (since(m) ? `working since ${fmtTime(since(m))}` : "working")
          : "not started";
  const titleOf = (id) => current.milestones.flatMap((m) => m.tasks).find((t) => t.id === id)?.title ?? id;
  const waitsOn = (task) => {
    if (task.status !== "pending") return [];
    const passed = new Set(current.milestones.flatMap((m) => m.tasks).filter((t) => t.status === "passed").map((t) => t.id));
    return (task.needs ?? []).filter((id) => !passed.has(id));
  };
  const swapLamp = (holder, [status, band]) => {
    const key = `${status} ${band}`;
    if (holder.dataset.lamp === key) return;
    holder.dataset.lamp = key;
    holder.replaceChildren(lamp(status, band));
  };

  /* ---------- the handed-back task's question, answered in the row ---------- */
  const answersFor = (task, question) => el("div", { class: "plan-answers" },
    answerControls(question, { el, btn, submit: (a, body) => act(a.path, body, `${task.title}: ${a.label}`) }).node);

  /* ---------- a task row ---------- */
  const makeRow = (task) => {
    const r = {
      lamp: el("span", { class: "plan-lamp" }),
      title: el("span", { class: "t" }),
      intent: el("span", { class: "i" }),
      word: el("span", { class: "w" }),
      answers: el("div", { class: "plan-q" }),
      session: el("div", { class: "plan-session" }),
      wordKey: "",
      question: "",
    };
    r.li = el("li", { "data-task": task.id }, r.lamp, r.title, r.intent, r.word, r.answers, r.session);
    rows.set(task.id, r);
    return r;
  };
  const patchRow = (task) => {
    const r = rows.get(task.id) ?? makeRow(task);
    r.li.className = task.status;
    swapLamp(r.lamp, LAMP[task.status] ?? LAMP.pending);
    r.title.textContent = task.title;
    r.title.title = task.title;
    r.intent.textContent = task.intent ?? "";
    r.intent.title = task.intent ?? "";
    r.intent.hidden = !task.intent;
    const waits = waitsOn(task);
    // The word is rebuilt only when it would read differently, the way the lamp is swapped.
    const wordKey = JSON.stringify([task.status, task.attempts, waits]);
    if (wordKey !== r.wordKey) {
      r.wordKey = wordKey;
      r.word.replaceChildren(
        el("b", { class: task.status === "handed-back" ? "needs" : task.status === "passed" ? "ok" : "" }, WORD[task.status] ?? task.status),
        task.attempts ? ` · attempt ${task.attempts}` : "",
        ...(waits.length ? [el("br"), `after ${waits.map(titleOf).join(", ")}`] : []),
        ...(LIVE.has(task.status) ? [el("br"), el("a", { href: "#", onclick: (e) => { e.preventDefault(); openSession(task.id, r.session); } }, "open the session")] : []));
    }
    // The answers are rebuilt only when the question itself changes, so a half-written note survives the next event.
    const question = task.status === "handed-back" ? (current.questions ?? []).find((q) => q.taskId === task.id) : null;
    const key = question ? JSON.stringify([question.id, question.answers]) : "";
    if (key !== r.question) {
      r.question = key;
      r.answers.replaceChildren(...(question ? [answersFor(task, question)] : []));
    }
    r.answers.hidden = !question;
    // A task that has left the live states has no session worth watching; the page lets go of a screen that leaves it.
    if (!LIVE.has(task.status)) r.session.replaceChildren();
    return r.li;
  };

  /* ---------- the walkthrough under a done milestone, as today's walkthroughSection has it ---------- */
  const walkPath = (n) => `milestones/${n}/walkthrough`;
  /** Not the answer row: a waiver's note is kept on the milestone, not in the ledger, and its line says so. */
  const waiveRow = (m) => {
    const note = el("input", { type: "text", class: "mv-note", placeholder: "why it is let through unwalked; kept on the milestone", "aria-label": `why milestone ${m.n} is waived` });
    note.addEventListener("input", () => note.removeAttribute("aria-invalid"));
    return el("div", { class: "mv-note-row" }, note, btn("waive it", async () => {
      if (!note.value.trim()) {
        note.focus();
        note.setAttribute("aria-invalid", "true");
        return;
      }
      await act(walkPath(m.n), { waive: { note: note.value.trim() } }, `milestone ${m.n} waived`);
    }, "ghost"));
  };
  const walkHead = (label) => el("h4", {}, "Walkthrough", el("span", { class: "plan-walk-meta" }, label));
  const walkBody = (m) => {
    const w = m.walkthrough;
    const walk = current.walk?.[m.n] ?? { state: "none", needed: false };
    if (walk.state === "none") {
      return walk.needed
        ? [walkHead("not built"), el("p", {}, "This milestone merged before walkthroughs existed, so there is no document to walk. Waive it to let the mission land."), waiveRow(m)]
        : [];
    }
    if (walk.state === "waived") return [walkHead(`waived ${fmtTime(w.waived.at)}`), el("p", {}, w.waived.note)];
    if (walk.state === "failed") return [walkHead("no document"), el("p", { class: "warn" }, w.failed), waiveRow(m), el("p", { class: "plan-walk-meta" }, "or write the document yourself on the mission branch and reopen this page")];
    if (walk.state === "building") {
      return [walkHead(`session ${w.claudeId} · since ${fmtTime(w.started)}`),
        el("p", {}, "A session is writing the test walkthrough for this milestone in the integration worktree. When it has committed the document, it shows here for you to walk.")];
    }
    const url = `/files?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(w.doc)}`;
    const said = el("p", { class: "plan-walk-meta", hidden: true });
    const panel = walkthroughPanel({ el, fmtTime, url, doc: w.doc, saved: w.progress, onSave: async (progress) => {
      w.progress = progress;
      try {
        await post(actionUrl(walkPath(m.n)), { progress: { total: progress.total, answered: progress.answered, verdicts: progress.verdicts, updatedAt: progress.updatedAt } });
        said.classList.remove("warn");
        said.textContent = progress.answered >= progress.total ? `milestone ${m.n} walked` : "";
        said.hidden = !said.textContent;
      } catch (e) {
        said.classList.add("warn");
        said.textContent = e.message;
        said.hidden = false;
      }
    } });
    if (walk.state === "walked") panel.querySelector("h2").append(el("span", { class: "verdict passed" }, "walked"));
    return [panel, said, walk.state === "walked" ? null : waiveRow(m)];
  };
  /**
   * The walkthrough panel keeps one clock and one storage listener for the whole page, so only
   * one may be mounted: it is built when its milestone is opened and dropped when another is.
   */
  let walking = null;
  /** Letting go of the mounted panel stops its clock too, or it goes on saving for a panel no longer on the page. */
  const letGo = (s) => {
    if (walking !== s) return;
    walking = null;
    stopWalkthrough();
  };
  const patchWalk = (s) => {
    const m = s.m;
    const walk = current.walk?.[m.n] ?? { state: "none", needed: false };
    const key = m.merged ? JSON.stringify([walk.state, walk.needed, m.walkthrough?.doc, m.walkthrough?.claudeId, m.walkthrough?.waived, m.walkthrough?.failed]) : "";
    const lazy = walk.state === "walking" || walk.state === "walked";
    if (lazy && !s.details.open) {
      letGo(s);
      s.walkKey = "";
      s.walk.replaceChildren();
      s.walk.hidden = true;
      return;
    }
    if (key === s.walkKey) return;
    s.walkKey = key;
    if (lazy) {
      if (walking && walking !== s) walking.details.open = false;
      walking = s;
    } else letGo(s);
    const nodes = key ? walkBody(m).filter(Boolean) : [];
    s.walk.replaceChildren(...nodes);
    s.walk.hidden = !nodes.length;
  };

  /* ---------- a milestone step ---------- */
  const makeStep = (m) => {
    const s = {
      lamp: el("span", { class: "plan-lamp" }),
      n: el("span", { class: "n" }),
      title: text(""),
      word: el("span", { class: "w" }),
      gives: el("p", { class: "gives" }),
      tasks: el("ul", { class: "tasks" }),
      walk: el("div", { class: "plan-walk", hidden: true }),
      walkKey: "",
      state: "",
      m,
    };
    s.details = el("details", { class: "step" },
      el("summary", {}, s.lamp, el("h3", {}, s.n, s.title), s.word),
      el("div", { class: "body" }, s.gives, s.tasks, s.walk));
    s.details.addEventListener("toggle", () => patchWalk(s));
    s.li = el("li", { "data-milestone": String(m.n) }, s.details);
    steps.set(m.n, s);
    return s;
  };
  const patchStep = (m) => {
    const s = steps.get(m.n) ?? makeStep(m);
    s.m = m;
    const state = stepState(m);
    // Open unless done, decided when the step first shows and again when it becomes done; a step you opened or closed yourself stays as you left it.
    if (state !== s.state && (s.state === "" || state === "done")) s.details.open = state !== "done";
    s.state = state;
    s.details.className = `step ${state}`;
    swapLamp(s.lamp, STEP_LAMP[state]);
    s.n.textContent = `Milestone ${m.n}`;
    s.title.textContent = m.title;
    s.word.textContent = stepWord(m, state);
    s.gives.textContent = m.done ? `Done when ${m.done}` : "";
    s.gives.hidden = !m.done;
    const ids = m.tasks.map((t) => t.id);
    for (const [id, r] of rows) if (r.li.parentElement === s.tasks && !ids.includes(id)) { r.li.remove(); rows.delete(id); }
    m.tasks.forEach((t, i) => {
      const li = patchRow(t);
      if (s.tasks.children[i] !== li) s.tasks.insertBefore(li, s.tasks.children[i] ?? null);
    });
    patchWalk(s);
    return s.li;
  };

  const count = el("span", { class: "n" });
  const list = el("ol", { class: "plan-steps" });
  host.append(el("h2", { class: "plan-head" }, "Plan", count), list);

  const update = (next) => {
    current = next;
    const milestones = next.milestones;
    const taskCount = milestones.flatMap((m) => m.tasks).length;
    count.textContent = [
      `${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`,
      `${taskCount} task${taskCount === 1 ? "" : "s"}`,
      next.approved ? `approved ${fmtTime(next.approved)}` : null,
    ].filter(Boolean).join(" · ");
    const ns = milestones.map((m) => m.n);
    for (const [n, s] of steps) if (!ns.includes(n)) { letGo(s); s.li.remove(); steps.delete(n); }
    milestones.forEach((m, i) => {
      const li = patchStep(m);
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] ?? null);
    });
  };
  update(view);
  return { update };
};
