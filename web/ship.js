// The ship page: one shipment, saved, revisitable. Steps down the left, the selected step's
// report rendered as prose with the human's items as checkboxes, the live session view, the
// documents inline, notes, and the release's session reviews and audit verdicts.

import { jetSvg } from "./jet.js";
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso ?? "";
};
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

const params = new URLSearchParams(location.search);
const projectId = params.get("project");
const version = (params.get("version") ?? "").replace(/^v/, "");
let project = null;
let ship = null;
let selected = params.get("step") ?? null;
let agentStates = new Map();
let sessions = [];

const shipUrl = () => `/api/ships/${encodeURIComponent(version)}?project=${encodeURIComponent(projectId)}`;
const stepUrl = (step, action) => `/api/ships/${encodeURIComponent(version)}/steps/${encodeURIComponent(step.id)}${action ? `/${action}` : ""}?project=${encodeURIComponent(projectId)}`;

/* ---------- theme, same as the board ---------- */
const applyTheme = (theme) => {
  if (!theme) return;
  const root = document.documentElement.style;
  root.setProperty("--accent", theme.accent);
  root.setProperty("--accent-hot", theme.accentHot);
  root.setProperty("--display", `"${theme.font}", "Chakra Petch", "IBM Plex Sans", sans-serif`);
  if (theme.font !== "Chakra Petch") document.head.append(el("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font).replace(/%20/g, "+")}:wght@500;600;700&display=swap` }));
};

/* ---------- live view of a session (hidden xterm, read back as text) ---------- */
const tails = new Map();
const stopTails = () => {
  for (const t of tails.values()) {
    t.source.close();
    t.term.dispose();
    t.host.remove();
    window.clearInterval(t.timer);
  }
  tails.clear();
};
const terminalFor = async (claudeId, title) => {
  const open = await api("/api/terminals");
  const existing = open.find((t) => t.exitCode === null && t.command.join(" ") === `claude attach ${claudeId}`);
  return existing ?? post("/api/terminals", { project: projectId, kind: "attach", id: claudeId, title, cols: 110, rows: 32 });
};
const tailInto = async (node, claudeId, title) => {
  if (tails.has(claudeId)) return;
  if (params.has("nodock")) {
    node.textContent = "(live view off in capture mode)";
    return;
  }
  const info = await terminalFor(claudeId, title);
  const host = el("div", { class: "tail-host", "aria-hidden": "true" });
  document.body.append(host);
  const term = new window.Terminal({ cols: 110, rows: 32, allowProposedApi: true });
  term.open(host);
  const source = new EventSource(`/api/terminals/${info.id}/stream`);
  source.onmessage = (e) => term.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
  const paint = () => {
    const buffer = term.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i += 1) {
      const line = buffer.getLine(i)?.translateToString(true) ?? "";
      if (line.trim()) lines.push(line.replace(/\s+$/, ""));
    }
    node.textContent = lines.slice(-24).join("\n") || "(no output yet)";
  };
  const timer = window.setInterval(paint, 1200);
  tails.set(claudeId, { source, term, host, timer, info });
  paint();
};

/* ---------- dock (same shape as the board's) ---------- */
const dockTerminals = new Map();
let activeTerminal = null;
const activate = (id) => {
  activeTerminal = id;
  for (const [tid, t] of dockTerminals) {
    t.tab.classList.toggle("active", tid === id);
    t.container.hidden = tid !== id;
    if (tid === id) {
      t.fit.fit();
      t.term.focus();
      post(`/api/terminals/${id}/resize`, { cols: t.term.cols, rows: t.term.rows }).catch(() => {});
    }
  }
};
const mountTerminal = (info) => {
  $("#dock").hidden = false;
  document.body.classList.add("docked");
  const term = new window.Terminal({ fontFamily: "JetBrains Mono, Menlo, monospace", fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, theme: { background: "#0a0c0f", foreground: "#e8ecf1" } });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  const container = el("div", { class: "term" });
  $("#dock-body").append(container);
  term.open(container);
  const tab = el("div", { class: "dock-tab" },
    el("button", { type: "button", class: "name", title: info.title, onclick: () => activate(info.id) }, el("span", { class: "lamp" }), el("span", { class: "t" }, info.title)),
    el("button", { type: "button", class: "close", title: "close this view (the session keeps running)", "aria-label": `close ${info.title}`, onclick: () => { source.close(); term.dispose(); tab.remove(); container.remove(); dockTerminals.delete(info.id); if (!dockTerminals.size) { $("#dock").hidden = true; document.body.classList.remove("docked"); } } }, "×"));
  $("#dock-tabs").append(tab);
  const source = new EventSource(`/api/terminals/${info.id}/stream`);
  source.onmessage = (e) => term.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
  source.addEventListener("exit", (e) => { tab.classList.add("exited"); term.write(`\r\n\x1b[2m[process exited with ${e.data}]\x1b[0m\r\n`); source.close(); });
  term.onData((data) => fetch(`/api/terminals/${info.id}/input`, { method: "POST", body: data, keepalive: true }).catch(() => {}));
  term.onResize(({ cols, rows }) => post(`/api/terminals/${info.id}/resize`, { cols, rows }).catch(() => {}));
  dockTerminals.set(info.id, { term, fit, tab, container, source });
  activate(info.id);
};
window.addEventListener("resize", () => { if (activeTerminal) dockTerminals.get(activeTerminal)?.fit.fit(); });

/* ---------- data ---------- */
const load = async () => {
  ship = await api(shipUrl());
  if (!ship) ship = await post("/api/ships", { project: projectId, version });
  try {
    const live = await api(`/api/live?project=${encodeURIComponent(projectId)}`);
    agentStates = new Map(live.backgroundAgents.map((a) => [a.id, a.state ?? ""]));
  } catch {
    /* best effort */
  }
  sessions = await api(`/api/sessions?project=${encodeURIComponent(projectId)}`);
  if (!selected || !ship.steps.some((s) => s.id === selected)) selected = (ship.steps.find((s) => s.status !== "done" && s.status !== "skipped") ?? ship.steps[0]).id;
  renderAll();
};

const stepCall = async (step, action, body) => {
  try {
    await post(stepUrl(step, action), body);
    setStatus(action === "run" ? `${step.title}: started` : "saved");
    await load();
  } catch (err) {
    setStatus(err.message, true);
  }
};


/* ---------- a hosted walkthrough: the document inside the step, its verdicts read live ---------- */

const WALKTHROUGH_DOC = /deliverables\/testing\/.*walkthrough.*\.html$/;
let walkthroughTimer = null;

const walkthroughPanel = (step) => {
  const doc = (step.artifacts ?? []).find((a) => WALKTHROUGH_DOC.test(a));
  if (!doc) return null;
  const url = `/files?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(doc)}`;
  const bar = el("div", { class: "runway small" }, el("div", { class: "fill", style: "width:0%" }));
  const count = el("span", { class: "mono small muted" }, "reading the document…");
  const pillars = el("div", { class: "pillars" });
  const frame = el("iframe", { class: "doc-frame tall", src: url, title: doc });
  let cases = [];
  let key = null;

  const readState = () => {
    if (!key) return {};
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? {}; } catch { return {}; }
  };
  const paint = () => {
    const state = readState();
    const answered = cases.filter((c) => state[c.id]?.v);
    const pct = cases.length ? (answered.length / cases.length) * 100 : 0;
    bar.firstChild.style.width = `${pct}%`;
    count.textContent = cases.length ? `${answered.length} of ${cases.length} cases answered` : "no cases found in the document";
    const byPillar = new Map();
    for (const c of cases) {
      const p = byPillar.get(c.pillar) ?? { total: 0, done: 0, verdicts: {} };
      p.total += 1;
      const v = state[c.id]?.v;
      if (v) { p.done += 1; p.verdicts[v] = (p.verdicts[v] ?? 0) + 1; }
      byPillar.set(c.pillar, p);
    }
    pillars.replaceChildren(...[...byPillar.entries()].map(([name, p]) => el("div", { class: `pillar${p.done === p.total ? " complete" : ""}` }, el("span", { class: "pname" }, name), el("span", { class: "pcount mono" }, `${p.done}/${p.total}`), el("span", { class: "pverdicts mono small muted" }, Object.entries(p.verdicts).map(([v, n]) => `${v} ${n}`).join(" · ")))));
    return { answered: answered.length, verdicts: Object.fromEntries(answered.map((c) => [c.id, state[c.id].v])) };
  };
  let lastSaved = "";
  const save = async () => {
    const { answered, verdicts } = paint();
    if (!key || !cases.length) return;
    const summary = { doc, key, total: cases.length, answered, verdicts, updatedAt: new Date().toISOString() };
    const fingerprint = JSON.stringify(verdicts);
    if (fingerprint === lastSaved) return;
    lastSaved = fingerprint;
    step.walkthrough = summary;
    try {
      const complete = summary.total > 0 && summary.answered >= summary.total && step.status === "finished";
      await post(stepUrl(step, ""), { walkthrough: summary, ...(complete ? { status: "done" } : {}) });
      if (complete) { step.status = "done"; setStatus("walkthrough complete: step marked done"); }
    } catch (err) {
      setStatus(`${err.message} (walkthrough progress will save after the server restarts)`, true);
    }
  };
  frame.addEventListener("load", () => {
    try {
      const d = frame.contentDocument;
      const text = d.documentElement.innerHTML;
      key = text.match(/KEY\s*=\s*"([^"]+)"/)?.[1] ?? null;
      cases = [];
      let pillar = "";
      for (const node of d.querySelectorAll("h2, .tc[data-id]")) {
        if (node.tagName === "H2") pillar = node.textContent.trim();
        else cases.push({ id: node.dataset.id, pillar });
      }
      save();
    } catch (err) {
      count.textContent = `could not read the document: ${err.message}`;
    }
  });
  window.addEventListener("storage", save);
  window.clearInterval(walkthroughTimer);
  walkthroughTimer = window.setInterval(save, 4000);

  const saved = step.walkthrough;
  return el("section", { class: "panel walkthrough-panel" },
    el("h2", {}, "Walkthrough", el("span", { class: "spacer" }), count, el("a", { href: url, target: "_blank", class: "mono small" }, "open in its own tab ↗")),
    el("div", { class: "wt-progress" }, bar),
    saved ? el("div", { class: "muted small mono" }, `last saved ${fmtTime(saved.updatedAt)} · ${saved.answered} of ${saved.total}`) : null,
    pillars,
    frame);
};

