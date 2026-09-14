// The console UI. Plain DOM and fetch; the same file runs in a browser or an Electron
// window because it only ever talks to /api/*. One project at a time: `?project=<id>`
// selects it, no parameter shows the picker.

const LANES = [
  ["priority", "Runway", "runway"],
  ["in-progress", "In progress", ""],
  ["backlog", "Backlog", ""],
  ["shipped", "Shipped", ""],
];

/** Tags that mark engineering work. Items carrying any of these (or no tag at all) are development items. */
const DEV_TAGS = new Set(["ENG", "DEBT", "GS", "INFRA", "OPS", "DOCS", "UI", "TEST", "DESIGN", "FEATURE", "BUG", "FIX", "PERF", "E2E"]);
const ADMIN_TAGS = new Set(["BIZ", "STRATEGY", "NOTE", "IDEA", "DECISION", "MEETING", "SALES", "LEGAL"]);

const isDevItem = (item) => {
  const tags = item.tags.map((t) => t.toUpperCase());
  if (tags.some((t) => ADMIN_TAGS.has(t))) return tags.some((t) => DEV_TAGS.has(t));
  return true;
};

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

const setStatus = (msg, isError = false) => {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
};

const api = async (path, init) => {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${res.status} on ${path}`);
  return body;
};
const post = (path, body) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

const projectId = new URLSearchParams(location.search).get("project");
let project = null;
let showAll = false;
try {
  showAll = localStorage.getItem("console.showAll") === "1";
} catch {}

/* ---------- picker ---------- */

const renderPicker = async () => {
  $("#picker").hidden = false;
  const projects = await api("/api/projects");
  const list = $("#project-list");
  list.replaceChildren(
    ...projects.map((p) =>
      el(
        "li",
        {},
        el("a", { href: `/?project=${encodeURIComponent(p.id)}` }, p.name),
        el("div", { class: "muted mono" }, `${p.path} · ${p.trackers.length ? p.trackers.map((t) => t.label).join(", ") : "no tracker found"}`),
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            onclick: async () => {
              if (!confirm(`Forget "${p.name}"? The directory is untouched.`)) return;
              await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
              renderPicker();
            },
          },
          "forget",
        ),
      ),
    ),
  );
  if (!projects.length) list.append(el("li", { class: "muted" }, "No projects yet. Import one below."));
};

$("#import").addEventListener("click", async () => {
  setStatus("Waiting for the Finder dialog");
  try {
    const result = await post("/api/projects/import");
    if (result.cancelled) return setStatus("Cancelled.");
    location.href = `/?project=${encodeURIComponent(result.id)}`;
  } catch (err) {
    setStatus(err.message, true);
  }
});

$("#add-path").addEventListener("submit", async (e) => {
  e.preventDefault();
  const path = new FormData(e.currentTarget).get("path").trim();
  if (!path) return;
  try {
    const p = await post("/api/projects", { path });
    location.href = `/?project=${encodeURIComponent(p.id)}`;
  } catch (err) {
    setStatus(err.message, true);
  }
});

/* ---------- board ---------- */

let dragging = null;

const cardFor = (trackerIndex, item, number) =>
  el(
    "div",
    {
      class: `card${item.checked ? " checked" : ""}`,
      draggable: "true",
      title: item.body,
      ondragstart: (e) => {
        dragging = { trackerIndex, item };
        e.currentTarget.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      },
      ondragend: (e) => {
        e.currentTarget.classList.remove("dragging");
        dragging = null;
      },
    },
    el("span", { class: "num" }, number === null ? "" : String(number)),
    el("div", { class: "title" }, item.title),
    el("div", { class: "meta" }, item.tags.length ? el("span", { class: "tag" }, item.tags.map((t) => `[${t}]`).join(" ")) : null, el("span", {}, `L${item.start + 1}`)),
    el(
      "button",
      {
        type: "button",
        class: "spawn primary",
        title: "Spawn a headless Claude session on this item and open it below",
        onclick: (e) => {
          e.stopPropagation();
          spawnOnItem(item);
        },
      },
      "spawn",
    ),
  );

/** Index the dragged card would take among a list's visible cards, from the pointer's y position. */
const dropIndexIn = (list, y) => {
  const cards = [...list.querySelectorAll(".card:not(.dragging)")];
  const idx = cards.findIndex((c) => y < c.getBoundingClientRect().top + c.offsetHeight / 2);
  return idx < 0 ? cards.length : idx;
};

const itemsList = (trackerIndex, section, group, numbered) => {
  const list = el("div", { class: "items" });
  const visible = group.items.filter((item) => showAll || isDevItem(item));
  visible.forEach((item, i) => list.append(cardFor(trackerIndex, item, numbered ? i + 1 : null)));
  list.addEventListener("dragover", (e) => {
    if (!dragging || dragging.trackerIndex !== trackerIndex) return;
    e.preventDefault();
    list.classList.add("over");
  });
  list.addEventListener("dragleave", () => list.classList.remove("over"));
  list.addEventListener("drop", async (e) => {
    e.preventDefault();
    list.classList.remove("over");
    if (!dragging || dragging.trackerIndex !== trackerIndex) return;
    const { item } = dragging;
    // The drop index counts visible cards; the file move needs the index among ALL items
    // in the group, so land before the visible neighbour, or at the group's end.
    const visibleOthers = visible.filter((v) => v.start !== item.start);
    const visibleIdx = dropIndexIn(list, e.clientY);
    const neighbour = visibleOthers[visibleIdx];
    const others = group.items.filter((v) => v.start !== item.start);
    const targetIndex = neighbour ? others.findIndex((v) => v.start === neighbour.start) : others.length;
    setStatus(`moving "${item.title.slice(0, 50)}"`);
    try {
      const { commit } = await post("/api/move", {
        project: projectId,
        tracker: trackerIndex,
        itemStart: item.start,
        itemFirstLine: item.firstLine,
        targetHeading: section.heading,
        targetGroup: group.name,
        targetIndex,
      });
      setStatus(`committed ${commit}`);
    } catch (err) {
      setStatus(err.message, true);
    }
    await loadBoard();
  });
  return list;
};

const renderBoard = (tracker) => {
  const lanes = el("div", { class: "lanes" });
  for (const [columnId, label, extraClass] of LANES) {
    const sections = tracker.sections.filter((s) => s.column === columnId);
    const count = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.filter((i) => showAll || isDevItem(i)).length, 0), 0);
    const lane = el("div", { class: `lane ${extraClass}` }, el("h3", { class: "lane-title" }, label, el("span", { class: "count" }, String(count))));
    for (const section of sections) {
      if (sections.length > 1) lane.append(el("div", { class: "group-name" }, section.heading));
      for (const group of section.groups) {
        if (group.name) lane.append(el("div", { class: "group-name" }, group.name.replace(/\[.*?\]\(.*?\)/g, "").trim()));
        lane.append(itemsList(tracker.index, section, group, columnId === "priority"));
      }
    }
    lanes.append(lane);
  }
  return el(
    "section",
    { class: "board" },
    el("div", { class: "board-title" }, el("h2", {}, tracker.label), el("code", {}, tracker.path.replace(project.path, "").replace(/^\//, ""))),
    lanes,
  );
};

const loadBoard = async () => {
  try {
    const trackers = await api(`/api/board?project=${encodeURIComponent(projectId)}`);
    $("#boards").replaceChildren(...trackers.map(renderBoard));
    if (!trackers.length) $("#boards").append(el("p", { class: "muted" }, "No tracker file the console recognises (CHECKLIST.md, PUNCHLIST.md, TODO.md)."));
  } catch (err) {
    setStatus(err.message, true);
  }
};

/* ---------- sessions ---------- */

const sessionRow = (cls, name, sub, actions, lampTitle) =>
  el(
    "li",
    { class: `row ${cls}` },
    el("span", { class: "lamp", title: lampTitle ?? "" }),
    el("span", { class: "name" }, ...[].concat(name)),
    el("span", { class: "actions" }, ...actions),
    sub ? el("span", { class: "sub" }, sub) : null,
  );

const btn = (label, onclick, cls = "") => el("button", { type: "button", class: cls, onclick }, label);

const renderSessions = (records, live) => {
  const out = document.createDocumentFragment();
  const byClaudeId = new Map(records.filter((r) => r.claudeId).map((r) => [r.claudeId, r]));

  const running = el("ul");
  for (const s of live.claudeSessions) {
    running.append(
      sessionRow(
        s.status ?? "",
        `${s.name ?? s.pid}`,
        `${s.status ?? "?"}${s.waitingFor ? ` · ${s.waitingFor}` : ""} · ${s.cwd.replace(project.path, "").replace(/^\//, "") || "."}`,
        [btn("open", () => openTerminal({ kind: "resume", sessionId: s.sessionId, title: s.name ?? s.sessionId.slice(0, 8) }))],
        `pid ${s.pid}`,
      ),
    );
  }
  for (const a of live.backgroundAgents) {
    const record = byClaudeId.get(a.id);
    running.append(
      sessionRow(
        a.state ?? "",
        record ? [el("span", { class: "role" }, record.role), text(record.loop)] : (a.name ?? a.id),
        `bg · ${a.state ?? "?"} · ${a.id}`,
        [
          btn("open", () => openTerminal({ kind: "attach", id: a.id, title: record?.loop ?? a.name ?? a.id })),
          btn("stop", async () => {
            if (!confirm(`Stop background session ${a.id}? Its conversation is kept.`)) return;
            await post(`/api/agents/${a.id}/stop`);
            loadRail(true);
          }, "danger"),
        ],
      ),
    );
  }
  if (!running.childElementCount) running.append(el("li", { class: "empty" }, "nothing running under this project"));
  out.append(el("h3", {}, "Running"), running);

  const recorded = records.filter((r) => !r.claudeId || !live.backgroundAgents.some((a) => a.id === r.claudeId));
  if (recorded.length) {
    const byParent = new Map();
    for (const r of recorded) {
      const key = r.parent ?? "";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(r);
    }
    const list = el("ul");
    const walk = (parent, depth) => {
      for (const r of byParent.get(parent) ?? []) {
        list.append(
          el(
            "li",
            { class: `row record ${r.status}`, style: `--depth:${depth}`, title: r.handoff ?? "" },
            el("span", { class: "lamp" }),
            el("span", { class: "name" }, el("span", { class: "role" }, r.role), text(r.loop)),
            el("span", {}),
            el("span", { class: "sub" }, `${r.status}${r.pr ? ` · ${r.pr}` : ""}${r.handoff ? ` · ${r.handoff}` : ""}`),
          ),
        );
        walk(r.id, depth + 1);
      }
    };
    walk("", 0);
    out.append(el("h3", {}, "Recorded"), list);
  }
  return out;
};

