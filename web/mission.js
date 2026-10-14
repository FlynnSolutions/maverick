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
 * `ctx` is { el, text, btn, lamp, api, post, act, projectId, missionId, openSession, fmtTime }:
 *   el(tag, attrs, ...children)  builds an element; `on*` attrs are listeners, nulls are dropped
 *   text(s), btn(label, onclick, cls)
 *   lamp(status, band)           web/lamp.js's lamp
 *   api(path, init), post(path, body)  fetch JSON; throw with the server's error on a non-2xx
 *   act(path, body, said)        posts to /api/missions/<id>/<path>?project=, sets the status
 *                                line to `said` (or the error), and refreshes every module
 *   projectId, missionId
 *   openSession(taskId, under)   mounts the task's session (its RIO's while it is reviewing,
 *                                its Wingman's otherwise) as a terminal under `under`
 *   fmtTime(iso)                 a clock time, or "" for none
 */

import { lamp } from "./lamp.js";
import { readableOn, recall } from "./theme.js";
import { render as renderMarkdown } from "./markdown.js";

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

const params = new URLSearchParams(location.search);
const projectId = params.get("project");
const missionId = params.get("mission");
let mission = null;

const missionUrl = () => `/api/missions/${encodeURIComponent(missionId)}?project=${encodeURIComponent(projectId)}`;
const actionUrl = (action) => `/api/missions/${encodeURIComponent(missionId)}/${action}?project=${encodeURIComponent(projectId)}`;

