// The mission page: one mission, saved, revisitable. Milestones down the left, the selected
// one's detail as the main read. Cory is in the loop exactly twice and both gates live here:
// the plan he blesses before anything spawns, and the finished mission he reads and tests.

import { jetSvg } from "./jet.js";
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
/** replaceChildren stringifies a null into the word "null"; el() filters. Everything goes through here. */
const show = (...nodes) => $("#detail").replaceChildren(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
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
let project = null;
let mission = null;
let selected = params.get("at") ?? null;

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
  attached.push({ term, fit, source });
};
window.addEventListener("resize", () => { for (const a of attached) requestAnimationFrame(() => a.fit.fit()); });

/**
 * A session's own screen, inside the task it belongs to. A mission runs six or more agents for
 * two hours; not being able to look at any of them is the difference between steering it and
 * hoping. Attaching is read-and-write: it is a real terminal, so you can take the stick.
 */
const watching = new Map();
const watchSession = async (host, claudeId, title) => {
  if (watching.has(claudeId)) return;
  watching.set(claudeId, true);
  try {
    const open = await api("/api/terminals");
    const existing = open.find((t) => t.exitCode === null && t.command.join(" ") === `claude attach ${claudeId}`);
    const info = existing ?? (await post("/api/terminals", { project: projectId, kind: "attach", id: claudeId, title, cols: 110, rows: 28 }));
    host.replaceChildren();
    mountTerminal(host, info.id);
  } catch (err) {
    watching.delete(claudeId);
    host.replaceChildren(el("p", { class: "mv-empty" }, `could not attach: ${err.message}`));
  }
};

/* ---------- data ---------- */
let lastPayload = "";
const load = async (force = false) => {
  const res = await fetch(missionUrl());
  const body = await res.text();
  if (!res.ok) throw new Error(JSON.parse(body).error ?? `${res.status} on ${missionUrl()}`);
  // A poll that changed nothing must not rebuild the page: re-rendering collapses whatever
  // findings you had open and drops you back to the top of the panel every eight seconds.
  if (!force && body === lastPayload) return;
  // A repaint disposes every mounted terminal, so a poll holds off while one is open, the way
  // the workspace holds off during a rename. The page says so rather than quietly going stale.
  if (!force && attached.length) {
    lastPayload = "";
    $("#status").textContent = "paused while you are attached to a session";
    return;
  }
  lastPayload = body;
  mission = JSON.parse(body);
  const keys = [...mission.milestones.map((m) => `m${m.n}`), "plan", "review"];
  if (!selected || !keys.includes(selected)) {
    const open = mission.milestones.find((m) => !m.merged) ?? mission.milestones.at(-1);
    const atTheGate = mission.status === "interviewing" || mission.status === "planned";
    selected = !atTheGate && open ? `m${open.n}` : "plan";
  }
  renderAll();
};
const act = async (action, body, said) => {
  try {
    await post(actionUrl(action), body);
    setStatus(said);
    await load(true);
  } catch (err) {
    setStatus(err.message, true);
  }
};

/* ---------- render ---------- */
const tasksOf = (m) => m.tasks ?? [];
/** Derived in one place: the nav and the detail head disagreed about a handed-back milestone. */
/** A milestone's merges, one per repo it touched. */
const merges = (m) => Object.entries(m.mergeShas ?? {}).map(([repo, sha]) => `${repo} ${sha}`).join(" · ");
const milestoneState = (m) => (m.merged ? "passed" : tasksOf(m).some((t) => t.status === "handed-back") ? "handed-back" : m.dispatched ? "flying" : "pending");
const allTasks = () => mission.milestones.flatMap(tasksOf);

