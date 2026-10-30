// The mission page: one mission, saved, revisitable. Four fixed anchors down the left (The ask,
// Plan, Progress, Result) and the status in one word above them, the same four places before,
// during and after. Cory is in the loop exactly twice and both gates live here: the plan he
// blesses before anything spawns, and the finished mission he reads and tests.

/**
 * The module contract. Plan, Progress and Result are each a module the shell loads once the
 * plan is approved:
 *
 *   web/mission/<name>.js exports
 *     mount(host: Element, view: MissionView, ctx): { update(view: MissionView): void }
 *   web/mission/<name>.css is its stylesheet, linked from mission.html.
 *
 * `host` is the module's own `<section>` (#plan, #progress, #result). The module owns
 * everything inside it, its heading included; the shell never writes into it after the mount.
 * An `h2` written directly under the section takes the shell's section-heading style.
 * `view` is the JSON of GET /api/missions/:id. `update(view)` is called on every stream event
 * and must patch in place, so an open session or a half-typed note survives it.
 *
 * `ctx` is { el, text, btn, lamp, post, act, actionUrl, LANDS, projectId, missionId, openSession, mountTerminal, thread, now, fmtTime, plural, armed, approveWhy, failingNote, reveal }:
 *   el(tag, attrs, ...children)  builds an element; `on*` attrs are listeners, nulls are dropped
 *   text(s), btn(label, onclick, cls)
 *   lamp(status, band)           web/lamp.js's lamp
 *   post(path, body)             fetch JSON; throws with the server's error on a non-2xx
 *   act(path, body, said)        posts to actionUrl(path), says `said` in a toast (or the error,
 *                                in one that stays until closed), and lets the stream refresh
 *                                every module; resolves to whether the post went through
 *   actionUrl(path)              /api/missions/<id>/<path>?project=
 *   LANDS[land](base)            the sentence for where a repo's work lands
 *   projectId, missionId
 *   openSession(taskId, under)   mounts the task's session (its RIO's while it is reviewing,
 *                                its Wingman's otherwise) as a terminal under `under`
 *   mountTerminal(host, id)      one of the server's terminals, live, inside `host`
 *   thread                       the Strike Lead's chat (web/mission/lead.js), owned and updated
 *                                by the shell; a module only places `thread.node`
 *   now                          the slot at the top of the page for what is waiting on you, the
 *                                one place outside its section a module may write: Progress puts
 *                                the open questions there, so they are the first thing on the page,
 *                                and Result puts what to fix or decide before the merge there at review
 *   fmtTime(iso)                 a clock time, or "" for none
 *   plural(n, word)              `1 note`, `2 notes`
 *   armed({ label, cls, why, yes, onYes })  an irreversible action asked twice, focus on "not yet"
 *   approveWhy(doc)              what firing the mission does, in one sentence
 *   failingNote(checks, where, verb)  the failed preflight checks, beside the button they should stop
 *   reveal(key)                  asks the Result module to unfold and focus a finding's card; a
 *                                Result without `reveal` on its handle makes it a no-op
 *
 * A module's handle may carry more than `update`; `reveal(key)` is the one the shell routes.
 */