/* ---------- render ---------- */
const jetGlyph = () => jetSvg("jet-glyph");

const renderTop = () => {
  const done = ship.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const pct = (done / ship.steps.length) * 100;
  $("#crumb").replaceChildren(text("Ship "), el("b", {}, `v${version}`));
  $("#top").replaceChildren(
    el("div", { class: "ship-progress" }, el("div", { class: "runway" }, el("div", { class: "fill", style: `width:${pct}%` }), el("div", { class: "jet-marker", style: `left:${pct}%` }, jetGlyph()))),
    el("div", { class: "summary" }, el("span", {}, `${done} of ${ship.steps.length} steps`), el("span", {}, `started ${fmtDate(ship.started)}`), ship.finished ? el("span", {}, `shipped ${fmtDate(ship.finished)}`) : null),
  );
};

const renderNav = () => {
  const nav = $("#nav");
  nav.replaceChildren();
  ship.steps.forEach((step, i) => {
    nav.append(el("button", {
      type: "button",
      class: `nav-step ${step.status}${step.id === selected ? " selected" : ""}`,
      onclick: () => { selected = step.id; history.replaceState(null, "", `?project=${encodeURIComponent(projectId)}&version=${encodeURIComponent(version)}&step=${encodeURIComponent(step.id)}`); renderAll(); },
    },
      el("span", { class: `lamp ${step.status === "running" ? "busy" : ""}` }),
      el("span", { class: "n" }, String(i + 1)),
      el("span", { class: "t", title: step.title }, step.title),
      el("span", { class: `verdict ${step.status}` }, step.status)));
  });
  nav.append(el("h3", {}, "Reviews"), el("button", { type: "button", class: `nav-step${selected === "__reviews" ? " selected" : ""}`, onclick: () => { selected = "__reviews"; renderAll(); } }, el("span", { class: "lamp" }), el("span", { class: "n" }, "R"), el("span", { class: "t" }, "Sessions and audits in this release"), el("span", {})));
};

