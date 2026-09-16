// The mission page: one mission, saved, revisitable. Milestones down the left, the selected
// one's detail as the main read. Cory is in the loop exactly twice and both gates live here:
// the plan he blesses before anything spawns, and the finished mission he reads and tests.

import { jetSvg } from "./jet.js";
import { lamp } from "./lamp.js";
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

/* ---------- theme, same as the board ---------- */
const applyTheme = (theme) => {
  if (!theme) return;
  const root = document.documentElement.style;
  root.setProperty("--accent", theme.accent);
  root.setProperty("--accent-hot", theme.accentHot);
  root.setProperty("--display", `"${theme.font}", "Chakra Petch", "IBM Plex Sans", sans-serif`);
  if (theme.font !== "Chakra Petch") document.head.append(el("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font).replace(/%20/g, "+")}:wght@500;600;700&display=swap` }));
};

/* ---------- the interview's terminal, mounted inside the mission's own view ---------- */
let attached = null;
const detachTerminal = () => {
  if (!attached) return;
  attached.source.close();
  attached.term.dispose();
  attached = null;
};
const mountTerminal = (host, terminalId) => {
  const term = new window.Terminal({ fontFamily: "JetBrains Mono, Menlo, monospace", fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, theme: { background: "#0a0c0f", foreground: "#e8ecf1" } });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  const source = new EventSource(`/api/terminals/${terminalId}/stream`);
  source.onmessage = (e) => term.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
  source.addEventListener("exit", () => { term.write("\r\n\x1b[2m[the RIO's session ended]\x1b[0m\r\n"); source.close(); });
  term.onData((data) => fetch(`/api/terminals/${terminalId}/input`, { method: "POST", body: data, keepalive: true }).catch(() => {}));
  term.onResize(({ cols, rows }) => post(`/api/terminals/${terminalId}/resize`, { cols, rows }).catch(() => {}));
  // xterm measures its own box, so fit after the new geometry has actually landed.
  requestAnimationFrame(() => { fit.fit(); term.focus(); });
  attached = { term, fit, source, terminalId };
};
window.addEventListener("resize", () => { if (attached) requestAnimationFrame(() => attached.fit.fit()); });

/* ---------- data ---------- */
const load = async () => {
  mission = await api(missionUrl());
  const keys = [...mission.milestones.map((m) => `m${m.n}`), "plan", "review"];
  if (!selected || !keys.includes(selected)) selected = mission.status === "interviewing" || mission.status === "planned" ? "plan" : (mission.milestones.find((m) => !m.merged) ?? mission.milestones[mission.milestones.length - 1]) ? `m${(mission.milestones.find((m) => !m.merged) ?? mission.milestones[mission.milestones.length - 1]).n}` : "plan";
  renderAll();
};
const act = async (action, body, said) => {
  try {
    await post(actionUrl(action), body);
    setStatus(said);
    await load();
  } catch (err) {
    setStatus(err.message, true);
  }
};

/* ---------- render ---------- */
const tasksOf = (m) => m.tasks ?? [];
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
    const tasks = tasksOf(m);
    const state = m.merged ? "passed" : tasks.some((t) => t.status === "handed-back") ? "handed-back" : m.dispatched ? "flying" : "pending";
    items.push(entry(`m${m.n}`, String(m.n), m.title, el("span", { class: `verdict ${state}` }, m.merged ? "merged" : state), state));
  });
  items.push(el("h3", {}, "The result"), entry("review", "R", "What the mission built", el("span", { class: `verdict ${mission.status === "review" || mission.status === "closed" ? "passed" : ""}` }, mission.status === "closed" ? "closed" : mission.status === "review" ? "ready" : "in flight")));
  nav.replaceChildren(...items);
};

const costBand = (cost) => el("div", { class: "mv-band" },
  el("div", { class: "cell" }, el("span", { class: "k" }, "milestones"), el("span", { class: "v" }, String(cost.milestones))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "tasks"), el("span", { class: "v" }, String(cost.tasks))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "sessions it spawns"), el("span", { class: "v" }, String(cost.sessions))),
  el("div", { class: "cell" }, el("span", { class: "k" }, "you are asked"), el("span", { class: "v" }, "twice")));