/* ---------- theme, on the board's terms: its mode, its project palette, its computed ink ---------- */
const applyTheme = (theme) => {
  const mode = recall("mv.theme", "");
  if (mode) document.documentElement.setAttribute("data-theme", mode);
  if (!theme || recall("mv.projectTheme", "1") === "0") return;
  const root = document.documentElement.style;
  root.setProperty("--accent", theme.accent);
  root.setProperty("--accent-hot", theme.accentHot);
  root.setProperty("--on-accent", readableOn(theme.accent));
  root.setProperty("--display", `"${theme.font}", "Chakra Petch", "IBM Plex Sans", sans-serif`);
  if (theme.font !== "Chakra Petch") document.head.append(el("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font).replace(/%20/g, "+")}:wght@500;600;700&display=swap` }));
};

/* ---------- the interview's terminal, mounted inside the mission's own view ---------- */
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
const tasksOf = (m) => m.tasks ?? [];
const allTasks = () => mission.milestones.flatMap(tasksOf);
const openSession = (taskId, under) => {
  const task = allTasks().find((t) => t.id === taskId);
  const claudeId = task?.status === "reviewing" ? task.review?.claudeId : task?.claudeId ?? task?.review?.claudeId;
  if (!claudeId) {
    setStatus(`${task?.title ?? taskId} has no session to open`, true);
    return;
  }
  if (watching.has(claudeId)) {
    setStatus(`${task.title}'s session is already open on this page`);
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
const act = async (action, body, said) => {
  try {
    await post(actionUrl(action), body);
    setStatus(said);
    await load();
  } catch (err) {
    setStatus(err.message, true);
  }
};

const ctx = { el, text, btn, lamp, api, post, act, projectId, missionId, openSession, fmtTime };

/* ---------- the rail: one word, four anchors, and the brakes ---------- */
const WORD = {
  "waiting for you": { cls: "caution", lamp: ["blocked", "work"] },
  done: { cls: "hud", lamp: ["done", "work"] },
  error: { cls: "threat", lamp: ["idle", "warm"] },
  working: { cls: "", lamp: ["busy", "work"] },
};
const renderWord = () => {
  const word = mission.word ?? "working";
  const look = WORD[word] ?? WORD.working;
  const open = mission.questions?.length ?? 0;
  const chip = $("#word");
  chip.className = `mv-word ${look.cls}`;
  chip.replaceChildren(lamp(...look.lamp), text(word === "waiting for you" && open ? `${word} · ${open}` : word));
};

/**
 * The reason behind the word. A failed report or ledger write has no question to answer and
 * cannot reach the feed, because the ledger is what failed, so this line is the only place it
 * shows. A landing that failed gets the one thing that can be done about it.
 */
let troubleKey = null;
const renderTrouble = () => {
  const trouble = mission.trouble ?? "";
  if (trouble === troubleKey) return;
  troubleKey = trouble;
  fill($("#trouble"),
    trouble ? el("p", { class: "mv-warn" }, trouble) : null,
    /could not land/.test(trouble) ? btn("try landing it again", () => act("land", {}, "landing again"), "primary") : null,
    /could not land/.test(trouble) ? el("span", { class: "muted small" }, "rebase the branch it named first; nothing here will force it") : null);
};

const count = (id, label, needs = false) => {
  const n = $(`#rail a[href="#${id}"] .n`);
  n.textContent = label;
  n.classList.toggle("needs", needs);
};
const renderCounts = () => {
  const ms = mission.milestones ?? [];
  const merged = ms.filter((m) => m.merged).length;
  if (mission.approved) {
    const at = ms.find((m) => !m.merged) ?? ms.at(-1);
    count("plan", ms.length ? `milestone ${at.n} of ${ms.length}` : "no milestones");
  } else {
    const planned = mission.planDoc?.parsed?.milestones?.length ?? 0;
    count("plan", planned ? `${planned} milestone${planned === 1 ? "" : "s"}` : "no plan yet", Boolean(mission.questions?.length));
  }
  const open = mission.questions?.length ?? 0;
  // Before approval the only question is the gate, and the gate is drawn in Plan.
  if (!mission.approved) count("progress", "not yet");
  else count("progress", open ? `${open} question${open === 1 ? "" : "s"}` : "live", open > 0);
  count("result", mission.status === "closed" ? "closed" : merged ? `${merged} of ${ms.length} merged` : "not yet");
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
  if (!mission.approved || ["closed", "abandoned"].includes(mission.status)) return fill(box);
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
    const note = el("input", { type: "text", class: "mv-note", "aria-label": "Why pause the mission", placeholder: "why, in a line; kept in the ledger" });
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
  const links = new Map([...document.querySelectorAll("#rail a[href^='#']")].map((a) => [a.hash.slice(1), a]));
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
const renderAsk = () => {
  fill($("#ask"),
    el("h2", {}, "The ask"),
    el("h1", {}, el("span", { class: "name" }, mission.name), mission.brief),
    el("p", { class: "mv-ask-meta" }, [
      `opened ${fmtTime(mission.created)}`,
      mission.approved ? `approved ${fmtTime(mission.approved)}` : "not approved yet",
      mission.planCommit ? `planned into the tracker as ${mission.planCommit}` : null,
    ].filter(Boolean).join(" · ")));
};

/* ---------- the plan, and the first gate: the shell's until it is approved ---------- */
const LANDS = {
  merge: (base) => `stays on the mission branch; nothing touches ${base}`,
  pr: (base) => `a pull request against ${base}, merged by you`,
  push: (base) => `${base} is advanced to it and pushed`,
};

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

/** What the host can and cannot give the mission, checked before the person approves and leaves. */
const preflightBand = (checks) => {
  if (!checks?.length) return null;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const refusing = checks.some((c) => c.refuses);
  return el("div", { class: "mv-preflight" },
    el("p", { class: failed || warned ? "mv-warn" : "muted small" }, refusing ? `${failed} thing(s) the mission cannot run without are not there; approving is refused until they are.` : failed ? `${failed} thing(s) the plan needs are not there. Settle them before approving, or expect the Wingmen to find out at 2 a.m.` : warned ? `${warned} thing(s) this check cannot settle; read them before approving. The lines marked yours are for you to confirm.` : "The host has what the plan says it needs; the lines marked yours are for you to confirm."),
    el("ul", {}, ...checks.map((c) => el("li", { class: `pf-${c.status}` }, el("span", { class: "pf-status" }, c.status === "human" ? "yours" : c.status), el("strong", {}, c.name), ` ${c.detail}`))));
};

const costBand = (cost) => el("div", { class: "mv-band" },
  el("div", { class: "cell" }, el("span", { class: "k" }, "repos"), el("span", { class: "v" }, String(cost.repos ?? 1))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "milestones"), el("span", { class: "v" }, String(cost.milestones))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "tasks"), el("span", { class: "v" }, String(cost.tasks))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "sessions it spawns"), el("span", { class: "v" }, String(cost.sessions))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "you are asked"), el("span", { class: "v" }, "twice")));

/** Approving is a decision, not a click: the first press says what it costs, the second flies. */
const approveButton = (doc) => {
  const box = el("div", { class: "mv-confirm" });
  const arm = btn("approve and fly", () => {
    fill(box,
      el("p", { class: "why" }, `This writes ${doc.cost.tasks} items into the tracker and spawns ${doc.cost.sessions} background sessions over the mission's life. It is the last thing you are asked until the result.`),
      btn(`yes, approve "${mission.name}"`, () => act("approve", {}, "approved; the first milestone is out"), "primary"),
      btn("not yet", () => { fill(box, arm); arm.focus(); }, "ghost"));
    box.querySelector("button:last-of-type")?.focus();
  }, "primary");
  box.append(arm);
  return box;
};

const gateBlocks = () => {
  const doc = mission.planDoc ?? {};
  const parsed = doc.parsed;
  const blocks = [];
  const gate = [];
  if (!doc.found) {
    gate.push(el("p", { class: "why" }, `The Strike Lead has not written a plan yet. It goes to ${mission.plan} when the interview is done. Answer it in the session below; it will not plan off your first line.`));
  } else if (parsed?.problems?.length) {
    gate.push(el("p", { class: "why" }, "There is a plan, but it cannot be flown as written. Tell the Strike Lead in the session below; these are the reasons a Wingman would be sent out under-briefed:"),
      el("ul", { class: "mv-problems" }, ...parsed.problems.map((p) => el("li", {}, p))));
  } else {
    gate.push(el("p", { class: "why" }, `This is the one approval. Nothing has spawned: approving writes the plan into the tracker as items, cuts a branch in each of the ${doc.cost.repos} repo(s) the plan names, and sends the first milestone out.`),
      parsed?.overlaps?.length || parsed?.warnings?.length ? el("div", {}, el("p", { class: "why" }, "Worth a look before you approve. Tasks that fly together and own the same paths are a collision planned in; tasks that build on each other with nothing named between them will invent what they share apart:"),
        el("ul", { class: "mv-overlaps" }, ...[...(parsed.overlaps ?? []), ...(parsed.warnings ?? [])].map((o) => el("li", {}, o)))) : null,
      costBand(doc.cost),
      reposBand(doc.repos ?? []),
      preflightBand(doc.preflight),
      doc.wingmanAgent
        ? el("p", { class: "cost-note" }, `Each Wingman runs as the ${doc.wingmanAgent} agent, which carries its standing orders: own one task, do not widen it, never push or merge, never grade its own work.`)
        : el("p", { class: "mv-warn" }, "Each Wingman gets the mission's prompt and nothing standing behind it. Name a wingmanAgent in this project's maverick.json and every Wingman carries the same orders about staying inside its one task, rather than each mission prompt having to say it again."),
      el("p", { class: "cost-note" }, doc.cost.reference, " Those are Factory's numbers for the equivalent feature, not measured here; they are the reason this gate exists."),
      el("div", { class: "gate-actions" },
        doc.preflight?.some((c) => c.refuses) ? el("p", { class: "mv-warn" }, "Approving is refused until the tool, runtime or agent it needs is there.") : approveButton(doc),
        el("a", { class: "button-link", target: "_blank", href: `/files?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(mission.plan)}` }, "read the plan document ↗")));
  }
  blocks.push(el("section", { class: "panel mv-gate" }, el("h2", {}, "The gate"), ...gate));

  if (parsed?.contracts?.length) {
    blocks.push(el("section", { class: "panel" }, el("h2", {}, "Contracts"), el("p", { class: "muted small" }, "What the tasks share, named before any of them starts: the owner writes it first, everyone else reads it from the owner's branch."),
      el("ul", {}, ...parsed.contracts.map((c) => el("li", {}, el("strong", {}, c.name), ` (${c.owner}): ${c.shape}`)))));
  }
  if (parsed?.milestones?.length) {
    blocks.push(el("section", { class: "panel" }, el("h2", {}, "The plan"),
      ...parsed.milestones.map((m) => el("div", { class: "mv-milestone" },
        el("h3", {}, el("span", {}, `Milestone ${m.n} — ${m.title}`)),
        el("p", { class: "done" }, m.done ? `Done when ${m.done}.` : "No done criterion."),
        ...m.tasks.map((t) => el("div", { class: "mv-plan-task" },
          el("h4", {}, t.title, t.repo ? el("span", { class: "mv-repo" }, t.repo) : null),
          t.needs?.length || t.touches?.length ? el("p", { class: "muted small" }, [t.needs?.length ? `starts after ${t.needs.join(", ")}` : null, t.touches?.length ? `owns ${t.touches.join(", ")}` : null].filter(Boolean).join(" · ")) : null,
          el("p", {}, t.intent)))))));
  } else if (doc.text) {
    blocks.push(el("section", { class: "panel" }, el("h2", {}, "The document as written"), renderMarkdown(doc.text, { project: projectId })));
  }
  return blocks;
};

/** The interview is a conversation, so its session lives here rather than in a panel over the page. */
const interviewPanel = () => {
  const host = el("div", { class: "term" });
  const panel = el("section", { class: "panel mv-interview" },
    el("h2", {}, "The Strike Lead", el("span", { class: "spacer" }), btn("start a new interview session", () => act("interview", {}, "a new Strike Lead session is open"), "ghost")),
    el("div", { class: "mv-term-well" }, host));
  const gone = () => host.replaceChildren(el("p", { class: "mv-empty" }, "The Strike Lead's session is not running any more: terminals do not survive a restart of the server. Start a new interview above; it opens with the same brief."));
  if (mission.interview?.terminalId) {
    api("/api/terminals").then((open) => {
      const live = open.find((x) => x.id === mission.interview.terminalId && x.exitCode === null);
      if (live) requestAnimationFrame(() => mountTerminal(host, live.id));
      else gone();
    }).catch(gone);
  } else {
    host.replaceChildren(el("p", { class: "mv-empty" }, "No Strike Lead session is attached. Start one above."));
  }
  return panel;
};

/**
 * The gate repaints when what it shows changes; the interview below it only when its session
 * does, because a repaint would dispose the terminal being typed into.
 */
let gateKey = "";
let interviewKey = "";
const renderGate = () => {
  const plan = $("#plan");
  if (!plan.querySelector(".mv-gate-host")) {
    fill(plan, el("h2", {}, "Plan"), el("div", { class: "mv-gate-host" }), el("div", { class: "mv-interview-host" }));
    fill($("#progress"), el("h2", {}, "Progress"), el("p", { class: "mv-empty" }, "Nothing has flown yet. What the mission does shows here once you approve the plan."));
    fill($("#result"), el("h2", {}, "Result"), el("p", { class: "mv-empty" }, "not yet"));
  }
  const nextGate = JSON.stringify([mission.planDoc, mission.plan, mission.name]);
  if (nextGate !== gateKey) {
    gateKey = nextGate;
    fill(plan.querySelector(".mv-gate-host"), ...gateBlocks());
  }
  const nextInterview = mission.interview?.terminalId ?? "";
  if (nextInterview !== interviewKey || !plan.querySelector(".mv-interview")) {
    interviewKey = nextInterview;
    detachTerminal();
    fill(plan.querySelector(".mv-interview-host"), interviewPanel());
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
  // The gate's interview session is done with once the plan is approved.
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
      setStatus(`the ${name} section did not update: ${err.message}`, true);
    }
  }
};