import { lamp } from "./lamp.js";
import { applyProjectTheme, recall } from "./theme.js";
import { jetSvg } from "./jet.js";
import { mountDevBadge } from "./dev-badge.js";
import { inline, render as renderMarkdown } from "./markdown.js";
import { leadThread } from "./mission/lead.js";
import { atReview, isEnded } from "./mission/state.js";
import { toast } from "./toast.js";
import { foldable } from "./card.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "hidden") node.hidden = Boolean(v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};
const text = (s) => document.createTextNode(s);
/** replaceChildren stringifies a null into the word "null"; el() filters. A section's contents go through here. */
const fill = (host, ...nodes) => host.replaceChildren(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
const btn = (label, onclick, cls = "") => el("button", { type: "button", class: cls, onclick }, label);
const api = async (path, init) => {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${res.status} on ${path}`);
  return body;
};
const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const setStatus = (msg, isError = false) => {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
};
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A check that failed, said beside the button it should stop you pressing: in the gate and in the chat alike. */
const failingNote = (checks, where, verb) => {
  const failing = checks?.filter((c) => c.status === "fail" && !c.refuses) ?? [];
  return failing.length ? el("p", { class: "mv-warn" }, `${plural(failing.length, "check")} failed ${where} (${failing.map((c) => c.name).join(", ")}); read ${failing.length === 1 ? "it" : "them"} before you ${verb}.`) : null;
};

/** What firing does, said the same way wherever it is asked. */
const approveWhy = (doc) => `This writes ${plural(doc.cost.tasks, "item")} into the tracker and spawns ${plural(doc.cost.sessions, "background session")} over the mission's life. After this you are asked only to walk each milestone; the close comes with the last walk.`;

/**
 * An irreversible action asked twice: the first press arms it, says what it does and moves focus
 * to "not yet"; "not yet" puts the arm back and focuses it. Firing a mission is asked this way in
 * the gate and in the Strike Lead's chat alike.
 */
let armedCount = 0;
const armed = ({ label, cls = "", why, yes, onYes }) => {
  const box = el("div", { class: "mv-confirm" });
  const whyId = `armed-why-${(armedCount += 1)}`;
  const arm = btn(label, () => {
    const back = btn("not yet", () => { fill(box, arm); arm.focus(); }, "ghost");
    // Disabled and marked busy while the request runs, so a second press cannot send it twice.
    const go = btn(yes, async () => {
      go.disabled = back.disabled = true;
      go.setAttribute("aria-busy", "true");
      try {
        await onYes();
      } finally {
        go.disabled = back.disabled = false;
        go.removeAttribute("aria-busy");
      }
    }, "primary");
    if (why) go.setAttribute("aria-describedby", whyId);
    fill(box, why ? el("p", { class: "why", id: whyId }, why) : null, el("div", { class: "mv-confirm-row" }, go, back));
    back.focus();
  }, `primary ${cls}`.trim());
  box.append(arm);
  return box;
};

const params = new URLSearchParams(location.search);
const projectId = params.get("project");
const missionId = params.get("mission");
let mission = null;
let projectName = "";
let baseTitle = "";

const ended = () => isEnded(mission?.status);
const missionUrl = () => `/api/missions/${encodeURIComponent(missionId)}?project=${encodeURIComponent(projectId)}`;
const actionUrl = (action) => `/api/missions/${encodeURIComponent(missionId)}/${action}?project=${encodeURIComponent(projectId)}`;

/* ---------- theme, on the board's terms: its mode, its project palette, its computed ink ---------- */
const applyTheme = (theme) => {
  const mode = recall("mv.theme", "");
  if (mode) document.documentElement.setAttribute("data-theme", mode);
  if (!theme || recall("mv.projectTheme", "1") === "0") return;
  applyProjectTheme(document.documentElement.style, theme);
  if (theme.font !== "Chakra Petch") document.head.append(el("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font).replace(/%20/g, "+")}:wght@500;600;700&display=swap` }));
};

/* ---------- terminals inside the mission's own view: a session's screen, the Strike Lead's raw session ---------- */
let attached = [];
const detachTerminal = () => {
  for (const a of attached) {
    a.source.close();
    a.term.dispose();
  }
  attached = [];
  watching.clear();
};
const mountTerminal = (host, terminalId) => {
  const term = new window.Terminal({ fontFamily: "JetBrains Mono, Menlo, monospace", fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, theme: { background: "#0a0c0f", foreground: "#e8ecf1" } });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  const source = new EventSource(`/api/terminals/${terminalId}/stream`);
  source.onmessage = (e) => term.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
  source.addEventListener("exit", () => { term.write("\r\n\x1b[2m[the Strike Lead's session ended]\x1b[0m\r\n"); source.close(); });
  term.onData((data) => fetch(`/api/terminals/${terminalId}/input`, { method: "POST", body: data, keepalive: true }).catch(() => {}));
  term.onResize(({ cols, rows }) => post(`/api/terminals/${terminalId}/resize`, { cols, rows }).catch(() => {}));
  // xterm measures its own box, so fit after the new geometry has actually landed.
  requestAnimationFrame(() => { fit.fit(); term.focus(); });
  const held = { term, fit, source };
  attached.push(held);
  return held;
};
window.addEventListener("resize", () => { for (const a of attached) requestAnimationFrame(() => a.fit.fit()); });

/**
 * A session's own screen, inside the task it belongs to. A mission runs six or more agents for
 * two hours; not being able to look at any of them is the difference between steering it and
 * hoping. Attaching is read-and-write: it is a real terminal, so you can take the stick.
 */
const watching = new Map();
/** Let one session go without tearing down the others. */
const stopWatching = (claudeId) => {
  const held = watching.get(claudeId);
  if (held && held !== true) {
    held.source.close();
    held.term.dispose();
    attached = attached.filter((a) => a !== held);
  }
  watching.delete(claudeId);
};
const watchSession = async (host, claudeId, title) => {
  if (watching.has(claudeId)) return;
  watching.set(claudeId, true);
  try {
    const open = await api("/api/terminals");
    const existing = open.find((t) => t.exitCode === null && t.command.join(" ") === `claude attach ${claudeId}`);
    const info = existing ?? (await post("/api/terminals", { project: projectId, kind: "attach", id: claudeId, title, cols: 110, rows: 28 }));
    host.replaceChildren();
    watching.set(claudeId, mountTerminal(host, info.id));
  } catch (err) {
    watching.delete(claudeId);
    host.replaceChildren(el("p", { class: "mv-empty" }, `could not attach: ${err.message}`));
  }
};
/**
 * A module patches its own rows and may drop the one a session was opened under. The terminal
 * would go on streaming into a detached node, so a session whose screen has left the page is let go.
 */
const reapSessions = () => {
  for (const [claudeId, held] of watching) if (held !== true && !held.term.element?.isConnected) stopWatching(claudeId);
};

/** ctx.openSession: the task's session under the element the module passes, with its own way to close. */
const allTasks = () => mission.milestones.flatMap((m) => m.tasks);
const openSession = (taskId, under) => {
  const task = allTasks().find((t) => t.id === taskId);
  const claudeId = task?.status === "reviewing" ? task.review?.claudeId : task?.claudeId ?? task?.review?.claudeId;
  if (!claudeId) {
    toast(`${task?.title ?? taskId} has no session to open`, { error: true });
    return;
  }
  if (watching.has(claudeId)) {
    toast(`${task.title}'s session is already open on this page`);
    return;
  }
  const screen = el("div", { class: "term" });
  const well = el("div", { class: "mv-session" },
    el("div", { class: "mv-session-head" }, el("span", { class: "muted small mono" }, `session ${claudeId}`), btn("stop watching", () => { stopWatching(claudeId); well.remove(); }, "ghost")),
    screen);
  under.append(well);
  watchSession(screen, claudeId, task.title);
};

/* ---------- data ---------- */
/** What each action is called when it fails, so the toast says which one did not go through. */
const ACTION_NAMES = [[/^approve$/, "approve the plan"], [/^pause$/, "pause the mission"], [/^resume$/, "resume the mission"], [/^abandon$/, "stop the mission"], [/^close$/, "close the mission"], [/^land$/, "land the work"], [/^summarize$/, "ask for the summary"], [/\/retry$/, "send the task out again"], [/\/accept$/, "accept the task"], [/\/release$/, "release the milestone"], [/\/readings$/, "mark the finding"], [/\/walkthrough$/, "save the walk"]];
const READING = { read: "mark the findings read", unread: "mark the finding unread", later: "put the finding on the checklist" };
const actionName = (action, body) => (/readings$/.test(action) && READING[body?.state]) || ACTION_NAMES.find(([re]) => re.test(action))?.[1] || action;
/** Posts an action and says what it did; returns whether it went through, for a caller that holds a state until then. */
const act = async (action, body, said) => {
  try {
    await post(actionUrl(action), body);
    toast(said);
    // On the stream the server's own flush lands the change; only the 8 s fallback has to ask.
    if (!streaming) await load();
    return true;
  } catch (err) {
    toast(`Could not ${actionName(action, body)}: ${err.message}`, { error: true });
    return false;
  }
};

/** Where a repo's work goes when the mission is done, said the same way at both gates. */
const LANDS = {
  merge: (base) => `stays on the mission branch; nothing touches ${base}`,
  pr: (base) => `a pull request against ${base}, merged by you`,
  push: (base) => `${base} is advanced to it and pushed`,
};

const reveal = (key) => mounted.get("result")?.reveal?.(key);

const ctx = { el, text, btn, lamp, post, act, actionUrl, LANDS, projectId, missionId, openSession, mountTerminal, now: $("#now"), fmtTime, plural, armed, approveWhy, failingNote, reveal };
// One thread for the mission's whole life: in Plan before approval, placed in Progress after, never rebuilt.
ctx.thread = leadThread(ctx);

/* ---------- the rail: one word, four anchors, and the brakes ---------- */
const WORD = {
  "waiting for you": { cls: "caution", lamp: ["blocked", "work"] },
  done: { cls: "hud", lamp: ["done", "work"] },
  stopped: { cls: "", lamp: ["idle", "stale"] },
  error: { cls: "threat", lamp: ["idle", "warm"] },
  working: { cls: "", lamp: ["busy", "work"] },
};
/** `#gate` (where the lamp points before approval) lands on the gate with its verb focused, as `#round` lands on a round. */
const toGate = () => {
  const verb = location.hash === "#gate" ? document.querySelector("#gate .mv-confirm button") : null;
  if (!verb) return;
  // The verb, not the gate's top, comes into view: the gate is taller than a phone's screen.
  requestAnimationFrame(() => {
    verb.scrollIntoView({ block: "center" });
    verb.focus({ preventScroll: true });
  });
};

/** What waits on the person: the server's questions, an open interview round and the gate among them. */
const waiting = () => mission.questions?.length ?? 0;
/** A stopped mission is not a finished one: "done" in the good colour is for work that landed. */
const wordOf = () => (mission.status === "abandoned" && mission.word !== "error" ? "stopped" : mission.word ?? "working");
const renderWord = () => {
  const word = wordOf();
  const look = WORD[word] ?? WORD.working;
  const open = waiting();
  const chip = $("#word");
  chip.className = `mv-word ${look.cls}`;
  // The loudest thing on the page goes to what it is loud about: the first question's own place when it
  // names one, the gate's verb before approval, the questions slot after it. Any other word is only a word.
  const go = mission.questions?.[0]?.answers?.find((a) => a.go)?.go;
  if (open) chip.setAttribute("href", `#${go ?? (mission.approved ? "now" : "gate")}`);
  else chip.removeAttribute("href");
  chip.replaceChildren(lamp(...look.lamp), text(word === "waiting for you" && open ? `${word} · ${open}` : word));
  // From another tab the title is the only thing that shows, so what waits is counted there too.
  if (baseTitle) document.title = open ? `(${open}) ${baseTitle}` : baseTitle;
};

/**
 * The reason behind the word. A failed report or ledger write has no question to answer and
 * cannot reach the feed, because the ledger is what failed, so this line is the only place it
 * shows. A landing that failed is a question with its own answer, drawn where questions are.
 */
let troubleKey = null;
/** A failure is red, and says what still works and what to do; anything else the trouble line carries (a pause, a hold) is the caution it always was. */
const troubleBroken = (t) => /could not be written|killed by SIG|still could not land/.test(t);
const recoveryOf = (t) => {
  if (/the report could not be written/.test(t)) return el("span", { class: "mv-recover" }, " The report itself still reads in full under the second gate, built from the record; only its copy on the mission branch is missing. ", el("a", { href: "#close" }, "read the report"));
  if (/the ledger .*could not be written/.test(t)) return el("span", { class: "mv-recover" }, " The mission's own record still holds what happened. Check that the mission branch's worktree is there (git worktree list); if it is not, ask the Strike Lead below what it needs.");
  if (/killed by SIG/.test(t)) return el("span", { class: "mv-recover" }, " The task it names can be sent out again from its question.");
  return null;
};
const renderTrouble = () => {
  const trouble = mission.trouble ?? "";
  if (trouble === troubleKey) return;
  troubleKey = trouble;
  fill($("#trouble"), trouble ? el("p", { class: troubleBroken(trouble) ? "mv-fail" : "mv-warn" }, trouble, recoveryOf(trouble)) : null);
};

const count = (id, label, needs = false) => {
  const n = $(`#rail a[href="#${id}"] .n`);
  n.textContent = label;
  // Amber is for what waits on you; an ended mission waits on nobody.
  n.classList.toggle("needs", needs && !ended());
};
const renderCounts = () => {
  const ms = mission.milestones;
  const merged = ms.filter((m) => m.merged).length;
  if (mission.approved) {
    const at = ms.find((m) => !m.merged) ?? ms.at(-1);
    count("plan", ms.length ? `milestone ${at.n} of ${ms.length}` : "no milestones");
  } else {
    const planned = mission.planDoc?.parsed?.milestones?.length ?? 0;
    count("plan", planned ? `${planned} milestone${planned === 1 ? "" : "s"}` : ended() ? "none" : "no plan yet", waiting() > 0);
  }
  const open = mission.questions?.length ?? 0;
  // Before approval what waits is in Plan, with the Strike Lead; after the end nothing is live.
  if (!mission.approved) count("progress", ended() ? "nothing flew" : "not yet");
  else if (ended()) {
    const n = mission.feed?.length ?? 0;
    count("progress", `${n} ${n === 1 ? "entry" : "entries"}`);
  }
  else count("progress", open ? `${open} question${open === 1 ? "" : "s"}` : "live", open > 0);
  // A finding Cory has marked, read or later, is off the count: later is already on the checklist.
  // Fix is his to act on at review; in flight it is the RIO's word on work still moving.
  const unread = (mission.readings ?? []).filter((r) => !r.state);
  const fix = unread.filter((r) => r.severity === "fix").length;
  if (fix) count("result", ended() ? `${fix} marked fix` : `${fix} to fix`, atReview(mission.status));
  else if (unread.length) count("result", `${unread.length} to read`);
  else count("result", merged ? "read" : ended() ? "nothing built" : "not yet");
};

/**
 * Pause, resume and stop belong to the whole mission, not to a section, so they sit under the
 * anchors. Each asks in place: a note field for the pause, a second button for the stop.
 */
let controlsKey = "";
let controlsLive = -1;
let asking = false;
const renderControls = () => {
  const live = allTasks().filter((t) => t.status === "flying" || t.status === "reviewing").length;
  const key = `${mission.status}:${Boolean(mission.approved)}`;
  // The live count moves all the time a mission flies; a question half answered is not wiped for it.
  if (key === controlsKey && (asking || live === controlsLive)) return;
  controlsKey = key;
  controlsLive = live;
  asking = false;
  const box = $("#controls");
  if (!mission.approved || ended()) return fill(box);
  const resting = () => {
    asking = false;
    fill(box,
      mission.status === "paused"
        ? btn("resume", () => act("resume", {}, "mission resumed"), "primary")
        : ["flying", "blocked"].includes(mission.status) ? btn("pause", askPause, "ghost") : null,
      btn("stop this mission", askStop, "ghost danger"));
  };
  const askPause = () => {
    asking = true;
    const note = el("input", { type: "text", class: "mv-note", "aria-label": "Why pause the mission", placeholder: "why; kept in the ledger" });
    fill(box,
      el("p", { class: "muted small" }, "Nothing new starts; what is running finishes and is recorded."),
      note,
      el("div", { class: "mv-controls-row" },
        btn("pause it", () => act("pause", { note: note.value.trim() }, "mission paused"), "primary"),
        btn("not yet", () => { resting(); box.querySelector("button")?.focus(); }, "ghost")));
    note.addEventListener("keydown", (e) => { if (e.key === "Enter") act("pause", { note: note.value.trim() }, "mission paused"); });
    note.focus();
  };
  const askStop = () => {
    asking = true;
    fill(box,
      el("p", { class: "mv-warn" }, `This stops ${live} running session${live === 1 ? "" : "s"} and ends the mission; pause is the one that can be resumed. Every branch and worktree is left exactly as it is, so nothing built so far is lost.`),
      el("div", { class: "mv-controls-row" },
        btn("yes, stop it", () => act("abandon", {}, "mission stopped"), "ghost danger"),
        btn("not yet", () => { resting(); box.querySelector("button")?.focus(); }, "ghost")));
    // Not on the button that stops: a held Enter would repeat into it and the two steps become one.
    box.querySelector("button:last-of-type")?.focus();
  };
  resting();
};

/** The anchor whose section is nearest the top of the view is the one marked `on`. */
const spy = () => {
  const links = new Map([...document.querySelectorAll("#rail a.mv-nav")].map((a) => [a.hash.slice(1), a]));
  const mark = (id) => {
    for (const [key, a] of links) {
      a.classList.toggle("on", key === id);
      if (key === id) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    }
  };
  const seen = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
    const first = [...links.keys()].find((id) => seen.has(id));
    if (first) mark(first);
  }, { rootMargin: "-64px 0px -55% 0px" });
  for (const id of links.keys()) observer.observe(document.getElementById(id));
  for (const [id, a] of links) a.addEventListener("click", () => mark(id));
};

/* ---------- the ask: the shell's own section ---------- */
/** A brief longer than a few lines folds to them: the ask is context, and what waits on you sits above it. It is written as markdown and read as it was written. */
const BRIEF_FOLD = 320;
const briefOf = (brief) => {
  const p = renderMarkdown(brief, { project: projectId });
  p.classList.add("mv-ask-brief");
  return brief.length <= BRIEF_FOLD ? p : foldable({ el, btn }, p, { more: "the whole brief", height: "6.4em" });
};
let askKey = "";
const renderAsk = () => {
  const key = JSON.stringify([mission.name, mission.brief, mission.created, mission.approved, mission.planCommit]);
  if (key === askKey) return;
  askKey = key;
  $("#crumb").replaceChildren(text(`${projectName} · Mission `), el("b", {}, mission.name));
  $("#ask").removeAttribute("aria-busy");
  fill($("#ask"),
    el("h1", {}, mission.name),
    briefOf(mission.brief),
    el("p", { class: "mv-ask-meta" }, [
      `opened ${fmtTime(mission.created)}`,
      mission.approved ? `approved ${fmtTime(mission.approved)}` : "not approved yet",
      mission.planCommit ? `planned into the tracker as ${mission.planCommit}` : null,
    ].filter(Boolean).join(" · ")));
};

/* ---------- the plan, and the first gate: the shell's until it is approved ---------- */
/**
 * What happens to each repo when it is done. `push` is the one that reaches a shared branch
 * without a person, so it is named loudly here rather than buried in a config file.
 */
const reposBand = (repos) => {
  if (!repos.length) return null;
  const pushed = repos.filter((r) => r.land === "push");
  return el("div", { class: "mv-lands" },
    ...repos.map((r) => el("div", { class: `mv-land ${r.land}` },
      el("span", { class: "r" }, r.label),
      el("span", { class: "l" }, LANDS[r.land]?.(r.base) ?? r.land))),
    pushed.length
      ? el("p", { class: "mv-warn" }, `${pushed.map((r) => `${r.label} → ${r.base}`).join(", ")}: this one lands on a shared branch without another pair of eyes. It is only ever fast-forwarded, never forced, and it is set in this project's own maverick.json.`)
      : null);
};

/** A check's detail as the markdown sets it: a `backticked` command reads as code. */
const pfDetail = (detail) => {
  const span = el("span", { class: "pf-detail" });
  span.innerHTML = inline(detail, { project: projectId });
  return span;
};

/** What the host can and cannot give the mission, checked before the person approves and leaves. */
const preflightBand = (checks) => {
  if (!checks?.length) return null;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const refusing = checks.some((c) => c.refuses);
  return el("div", { class: "mv-preflight" },
    // The warning itself is said once, beside the button (failingNote, or the refusal in its place); here it is the list's heading.
    el("p", { class: failed || warned ? "cost-note" : "muted small" }, refusing ? `${plural(failed, "thing")} the mission cannot run without ${failed === 1 ? "is" : "are"} not there; approving is refused until ${failed === 1 ? "it is" : "they are"}.` : failed ? `${plural(failed, "thing")} the plan needs ${failed === 1 ? "is" : "are"} not there. Settle ${failed === 1 ? "it" : "them"} before approving, or expect the Wingmen to find out at 2 a.m.` : warned ? `${plural(warned, "thing")} this check cannot settle; read them before approving. The lines marked yours are for you to confirm.` : "The host has what the plan says it needs; the lines marked yours are for you to confirm."),
    el("ul", {}, ...checks.map((c) => el("li", { class: `pf-${c.status}` }, el("span", { class: "pf-status" }, c.status === "human" ? "yours" : c.status), el("strong", {}, c.name), pfDetail(c.detail)))));
};

const costBand = (cost) => el("div", { class: "mv-band" },
  el("div", { class: "cell" }, el("span", { class: "k" }, "repos"), el("span", { class: "v" }, String(cost.repos ?? 1))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "milestones"), el("span", { class: "v" }, String(cost.milestones))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "tasks"), el("span", { class: "v" }, String(cost.tasks))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "sessions it spawns"), el("span", { class: "v" }, String(cost.sessions))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "you are asked"), el("span", { class: "v" }, "twice")));