const renderTop = () => {
  const tasks = allTasks();
  const passed = tasks.filter((t) => t.status === "passed").length;
  const pct = tasks.length ? (passed / tasks.length) * 100 : 0;
  $("#crumb").replaceChildren(text("Mission "), el("b", {}, mission.name));
  $("#top").replaceChildren(
    el("div", { class: "ship-progress" }, el("div", { class: "runway" }, el("div", { class: "fill", style: `width:${pct}%` }), el("div", { class: "jet-marker", style: `left:${pct}%` }, jetSvg("jet-glyph")))),
    el("div", { class: "summary" },
      el("span", { class: `verdict ${mission.status}` }, mission.status),
      el("span", {}, `${passed} of ${tasks.length || "?"} tasks passed`),
      el("span", {}, `${mission.milestones.filter((m) => m.merged).length} of ${mission.milestones.length} milestones merged`),
      mission.branch ? el("span", { title: "every milestone merges here; Maverick never merges a mission to main" }, mission.branch) : null));
};

const renderNav = () => {
  const nav = $("#nav");
  const entry = (key, n, title, badge, cls = "") => el("button", {
    type: "button",
    class: `nav-step ${cls}${key === selected ? " selected" : ""}`,
    onclick: () => { selected = key; history.replaceState(null, "", `?project=${encodeURIComponent(projectId)}&mission=${encodeURIComponent(missionId)}&at=${key}`); renderAll(); },
  }, el("span", { class: "lamp" }), el("span", { class: "n" }, n), el("span", { class: "t", title }, title), badge ?? el("span", {}));

  const items = [entry("plan", "P", mission.approved ? "The plan, as approved" : "The plan, and the gate", el("span", { class: `verdict ${mission.approved ? "passed" : mission.status}` }, mission.approved ? "approved" : mission.status))];
  mission.milestones.forEach((m) => {
    const state = milestoneState(m);
    items.push(entry(`m${m.n}`, String(m.n), m.title, el("span", { class: `verdict ${state}` }, m.merged ? "merged" : state), state));
  });
  const done = mission.status === "review" || mission.status === "closed";
  items.push(el("h3", {}, "The result"), entry("review", "R", "What the mission built", el("span", { class: `verdict ${done ? "passed" : mission.status}` }, mission.status === "closed" ? "closed" : mission.status === "review" ? "ready" : "in flight")));
  nav.replaceChildren(...items);
};

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

const costBand = (cost) => el("div", { class: "mv-band" },
  el("div", { class: "cell" }, el("span", { class: "k" }, "repos"), el("span", { class: "v" }, String(cost.repos ?? 1))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "milestones"), el("span", { class: "v" }, String(cost.milestones))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "tasks"), el("span", { class: "v" }, String(cost.tasks))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "sessions it spawns"), el("span", { class: "v" }, String(cost.sessions))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "you are asked"), el("span", { class: "v" }, "twice")));