/* ---------- the plan, and the first gate ---------- */
const renderPlan = () => {
  const doc = mission.planDoc ?? {};
  const parsed = doc.parsed;
  const blocks = [
    el("div", { class: "detail-head" }, el("h1", {}, mission.name), el("span", { class: `verdict ${mission.status}` }, mission.status)),
    el("div", { class: "detail-meta" },
      el("span", {}, `opened ${fmtTime(mission.created)}`),
      mission.approved ? el("span", {}, `approved ${fmtTime(mission.approved)}`) : null,
      mission.planCommit ? el("span", {}, `planned into the tracker as ${mission.planCommit}`) : null),
    el("section", { class: "panel" }, el("h2", {}, "The line you opened with"), el("p", { class: "mv-plan" }, mission.brief)),
  ];

  if (!mission.approved) {
    const gate = [];
    if (!doc.found) {
      gate.push(el("p", { class: "why" }, `The RIO has not written a plan yet. It goes to ${mission.plan} when the interview is done. Answer it in the session below; it will not plan off your first line.`));
    } else if (parsed?.problems?.length) {
      gate.push(el("p", { class: "why" }, "There is a plan, but it cannot be flown as written. Tell the RIO in the session below; these are the reasons a Wingman would be sent out under-briefed:"),
        el("ul", { class: "mv-problems" }, ...parsed.problems.map((p) => el("li", {}, p))));
    } else {
      gate.push(el("p", { class: "why" }, "This is the one approval. Nothing has spawned: approving writes the plan into the tracker as items, cuts the mission's branch, and sends the first milestone out."),
        costBand(doc.cost),
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
        ...m.tasks.map((t) => el("div", { class: "mv-task" }, el("span", { class: "dot pending" }), el("span", { class: "t", title: t.title }, t.title), el("span", {}), el("span", {}), el("div", { class: "meta" }, t.intent.split("\n")[0])))))));
  } else if (doc.text) {
    blocks.push(el("section", { class: "panel" }, el("h2", {}, "The document as written"), renderMarkdown(doc.text, { project: projectId })));
  }

  // The interview is a conversation, so its session lives here rather than in a panel over the page.
  if (!mission.approved) {
    const host = el("div", { class: "term" });
    blocks.push(el("section", { class: "panel mv-interview" },
      el("h2", {}, "The RIO", el("span", { class: "spacer" }), btn("start a new interview session", () => act("interview", {}, "a new RIO session is open"), "ghost")),
      host));
    if (mission.interview?.terminalId) {
      requestAnimationFrame(() => mountTerminal(host, mission.interview.terminalId));
    } else {
      host.replaceChildren(el("p", { class: "mv-empty", style: "padding:14px" }, "No RIO session is attached. Start one above."));
    }
  }
  $("#detail").replaceChildren(...blocks);
};