/** Approving is a decision, not a click: the first press says what it costs, the second flies. */
const approveButton = (doc) => armed({
  label: "approve and fly",
  why: approveWhy(doc),
  yes: `yes, approve "${mission.name}"`,
  onYes: () => act("approve", {}, "approved; the first milestone is out"),
});

const gateBlocks = () => {
  const doc = mission.planDoc ?? {};
  const parsed = doc.parsed;
  const blocks = [];
  const gate = [];
  if (ended()) {
    gate.push(el("p", { class: "why" }, `This mission ended before it was approved, so nothing flew and nothing was written to the tracker. The plan${doc.found ? ` it had reached is still at ${mission.plan}` : " was never written"}; start a new mission from the workspace to pick it up.`));
  } else if (!doc.found) {
    gate.push(el("p", { class: "why" }, `The Strike Lead has not written a plan yet. It goes to ${mission.plan} when the interview is done. Answer it in the chat above; it will not plan off your first line.`));
  } else if (parsed?.problems?.length) {
    gate.push(el("p", { class: "why" }, "There is a plan, but it cannot be flown as written. The Strike Lead is sent these to fix; tell it in the chat above if it stalls. They are the reasons a Wingman would be sent out under-briefed:"),
      el("ul", { class: "mv-problems" }, ...parsed.problems.map((p) => el("li", {}, p))));
  } else {
    gate.push(el("p", { class: "why" }, `This is the one approval. Nothing has spawned: approving writes the plan into the tracker as items, cuts a branch in ${doc.cost.repos === 1 ? "the repo" : `each of the ${doc.cost.repos} repos`} the plan names, and sends the first milestone out.`),
      parsed?.overlaps?.length || parsed?.warnings?.length ? el("div", {}, el("p", { class: "why" }, "Worth a look before you approve. Tasks that fly together and own the same paths are a collision planned in; tasks that build on each other with nothing named between them will invent what they share apart:"),
        el("ul", { class: "mv-overlaps" }, ...[...(parsed.overlaps ?? []), ...(parsed.warnings ?? [])].map((o) => el("li", {}, o)))) : null,
      costBand(doc.cost),
      // The verb sits under what it costs; where each repo lands, the host checks and the notes follow as the fine print.
      el("div", { class: "gate-actions" },
        doc.preflight?.some((c) => c.refuses) ? el("p", { class: "mv-warn" }, "Approving is refused until the tool, runtime or agent it needs is there.") : approveButton(doc),
        el("a", { class: "button-link", target: "_blank", href: `/files?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(mission.plan)}` }, "read the plan document ↗")),
      failingNote(doc.preflight, "below", "approve"),
      reposBand(doc.repos ?? []),
      preflightBand(doc.preflight),
      doc.wingmanAgent
        ? el("p", { class: "cost-note" }, `Each Wingman runs as the ${doc.wingmanAgent} agent, which carries its standing orders: own one task, do not widen it, never push or merge, never grade its own work.`)
        : el("p", { class: "cost-note" }, "Each Wingman gets the mission's prompt and nothing standing behind it. Name a wingmanAgent in this project's maverick.json and every Wingman carries the same orders about staying inside its one task, rather than each mission prompt having to say it again."),
      el("p", { class: "cost-note" }, doc.cost.reference, " Those are Factory's numbers for the equivalent feature, not measured here; they are the reason this gate exists."));
  }
  blocks.push(el("section", { class: "mv-gate", id: "gate" }, el("h2", {}, "The gate"), ...gate));

  if (parsed?.contracts?.length) {
    blocks.push(el("section", {}, el("h2", {}, "Contracts"), el("p", { class: "muted small" }, "What the tasks share, named before any of them starts: the owner writes it first, everyone else reads it from the owner's branch."),
      el("ul", {}, ...parsed.contracts.map((c) => el("li", {}, el("strong", {}, c.name), ` (${c.owner}): ${c.shape}`)))));
  }
  if (parsed?.milestones?.length) {
    blocks.push(el("section", {}, el("h2", {}, "The plan"),
      ...parsed.milestones.map((m) => el("div", { class: "mv-milestone" },
        el("h3", {}, el("span", {}, `Milestone ${m.n} — ${m.title}`)),
        el("p", { class: "done" }, m.done ? `Done when ${m.done}.` : "No done criterion."),
        ...m.tasks.map((t) => el("div", { class: "mv-plan-task" },
          el("h4", {}, t.title, t.repo ? el("span", { class: "mv-repo" }, t.repo) : null),
          t.needs?.length || t.touches?.length ? el("p", { class: "muted small" }, [t.needs?.length ? `starts after ${t.needs.join(", ")}` : null, t.touches?.length ? `owns ${t.touches.join(", ")}` : null].filter(Boolean).join(" · ")) : null,
          el("p", {}, t.intent)))))));
  } else if (doc.text) {
    blocks.push(el("section", {}, el("h2", {}, "The document as written"), renderMarkdown(doc.text, { project: projectId })));
  }
  return blocks;
};