/* ---------- the plan, and the first gate ---------- */
const renderPlan = () => {
  const doc = mission.planDoc ?? {};
  const parsed = doc.parsed;
  const blocks = [
    el("div", { class: "detail-head" }, el("h1", {}, mission.name), el("span", { class: `verdict ${mission.status}` }, mission.status),
      mission.approved && !["closed", "abandoned"].includes(mission.status)
        ? el("span", { class: "actions" }, btn("stop this mission", async () => {
            const live = allTasks().filter((t) => t.status === "flying" || t.status === "reviewing").length;
            if (!window.confirm(`Stop "${mission.name}"?\n\nThis stops ${live} running session(s). Every branch and worktree is left exactly as it is, so nothing built so far is lost. It cannot be resumed.`)) return;
            await act("abandon", {}, "mission stopped");
          }, "ghost danger"))
        : null),
    el("div", { class: "detail-meta" },
      el("span", {}, `opened ${fmtTime(mission.created)}`),
      mission.approved ? el("span", {}, `approved ${fmtTime(mission.approved)}`) : null,
      mission.planCommit ? el("span", {}, `planned into the tracker as ${mission.planCommit}`) : null),
    el("section", { class: "panel" }, el("h2", {}, "The line you opened with"), el("p", { class: "mv-plan" }, mission.brief)),
  ];

  if (!mission.approved) {
    const gate = [];
    if (!doc.found) {
      gate.push(el("p", { class: "why" }, `The Strike Lead has not written a plan yet. It goes to ${mission.plan} when the interview is done. Answer it in the session below; it will not plan off your first line.`));
    } else if (parsed?.problems?.length) {
      gate.push(el("p", { class: "why" }, "There is a plan, but it cannot be flown as written. Tell the Strike Lead in the session below; these are the reasons a Wingman would be sent out under-briefed:"),
        el("ul", { class: "mv-problems" }, ...parsed.problems.map((p) => el("li", {}, p))));
    } else {
      gate.push(el("p", { class: "why" }, `This is the one approval. Nothing has spawned: approving writes the plan into the tracker as items, cuts a branch in each of the ${doc.cost.repos} repo(s) the plan names, and sends the first milestone out.`),
        costBand(doc.cost),
        reposBand(doc.repos ?? []),
        el("p", { class: "cost-note" }, doc.cost.reference, " Those are Factory's numbers for the equivalent feature, not measured here; they are the reason this gate exists."),
        el("div", { class: "gate-actions" },
          btn("approve and fly", async () => {
            const ok = window.confirm(`Approve "${mission.name}"?\n\nThis writes ${doc.cost.tasks} items into the tracker and spawns ${doc.cost.sessions} background sessions over the mission's life. It is the last thing you are asked until the result.`);
            if (!ok) return;
            await act("approve", {}, "approved; the first milestone is out");
          }, "primary"),
          el("a", { class: "button-link", target: "_blank", href: `/files?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(mission.plan)}` }, "read the plan document ↗")));
    }
    blocks.push(el("section", { class: "panel mv-gate" }, el("h2", {}, "The gate"), ...gate));
  }

  if (parsed?.milestones?.length) {
    blocks.push(el("section", { class: "panel" }, el("h2", {}, "The plan"),
      ...parsed.milestones.map((m) => el("div", { class: "mv-milestone" },
        el("h3", {}, el("span", {}, `Milestone ${m.n} — ${m.title}`)),
        el("p", { class: "done" }, m.done ? `Done when ${m.done}.` : "No done criterion."),
        ...m.tasks.map((t) => el("div", { class: "mv-plan-task" },
          el("h4", {}, t.title, t.repo ? el("span", { class: "mv-repo" }, t.repo) : null),
          el("p", {}, t.intent)))))));
  } else if (doc.text) {
    blocks.push(el("section", { class: "panel" }, el("h2", {}, "The document as written"), renderMarkdown(doc.text, { project: projectId })));
  }

  // The interview is a conversation, so its session lives here rather than in a panel over the page.
  if (!mission.approved) {
    const host = el("div", { class: "term" });
    blocks.push(el("section", { class: "panel mv-interview" },
      el("h2", {}, "The Strike Lead", el("span", { class: "spacer" }), btn("start a new interview session", () => act("interview", {}, "a new Strike Lead session is open"), "ghost")),
      el("div", { class: "mv-term-well" }, host)));
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
  }
  show(...blocks);
};