/* ---------- paint: the first one builds, every one after patches ---------- */
const paint = () => {
  $("#crumb").replaceChildren(text("Mission "), el("b", {}, mission.name));
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
const listen = () => {
  let errors = 0;
  const source = new EventSource(actionUrl("stream"));
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
    setStatus("the live stream dropped; checking every 8 s instead");
    poll();
  };
};
let pollTimer = 0;
const poll = () => {
  // A hidden tab would otherwise keep driving a full server sweep, and its git calls, forever.
  pollTimer = window.setInterval(async () => {
    if (document.hidden || ["closed", "abandoned"].includes(mission?.status)) return;
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

const boot = async () => {
  if (!projectId || !missionId) {
    setStatus("open this page from the board's rail: ?project=<id>&mission=<id>", true);
    return;
  }
  const projects = await api("/api/projects");
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    setStatus(`no project "${projectId}"`, true);
    return;
  }
  document.title = `Mission · ${project.name} · Maverick`;
  applyTheme(project.theme);
  const workspace = `/?project=${encodeURIComponent(projectId)}&view=workspace`;
  $("#board-link").replaceChildren(text("Workspace"));
  $("#board-link").href = workspace;
  $("#back").href = workspace;
  spy();
  await load();
  await modulesUp;
  // The sections were empty when the browser tried the hash; now they have their height.
  const target = location.hash.slice(1);
  if (["ask", "plan", "progress", "result"].includes(target)) document.getElementById(target).scrollIntoView();
  listen();
};
boot().catch((err) => setStatus(err.message, true));