/* ---------- a milestone in flight ---------- */
const taskRow = (m, task) => {
  const findings = mission.findings?.[task.id];
  const diff = mission.diffstat?.[task.id];
  const live = task.status === "flying" || task.status === "reviewing";
  return el("div", { class: "mv-task" },
    live ? lamp("busy") : el("span", { class: `dot ${task.status}` }),
    el("span", { class: "t", title: task.title }, task.title),
    el("span", { class: `verdict ${task.status}` }, task.status === "reviewing" ? "in review" : task.status),
    el("span", { class: "mv-acts" },
      task.status === "handed-back" ? btn("send it back out", () => act(`tasks/${task.id}/retry`, {}, `${task.title} is flying again`), "primary") : null,
      task.status === "handed-back" ? btn("accept it anyway", async () => {
        const note = window.prompt(`Accept "${task.title}" over the reviewer?\n\nSay why; it is kept on the task.`, "");
        if (note === null) return;
        await act(`tasks/${task.id}/accept`, { note }, `${task.title} accepted`);
      }, "ghost") : null),
    el("div", { class: "meta" }, [
      `attempt ${task.attempts}`,
      task.branch,
      task.claudeId ? `session ${task.claudeId}` : null,
      task.verdict ? `reviewer: ${task.verdict}` : null,
      task.commits ? `${task.commits.length} commit${task.commits.length === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · ")),
    task.note ? el("div", { class: "note" }, task.note) : null,
    diff ? el("pre", { class: "diffstat" }, diff) : null,
    findings ? el("details", {}, el("summary", { class: "muted small" }, "the reviewer's findings"), renderMarkdown(findings.replace(/^verdict:.*\n?/i, ""), { project: projectId })) : null);
};

const renderMilestone = (m) => {
  const tasks = tasksOf(m);
  $("#detail").replaceChildren(
    el("div", { class: "detail-head" },
      el("h1", {}, `Milestone ${m.n} — ${m.title}`),
      el("span", { class: `verdict ${m.merged ? "passed" : m.dispatched ? "flying" : "pending"}` }, m.merged ? "merged" : m.dispatched ? "flying" : "not sent yet")),
    el("div", { class: "detail-meta" },
      el("span", {}, `done when ${m.done}`),
      m.dispatched ? el("span", {}, `sent ${fmtTime(m.dispatched)}`) : null,
      m.merged ? el("span", {}, `merged ${fmtTime(m.merged)} as ${m.mergeSha}`) : null),
    mission.trouble ? el("section", { class: "panel" }, el("h2", {}, "Needs you"), el("p", { class: "mv-plan" }, mission.trouble)) : null,
    m.conflicts?.length ? el("section", { class: "panel" }, el("h2", {}, "It will not merge"), el("p", { class: "mv-plan" }, `These paths collided merging into ${mission.branch}: ${m.conflicts.join(", ")}. The merge was aborted, so nothing is half-applied.`)) : null,
    el("section", { class: "panel" },
      el("h2", {}, "Tasks", el("span", { class: "spacer" }), el("span", { class: "muted small" }, "one Wingman each, in its own worktree, reviewed by a session that did not write it")),
      tasks.length ? el("div", {}, ...tasks.map((t) => taskRow(m, t))) : el("p", { class: "mv-empty" }, "No tasks in this milestone.")));
};

/* ---------- the second gate: what the mission built ---------- */
const renderReview = () => {
  const tasks = allTasks();
  const passed = tasks.filter((t) => t.status === "passed");
  const ready = mission.status === "review";
  $("#detail").replaceChildren(
    el("div", { class: "detail-head" }, el("h1", {}, "What the mission built"), el("span", { class: `verdict ${mission.status}` }, mission.status)),
    el("div", { class: "detail-meta" },
      el("span", {}, `${passed.length} of ${tasks.length} tasks passed`),
      el("span", {}, `on ${mission.branch}`),
      mission.finished ? el("span", {}, `finished ${fmtTime(mission.finished)}`) : null),
    el("section", { class: "panel mv-gate" }, el("h2", {}, "Your second and last gate"),
      el("p", { class: "why" }, ready
        ? `Every milestone merged into ${mission.branch}. Check it out and test it yourself: it is a branch, not a claim. Closing ticks each passed item in the tracker and hands the branch on; Maverick does not merge a mission into main, the ship does.`
        : `Not finished. ${mission.milestones.filter((m) => !m.merged).length} milestone(s) still to merge.`),
      ready ? el("div", { class: "gate-actions" },
        btn("close the mission and tick its items", async () => {
          if (!window.confirm(`Close "${mission.name}"?\n\nThis ticks ${passed.length} item(s) in the tracker in one commit. The branch ${mission.branch} is left for the ship.`)) return;
          await act("close", {}, "mission closed; its items are ticked");
        }, "primary"),
        el("a", { class: "button-link", href: `/?project=${encodeURIComponent(projectId)}` }, "open the board"),
      ) : null),
    ...mission.milestones.map((m) => el("section", { class: "panel" },
      el("h2", {}, `Milestone ${m.n} — ${m.title}`, el("span", { class: "spacer" }), m.mergeSha ? el("span", { class: "muted small mono" }, `merged as ${m.mergeSha}`) : null),
      ...tasksOf(m).map((t) => taskRow(m, t)))));
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
  $("#board-link").href = `/?project=${encodeURIComponent(projectId)}`;
  $("#back").href = `/?project=${encodeURIComponent(projectId)}`;
  await load();
  // Reloading rebuilds the detail, which would tear down a terminal being typed into.
  window.setInterval(() => { if (mission && mission.status === "flying" && selected !== "plan") load(); }, 8000);
};
boot().catch((err) => setStatus(err.message, true));