const renderLive = (live) => {
  const out = document.createDocumentFragment();
  const servers = el("ul");
  for (const s of live.devServers) servers.append(sessionRow("running", `${s.branch ?? "?"}`, `http://localhost:${s.port}`, [el("a", { href: `http://localhost:${s.port}`, target: "_blank" }, "open")]));
  if (live.devServers.length) out.append(el("h3", {}, "Dev servers"), servers);

  const repos = el("ul");
  for (const repo of live.repos) {
    for (const pr of repo.pullRequests) {
      repos.append(sessionRow(pr.isDraft ? "idle" : "waiting", [el("a", { href: pr.url, target: "_blank" }, `#${pr.number}`), text(` ${pr.title}`)], `${repo.label} · ${pr.headRefName} → ${pr.baseRefName}${pr.isDraft ? " · draft" : ""}`, []));
    }
    for (const wt of repo.worktrees) {
      if (wt.path === repo.path) continue;
      repos.append(sessionRow("idle", wt.branch, `${repo.label} · worktree @ ${wt.head}`, [btn("open", () => openTerminal({ kind: "new", title: wt.branch, cwd: wt.path }))]));
    }
    if (repo.error) repos.append(el("li", { class: "empty" }, `${repo.label}: ${repo.error}`));
  }
  if (repos.childElementCount) out.append(el("h3", {}, "PRs and worktrees"), repos);
  out.append(el("div", { class: "muted small mono" }, `signals ${new Date(live.fetchedAt).toLocaleTimeString()}`));
  return out;
};