/* ---------- a milestone in flight ---------- */
const taskRow = (task) => {
  const findings = mission.findings?.[task.id];
  const diff = mission.diffstat?.[task.id];
  const live = task.status === "flying" || task.status === "reviewing";
  return el("div", { class: "mv-task" },
    live ? lamp("busy") : el("span", { class: `dot ${task.status}` }),
    el("span", { class: "t", title: task.title }, task.title),
    el("span", { class: `verdict ${task.status}` }, task.status === "reviewing" ? "in review" : task.status),
    el("span", { class: "mv-acts" },
      task.claudeId || task.review?.claudeId ? btn(live ? "watch" : "read it back", (e) => {
        const row = e.target.closest(".mv-task");
        const host = row.querySelector(".mv-term-well") ?? row.appendChild(el("div", { class: "mv-term-well" }, el("div", { class: "term" })));
        const id = task.status === "reviewing" ? task.review?.claudeId : task.claudeId;
        if (id) watchSession(host.querySelector(".term") ?? host, id, task.title);
      }, "ghost") : null,
      task.status === "handed-back" ? btn("send it back out", () => act(`tasks/${task.id}/retry`, {}, `${task.title} is flying again`), "primary") : null,
      task.status === "handed-back" ? btn("accept it over the RIO", async () => {
        const note = window.prompt(`Accept "${task.title}" over its RIO?\n\nSay why; it is kept on the task.`, "");
        if (note === null) return;
        await act(`tasks/${task.id}/accept`, { note }, `${task.title} accepted`);
      }, "ghost") : null),
    el("div", { class: "meta" }, [
      task.repo,
      `attempt ${task.attempts}`,
      task.branch,
      task.claudeId ? `session ${task.claudeId}` : null,
      task.verdict ? `RIO: ${task.verdict}` : null,
      task.commits ? `${task.commits.length} commit${task.commits.length === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · ")),
    task.note ? el("div", { class: "note" }, task.note) : null,
    diff ? el("pre", { class: "diffstat" }, diff) : null,
    findings ? el("details", {}, el("summary", { class: "muted small" }, "what its RIO found"), renderMarkdown(findings.replace(/^verdict:.*\n?/i, ""), { project: projectId })) : null);
};

const renderMilestone = (m) => {
  const tasks = tasksOf(m);
  show(
    el("div", { class: "detail-head" },
      el("h1", {}, `Milestone ${m.n} — ${m.title}`),
      el("span", { class: `verdict ${milestoneState(m)}` }, m.merged ? "merged" : m.dispatched ? "flying" : "not sent yet")),
    el("div", { class: "detail-meta" },
      el("span", {}, `done when ${m.done}`),
      m.dispatched ? el("span", {}, `sent ${fmtTime(m.dispatched)}`) : null,
      m.merged ? el("span", {}, `merged ${fmtTime(m.merged)}${merges(m) ? ` · ${merges(m)}` : ""}`) : null),
    mission.trouble ? el("section", { class: "panel" }, el("h2", {}, "Needs you"), el("p", { class: "mv-plan" }, mission.trouble)) : null,
    m.conflicts?.length ? el("section", { class: "panel" }, el("h2", {}, "It will not merge"), el("p", { class: "mv-plan" }, `These paths collided merging into ${mission.branch}: ${m.conflicts.join(", ")}. The merge was aborted, so nothing is half-applied.`)) : null,
    el("section", { class: "panel" },
      el("h2", {}, "Tasks", el("span", { class: "spacer" }), el("span", { class: "muted small" }, "one Wingman each in its own worktree, with a RIO in the back seat that did not write the code")),
      tasks.length ? el("div", {}, ...tasks.map(taskRow)) : el("p", { class: "mv-empty" }, "No tasks in this milestone.")));
};

/* ---------- the second gate: what the mission built ---------- */
const renderReview = () => {
  const tasks = allTasks();
  const passed = tasks.filter((t) => t.status === "passed");
  const ready = mission.status === "review";
  const closed = mission.status === "closed";
  const byPr = (mission.repos ?? []).some((r) => r.land === "pr");
  const landsAnywhere = (mission.repos ?? []).some((r) => r.land !== "merge");
  show(
    el("div", { class: "detail-head" }, el("h1", {}, "What the mission built"), el("span", { class: `verdict ${mission.status}` }, mission.status)),
    el("div", { class: "detail-meta" },
      el("span", {}, `${passed.length} of ${tasks.length} tasks passed`),
      ...(mission.repos ?? []).map((r) => el("span", { title: `lands against ${r.base}` }, `${r.label} · ${r.branch}`)),
      mission.finished ? el("span", {}, `finished ${fmtTime(mission.finished)}`) : null),
    el("section", { class: "panel mv-gate" }, el("h2", {}, "Your second and last gate"),
      el("p", { class: "why" }, closed
        ? (byPr
            ? "Closed. Its items are ticked in the tracker and its pull requests are open below. Maverick has not merged anything and will not: this project's own rules say so."
            : `Closed. Its items are ticked in the tracker and the mission branches are waiting for the ship, which is what merges. Everything below is still here to read.`)
        : ready
          ? (byPr
              ? `Every milestone merged onto the mission branch in each repo. Check them out and test them yourself: they are branches, not claims. Closing ticks the tracker and opens one pull request per repo against its base. It stops there. This project forbids a tool merging, so the merge is yours.`
              : `Every milestone merged onto the mission branch in each repo. Check them out and test them yourself: they are branches, not claims. Closing ticks each passed item in the tracker and hands the branches on; Maverick does not merge a mission to a base, the ship does.`)
          : `Not finished: ${mission.milestones.filter((m) => !m.merged).length} of ${mission.milestones.length} milestones still to merge.`),
      (mission.repos ?? []).some((r) => r.landed) ? el("div", { class: "mv-repos" }, el("span", { class: "muted" }, "landed:"),
        ...(mission.repos ?? []).filter((r) => r.landed).map((r) => (r.landed.startsWith("http")
          ? el("a", { href: r.landed, target: "_blank" }, `${r.label} ↗`)
          : el("span", { title: `pushed to ${r.base}` }, `${r.label} · ${r.landed}`)))) : null,
      ready ? el("div", { class: "gate-actions" },
        btn(landsAnywhere ? "close it and land the work" : "close the mission and tick its items", async () => {
          const lands = (mission.repos ?? []).filter((r) => r.land !== "merge");
          const what = lands.length
            ? `Then, per repo: ${lands.map((r) => `${r.label} ${r.land === "push" ? `pushed to ${r.base}` : `a pull request against ${r.base}`}`).join(", ")}.`
            : "The mission branches are left for the ship.";
          if (!window.confirm(`Close "${mission.name}"?\n\nThis ticks ${passed.length} item(s) in the tracker in one commit. ${what}`)) return;
          await act("close", {}, byPr ? "closed; pull requests opened" : "mission closed; its items are ticked");
        }, "primary"),
        el("a", { class: "button-link", href: `/?project=${encodeURIComponent(projectId)}&view=workspace` }, "back to the workspace"),
      ) : null,
      closed ? el("div", { class: "gate-actions" },
        btn("take back the worktrees", async () => {
          if (!window.confirm("Remove the worktree each task was built in?\n\nThe branches stay, so nothing is lost. Only the directories go.")) return;
          try {
            const { removed } = await post(actionUrl("tidy"), {});
            setStatus(removed.length ? `${removed.length} worktree(s) removed` : "nothing left to remove");
          } catch (err) {
            setStatus(err.message, true);
          }
        }, "ghost"),
        el("span", { class: "muted small" }, "the branches stay; this only clears the directories")) : null),
    ...mission.milestones.map((m) => el("section", { class: "panel" },
      el("h2", {}, `Milestone ${m.n} — ${m.title}`, el("span", { class: "spacer" }), merges(m) ? el("span", { class: "muted small mono" }, `merged as ${merges(m)}`) : null),
      ...tasksOf(m).map(taskRow))));
};

const renderAll = () => {
  detachTerminal();
  renderTop();
  renderNav();
  if (selected === "plan") renderPlan();
  else if (selected === "review") renderReview();
  else renderMilestone(mission.milestones.find((m) => `m${m.n}` === selected) ?? mission.milestones[0]);
};

const boot = async () => {
  if (!projectId || !missionId) {
    setStatus("open this page from the board's rail: ?project=<id>&mission=<id>", true);
    return;
  }
  const projects = await api("/api/projects");
  project = projects.find((p) => p.id === projectId);
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
  await load();
  // Reloading rebuilds the detail, which would tear down a terminal being typed into.
  // A hidden tab would otherwise keep driving a full server sweep, and its git calls, forever.
  window.setInterval(() => { if (!document.hidden && mission?.status === "flying" && selected !== "plan") load().catch((err) => setStatus(err.message, true)); }, 8000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && mission?.status === "flying") load().catch(() => {}); });
};
boot().catch((err) => setStatus(err.message, true));