/**
 * Before approval the Plan section is the conversation and the gate: the chat with the Strike
 * Lead first, because that is where the work is, then what the plan it wrote would do. The gate
 * repaints when what it shows changes; the chat patches itself, so a half-answered round survives.
 */
let gateKey = "";
const renderGate = () => {
  const plan = $("#plan");
  if (!plan.querySelector(".mv-gate-host")) fill(plan, el("h2", {}, "Plan"), ctx.thread.node, el("div", { class: "mv-gate-host" }));
  const nextGate = JSON.stringify([mission.planDoc, mission.plan, mission.name, ended()]);
  if (nextGate !== gateKey) {
    gateKey = nextGate;
    fill(plan.querySelector(".mv-gate-host"), ...gateBlocks());
    fill($("#progress"), el("h2", {}, "Progress"), el("p", { class: "mv-empty" }, ended() ? "Nothing flew." : "Nothing has flown yet. What the mission does shows here once you fire it."));
    fill($("#result"), el("h2", {}, "Result"), el("p", { class: "mv-empty" }, ended() ? "Nothing was built." : "Nothing yet: the result is what merges, and nothing can merge before the plan is approved."));
  }
};

/* ---------- after the blessing: Plan, Progress and Result are modules ---------- */
const MODULES = ["plan", "progress", "result"];
const TITLES = { plan: "Plan", progress: "Progress", result: "Result" };
const mounted = new Map();
let modulesUp = null;