const loadRail = async (refresh = false) => {
  try {
    const q = `project=${encodeURIComponent(projectId)}${refresh ? "&refresh" : ""}`;
    const [sessions, live] = await Promise.all([api(`/api/sessions?project=${encodeURIComponent(projectId)}`), api(`/api/live?${q}`)]);
    $("#sessions").replaceChildren(renderSessions(sessions, live));
    $("#live").replaceChildren(renderLive(live));
  } catch (err) {
    setStatus(err.message, true);
  }
};

/* ---------- terminal dock ---------- */

const dockTerminals = new Map();
let activeTerminal = null;

const termSize = () => {
  const body = $("#dock-body");
  const cols = Math.max(40, Math.floor((body.clientWidth - 16) / 8.4));
  const rows = Math.max(8, Math.floor((body.clientHeight - 14) / 18));
  return { cols, rows };
};

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

const closeDockTerminal = async (id) => {
  const t = dockTerminals.get(id);
  if (!t) return;
  t.source.close();
  t.term.dispose();
  t.tab.remove();
  t.container.remove();
  dockTerminals.delete(id);
  await api(`/api/terminals/${id}`, { method: "DELETE" }).catch(() => {});
  if (activeTerminal === id) {
    const next = [...dockTerminals.keys()].pop();
    if (next) activate(next);
    else $("#dock").hidden = true;
  }
};