const humanCheckboxes = (step) => ({
  checks: step.checks ?? {},
  onCheck: async (key, label, done) => {
    try {
      await post(stepUrl(step, ""), { checks: { ...(step.checks ?? {}), [key]: done ? { done: true, label, at: new Date().toISOString() } : { done: false, label } } });
      step.checks = { ...(step.checks ?? {}), [key]: { done, label } };
      setStatus(done ? `checked: ${label.slice(0, 60)}` : `unchecked: ${label.slice(0, 60)}`);
    } catch (err) {
      setStatus(`${err.message} (the server needs a restart to save checks)`, true);
    }
  },
});

const renderStep = (step) => {
  const detail = $("#detail");
  const head = el("div", { class: "detail-head" },
    el("h1", {}, step.title),
    el("span", { class: `verdict ${step.status}` }, step.status === "finished" ? (step.id === "walkthrough" ? `in progress · ${step.walkthrough ? `${step.walkthrough.answered} of ${step.walkthrough.total} cases` : "your walkthrough"}` : "in progress · your part remains") : step.status),
    step.status === "running" ? el("span", { class: `agent-state ${agentStates.get(step.claudeId) ?? ""}` }, agentStates.get(step.claudeId) === "blocked" ? "waiting for your input" : agentStates.get(step.claudeId) ?? "starting") : null,
    el("span", { class: "actions" },
      step.status === "pending" || step.status === "failed" ? btn(step.id === "audits" ? "run audits" : "run", () => stepCall(step, "run"), "primary") : null,
      step.claudeId ? btn("open in dock", async () => { const t = tails.get(step.claudeId); mountTerminal(t?.info ?? (await terminalFor(step.claudeId, `ship ${version}: ${step.title}`))); }) : null,
      step.status !== "done" && step.status !== "skipped" && step.status !== "pending" ? btn("mark done", () => stepCall(step, "", { status: "done" })) : null,
      step.status === "pending" ? btn("skip", () => stepCall(step, "", { status: "skipped" }), "ghost") : null,
      step.status === "done" || step.status === "skipped" ? btn("reopen", () => stepCall(step, "", { status: "pending" }), "ghost") : null));
  const meta = el("div", { class: "detail-meta" },
    step.started ? el("span", {}, `started ${fmtTime(step.started)}`) : null,
    step.ended ? el("span", {}, `${step.status} ${fmtTime(step.ended)}`) : null,
    step.claudeId ? el("span", {}, `session ${step.claudeId}`) : null);

  const blocks = [head, meta];
  if (step.status === "running" && step.claudeId) {
    const live = el("pre", { class: "ship-live" }, "connecting to the session…");
    blocks.push(el("section", { class: "panel live-panel" }, el("h2", {}, "Live", el("span", { class: "spacer" }), el("span", { class: "muted small" }, "the session's screen, refreshed as it runs")), live));
    tailInto(live, step.claudeId, `ship ${version}: ${step.title}`).catch((err) => { live.textContent = err.message; });
  }
  // The walkthrough document is the step; it comes before the session's report about building it.
  const wt = walkthroughPanel(step);
  if (wt) blocks.push(wt);
  if (step.report) {
    const checkCount = Object.values(step.checks ?? {}).filter((c) => c?.done).length;
    blocks.push(el("section", { class: "panel" }, el("h2", {}, "Report", el("span", { class: "spacer" }), checkCount ? el("span", { class: "muted small" }, `${checkCount} human item${checkCount === 1 ? "" : "s"} checked`) : null), renderMarkdown(step.report, { project: projectId, ...humanCheckboxes(step) })));
  }
  if (step.artifacts?.length) {
    const row = el("div", { class: "artifact-row" });
    const frameHost = el("div");
    for (const a of step.artifacts) {
      if (wt && WALKTHROUGH_DOC.test(a)) continue;
      const url = `/files?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(a)}`;
      row.append(el("a", { href: url, target: "_blank" }, `${a} ↗`));
      if (a.endsWith(".html")) row.append(btn("view here", () => { frameHost.replaceChildren(el("iframe", { class: "doc-frame", src: url, title: a })); }, "ghost"));
    }
    blocks.push(el("section", { class: "panel" }, el("h2", {}, "Documents"), row, frameHost));
  }
  const notes = el("textarea", { class: "ship-notes", rows: "3", placeholder: "notes for this step (saved as you leave the field)" });
  notes.value = step.notes ?? "";
  notes.addEventListener("change", () => stepCall(step, "", { notes: notes.value }));
  blocks.push(el("section", { class: "panel" }, el("h2", {}, "Notes"), notes));
  detail.replaceChildren(...blocks);
};