/** One module that will not load is one line in its own section, not a broken page. */
const mountModule = async (name) => {
  const host = document.getElementById(name);
  try {
    const mod = await import(`./mission/${name}.js`);
    host.replaceChildren();
    const handle = mod.mount(host, mission, ctx);
    if (typeof handle?.update !== "function") throw new Error("its mount returned no update");
    mounted.set(name, handle);
  } catch (err) {
    fill(host, el("h2", {}, TITLES[name]), el("p", { class: "mv-empty" }, `The ${name} module did not load: ${err.message}`));
  }
};
const mountModules = () => {
  // A terminal opened at the gate (the Strike Lead's raw session) is let go as the page changes shape.
  detachTerminal();
  modulesUp = Promise.all(MODULES.map(mountModule));
  return modulesUp;
};
const updateModules = () => {
  reapSessions();
  for (const [name, handle] of mounted) {
    try {
      handle.update(mission);
    } catch (err) {
      toast(`the ${name} section did not update: ${err.message}`, { error: true });
    }
  }
};

/* ---------- paint: the first one builds, every one after patches ---------- */
const paint = () => {
  // The thread first: before approval what it holds open is what the word and the counts read.
  ctx.thread.update(mission);
  renderWord();
  renderTrouble();
  renderCounts();
  renderControls();
  renderAsk();
  if (!mission.approved) return renderGate();
  if (!modulesUp) return mountModules();
  updateModules();
};