const mountTerminal = (info) => {
  $("#dock").hidden = false;
  const term = new window.Terminal({
    fontFamily: "JetBrains Mono, Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: {
      background: "#121315",
      foreground: "#ececea",
      cursor: "#f2a93b",
      selectionBackground: "rgba(242, 169, 59, 0.28)",
      black: "#17181a", brightBlack: "#55554f",
      red: "#e5654f", green: "#7fd58a", yellow: "#f2a93b", blue: "#7aa7e0", magenta: "#c79bd8", cyan: "#7ccfd0", white: "#b9b9b4",
    },
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  const container = el("div", { class: "term" });
  $("#dock-body").append(container);
  term.open(container);

  const tab = el(
    "button",
    { type: "button", class: "dock-tab", onclick: () => activate(info.id) },
    el("span", { class: "lamp" }),
    text(info.title),
    el("span", { class: "close", title: "close this terminal (the session keeps running)", onclick: (e) => { e.stopPropagation(); closeDockTerminal(info.id); } }, "×"),
  );
  $("#dock-tabs").append(tab);

  const source = new EventSource(`/api/terminals/${info.id}/stream`);
  source.onmessage = (e) => term.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
  source.addEventListener("exit", (e) => {
    tab.classList.add("exited");
    term.write(`\r\n\x1b[2m[process exited with ${e.data}]\x1b[0m\r\n`);
    source.close();
  });
  source.onerror = () => setStatus(`terminal ${info.id}: stream dropped`, true);

  term.onData((data) => fetch(`/api/terminals/${info.id}/input`, { method: "POST", body: data, keepalive: true }).catch(() => {}));
  term.onResize(({ cols, rows }) => post(`/api/terminals/${info.id}/resize`, { cols, rows }).catch(() => {}));

  dockTerminals.set(info.id, { term, fit, tab, container, source });
  activate(info.id);
};

const openTerminal = async ({ kind, id, sessionId, title, prompt, cwd }) => {
  setStatus(`opening ${title ?? kind}`);
  try {
    const info = await post("/api/terminals", { project: projectId, kind, id, sessionId, title, prompt, cwd, ...termSize() });
    mountTerminal(info);
    setStatus(`terminal ${info.id}: ${info.command.join(" ")}`);
    if (kind === "spawn") loadRail(true);
  } catch (err) {
    setStatus(err.message, true);
  }
};

const spawnOnItem = (item) => {
  if (!confirm(`Spawn a headless Claude session on:\n\n${item.title}\n\nIt starts in ${project.path} in auto permission mode and opens below.`)) return;
  openTerminal({ kind: "spawn", title: item.title.slice(0, 80), prompt: item.body });
};

window.addEventListener("resize", () => {
  if (activeTerminal) dockTerminals.get(activeTerminal)?.fit.fit();
});

/* ---------- boot ---------- */

const boot = async () => {
  if (!projectId) return renderPicker();
  const projects = await api("/api/projects");
  project = projects.find((p) => p.id === projectId);
  if (!project) {
    setStatus(`no project "${projectId}"`, true);
    return renderPicker();
  }
  document.title = `${project.name} · Session Console`;

  const switcher = $("#switcher");
  switcher.replaceChildren(...projects.map((p) => el("option", { value: p.id, ...(p.id === projectId ? { selected: "" } : {}) }, p.name)), el("option", { value: "" }, "pick another…"));
  switcher.hidden = false;
  switcher.addEventListener("change", () => {
    location.href = switcher.value ? `/?project=${encodeURIComponent(switcher.value)}` : "/";
  });

  const toggle = $("#show-all");
  toggle.checked = showAll;
  $("#scope-toggle").hidden = false;
  toggle.addEventListener("change", () => {
    showAll = toggle.checked;
    try { localStorage.setItem("console.showAll", showAll ? "1" : "0"); } catch {}
    loadBoard();
  });

  $("#project").hidden = false;
  $("#reload").hidden = false;
  $("#new-session").hidden = false;
  $("#reload").addEventListener("click", () => { loadBoard(); loadRail(true); });
  $("#refresh-live").addEventListener("click", () => loadRail(true));
  $("#new-session").addEventListener("click", () => openTerminal({ kind: "new", title: `claude · ${project.name}` }));

  await Promise.all([loadBoard(), loadRail()]);
  const existing = await api("/api/terminals");
  for (const t of existing) if (t.exitCode === null) mountTerminal(t);
};

boot().catch((err) => setStatus(err.message, true));