const renderReviews = () => {
  const detail = $("#detail");
  const since = ship.started;
  const tasks = sessions.filter((r) => r.role === "develop" && r.started >= new Date(new Date(since).getTime() - 14 * 86400000).toISOString());
  const list = el("div");
  for (const r of tasks) {
    const v = r.auditView ?? { verdict: "none" };
    const item = el("div", { class: "review-item" },
      el("div", { class: "head" }, el("span", { class: "role" }, r.role), el("span", { class: "loop" }, r.loop), el("span", { class: `verdict ${v.verdict}` }, v.verdict === "none" ? "not audited" : v.verdict), v.decision ? el("span", { class: "muted small mono" }, v.decision) : null,
        r.claudeId && v.verdict === "none" ? btn("audit now", async () => { try { await post(`/api/sessions/${r.id}/audit?project=${encodeURIComponent(projectId)}`); setStatus("audit started"); await load(); } catch (err) { setStatus(err.message, true); } }, "primary") : null,
        v.findings ? btn(v.decision ? "change decision" : "accept", async () => { await post(`/api/sessions/${r.id}/decision`, { decision: "accepted" }); await load(); }, "ghost") : null,
        v.findings ? btn("reject", async () => { await post(`/api/sessions/${r.id}/decision`, { decision: "rejected" }); await load(); }, "ghost danger") : null),
      v.findings ? renderMarkdown(v.findings.replace(/^verdict:.*\n?/i, ""), { project: projectId }) : el("div", { class: "muted small" }, r.claudeId ? "no findings yet" : "not a spawned session; nothing to audit"));
    list.append(item);
  }
  if (!tasks.length) list.append(el("div", { class: "muted" }, "No task sessions recorded for this project in the two weeks before this ship started. Spawn work from cards and it shows up here with its audit."));
  detail.replaceChildren(
    el("div", { class: "detail-head" }, el("h1", {}, "Sessions and audits in this release")),
    el("div", { class: "detail-meta" }, el("span", {}, `${tasks.length} task sessions · ${tasks.filter((r) => r.auditView?.verdict && r.auditView.verdict !== "none").length} audited`)),
    el("section", { class: "panel" }, list));
};

const renderAll = () => {
  stopTails();
  window.clearInterval(walkthroughTimer);
  renderTop();
  renderNav();
  if (selected === "__reviews") renderReviews();
  else renderStep(ship.steps.find((s) => s.id === selected));
};

const boot = async () => {
  if (!projectId || !version) {
    setStatus("open this page from a release card: ?project=<id>&version=<x.y.z>", true);
    return;
  }
  const projects = await api("/api/projects");
  project = projects.find((p) => p.id === projectId);
  if (!project) {
    setStatus(`no project "${projectId}"`, true);
    return;
  }
  document.title = `Ship v${version} · ${project.name} · Maverick`;
  applyTheme(project.theme);
  $("#board-link").href = `/?project=${encodeURIComponent(projectId)}`;
  $("#back").href = `/?project=${encodeURIComponent(projectId)}`;
  await load();
  window.setInterval(() => { if (ship?.steps.some((s) => s.status === "running")) load(); }, 8000);
};
boot().catch((err) => setStatus(err.message, true));