let lastPayload = "";
/** A view that changed nothing is not handed on: a walkthrough's own saves land every few seconds. */
const apply = (next) => {
  const shape = JSON.stringify(next, (k, v) => (k === "progress" ? undefined : v));
  if (shape === lastPayload) return;
  lastPayload = shape;
  mission = next;
  paint();
};
const load = async () => apply(await api(missionUrl()));

/**
 * The stream is the fast path: the server writes the view whenever the record or its ledger
 * changes. EventSource reconnects on its own, so one error is a blip; two in a row and the
 * page falls back to asking every eight seconds, which also drives the server's sweep. The
 * first poll the server answers means it is back, so the stream is opened again.
 */
let streaming = false;
const listen = () => {
  let errors = 0;
  const source = new EventSource(actionUrl("stream"));
  streaming = true;
  source.onmessage = (e) => {
    errors = 0;
    try {
      apply(JSON.parse(e.data));
    } catch (err) {
      setStatus(err.message, true);
    }
  };
  source.onerror = () => {
    errors += 1;
    if (errors < 2) return;
    source.close();
    streaming = false;
    setStatus("the live stream dropped; checking every 8 s instead");
    poll();
  };
};
let pollTimer = 0;
const poll = () => {
  // A hidden tab would otherwise keep driving a full server sweep, and its git calls, forever.
  pollTimer = window.setInterval(async () => {
    if (document.hidden || ended()) return;
    try {
      await load();
    } catch (err) {
      setStatus(err.message, true);
      return;
    }
    window.clearInterval(pollTimer);
    pollTimer = 0;
    setStatus("the live stream is back");
    listen();
  }, 8000);
};
document.addEventListener("visibilitychange", () => { if (pollTimer && !document.hidden) load().catch(() => {}); });

/** A page that cannot show its mission says why in the page, with the way back, and draws none of the sections it cannot fill. */
const cannotOpen = (why, back = "/") => {
  $("#page").classList.add("unopened");
  // Said once, in the page, where the way back is; the bar would only repeat it.
  setStatus("");
  fill($("#ask"),
    el("h1", {}, "This mission cannot be opened"),
    el("p", { class: "mv-fail" }, why),
    el("p", {}, el("a", { class: "button-link", href: back }, "back to the workspace"), " where its row says what it is waiting for, or open it from there again."));
};

const boot = async () => {
  void mountDevBadge();
  $("#brand-mark").replaceChildren(jetSvg("jet-glyph mark"));
  if (!projectId || !missionId) return cannotOpen("the link is missing its project or its mission: open the mission from the workspace, which writes both");
  const projects = await api("/api/projects");
  const project = projects.find((p) => p.id === projectId);
  if (!project) return cannotOpen(`there is no project "${projectId}" on this machine; it may have been removed from the registry`);
  baseTitle = `Mission · ${project.name} · Maverick`;
  document.title = baseTitle;
  projectName = project.name;
  $("#crumb").replaceChildren(text(project.name));
  applyTheme(project.theme);
  const workspace = `/?project=${encodeURIComponent(projectId)}&view=workspace`;
  $("#board-link").replaceChildren(text("Workspace"));
  $("#board-link").href = workspace;
  $("#back").href = workspace;
  spy();
  try {
    await load();
  } catch (err) {
    return cannotOpen(err.message, workspace);
  }
  await modulesUp;
  // What is on the page now was there on arrival; only what lands after this rises in.
  requestAnimationFrame(() => $("#page").classList.add("settled"));
  // The sections were empty when the browser tried the hash; now they have their height.
  const target = location.hash.slice(1);
  if (["ask", "plan", "progress", "result"].includes(target)) document.getElementById(target).scrollIntoView();
  toGate();
  window.addEventListener("hashchange", toGate);
  // A second press on the lamp names the hash already there, which fires nothing; it should land again.
  $("#word").addEventListener("click", () => { if ($("#word").getAttribute("href") === location.hash) window.dispatchEvent(new HashChangeEvent("hashchange")); });
  listen();
};
boot().catch((err) => setStatus(err.message, true));
