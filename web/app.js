// The console UI. Plain DOM and fetch; the same file runs in a browser or an Electron
// window because it only ever talks to /api/*. One project at a time: `?project=<id>`
// in the URL selects it, no parameter shows the picker.

const COLUMNS = [
  ["priority", "Priority"],
  ["in-progress", "In progress"],
  ["backlog", "Backlog"],
  ["shipped", "Shipped"],
];

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

const setStatus = (text, isError = false) => {
  const s = $("#status");
  s.textContent = text;
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
        el("a", { href: `/?project=${encodeURIComponent(p.id)}`, class: "project-link" }, p.name),
        el("div", { class: "muted" }, `${p.path} · ${p.trackers.length ? p.trackers.map((t) => t.label).join(", ") : "no tracker found"}`),
        el(
          "button",
          {
            type: "button",
            class: "small",
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
  setStatus("Waiting for the Finder dialog…");
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
    const project = await post("/api/projects", { path });
    location.href = `/?project=${encodeURIComponent(project.id)}`;
  } catch (err) {
    setStatus(err.message, true);
  }
});

/* ---------- board ---------- */

let dragging = null;

const cardFor = (trackerIndex, item) =>
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
    el("span", { class: "line" }, `L${item.start + 1}`),
    item.tags.length ? el("span", { class: "tags" }, item.tags.map((t) => `[${t}]`).join(" ")) : null,
    document.createTextNode(item.title),
  );

/** Index the dragged card would take among a list's cards, from the pointer's y position. */
const dropIndexIn = (list, y) => {
  const cards = [...list.querySelectorAll(".card:not(.dragging)")];
  const idx = cards.findIndex((c) => y < c.getBoundingClientRect().top + c.offsetHeight / 2);
  return idx < 0 ? cards.length : idx;
};

const itemsList = (trackerIndex, section, group) => {
  const list = el("div", { class: "items" });
  for (const item of group.items) list.append(cardFor(trackerIndex, item));
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
    const targetIndex = dropIndexIn(list, e.clientY);
    const { item } = dragging;
    setStatus(`Moving "${item.title.slice(0, 50)}"…`);
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
      setStatus(`Committed ${commit}`);
    } catch (err) {
      setStatus(err.message, true);
    }
    await loadBoard();
  });
  return list;
};

const renderBoard = (tracker) => {
  const columns = el("div", { class: "columns" });
  for (const [columnId, label] of COLUMNS) {
    const sections = tracker.sections.filter((s) => s.column === columnId);
    const count = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.length, 0), 0);
    const column = el("div", { class: "column" }, el("h3", {}, label, el("span", { class: "count" }, String(count))));
    for (const section of sections) {
      if (sections.length > 1) column.append(el("div", { class: "group-name" }, section.heading));
      for (const group of section.groups) {
        const groupNode = el("div", { class: "group" });
        if (group.name) groupNode.append(el("div", { class: "group-name" }, group.name.replace(/\[.*?\]\(.*?\)/g, "").trim()));
        groupNode.append(itemsList(tracker.index, section, group));
        column.append(groupNode);
      }
    }
    columns.append(column);
  }
  return el("section", { class: "board" }, el("h2", {}, tracker.label, " ", el("code", {}, tracker.path)), columns);
};

const loadBoard = async () => {
  try {
    const trackers = await api(`/api/board?project=${encodeURIComponent(projectId)}`);
    $("#boards").replaceChildren(...trackers.map(renderBoard));
    if (!trackers.length) $("#boards").append(el("p", { class: "muted" }, "This project has no tracker file the console recognises (CHECKLIST.md, PUNCHLIST.md, TODO.md)."));
  } catch (err) {
    setStatus(err.message, true);
  }
};

/* ---------- rail ---------- */

const renderSessions = (records) => {
  const byParent = new Map();
  for (const r of records) {
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
          { class: `session ${r.status}`, style: `--depth:${depth}`, title: r.handoff ?? "" },
          el("span", { class: "role" }, r.role),
          document.createTextNode(r.loop),
          el("div", { class: "muted" }, `${r.status}${r.pr ? ` · ${r.pr}` : ""}`),
        ),
      );
      walk(r.id, depth + 1);
    }
  };
  walk("", 0);
  if (!records.length) list.append(el("li", { class: "muted" }, "No session records for this project yet."));
  return list;
};

const shortPath = (p, projectPath) => (projectPath && p.startsWith(projectPath) ? p.slice(projectPath.length).replace(/^\//, "") || "." : p);

const renderLive = (live, project) => {
  const out = el("div");

  const running = el("ul");
  for (const s of live.claudeSessions) {
    running.append(
      el(
        "li",
        { class: `claude-session ${s.status ?? ""}`, title: `pid ${s.pid} · ${s.sessionId}` },
        el("span", { class: "role" }, s.status ?? "?"),
        document.createTextNode(`${s.name ?? s.pid} · ${shortPath(s.cwd, project.path)}`),
        s.waitingFor ? el("div", { class: "muted" }, s.waitingFor) : null,
      ),
    );
  }
  for (const a of live.backgroundAgents) {
    running.append(
      el(
        "li",
        { class: `claude-session ${a.state ?? ""}`, title: a.sessionId },
        el("span", { class: "role" }, `bg · ${a.state ?? "?"}`),
        document.createTextNode(a.name ?? a.id),
        el("div", { class: "muted" }, `claude attach ${a.id}`),
      ),
    );
  }
  if (!live.claudeSessions.length && !live.backgroundAgents.length) running.append(el("li", { class: "muted" }, "none running under this project"));
  out.append(el("h2", {}, "Running Claude sessions"), running);

  const servers = el("ul");
  for (const s of live.devServers) servers.append(el("li", {}, `${s.branch ?? "?"} → :${s.port ?? "?"}`));
  if (!live.devServers.length) servers.append(el("li", { class: "muted" }, "no dev servers"));
  out.append(el("h2", {}, "Dev servers"), servers);

  for (const repo of live.repos) {
    const ul = el("ul");
    for (const pr of repo.pullRequests) {
      ul.append(el("li", {}, el("a", { href: pr.url, target: "_blank" }, `#${pr.number}`), ` ${pr.isDraft ? "(draft) " : ""}${pr.title}`, el("div", { class: "muted" }, `${pr.headRefName} → ${pr.baseRefName}`)));
    }
    for (const wt of repo.worktrees) {
      if (wt.path === repo.path) continue;
      ul.append(el("li", { class: "muted" }, `worktree ${wt.branch} @ ${wt.head}`));
    }
    if (repo.error) ul.append(el("li", { class: "muted" }, repo.error));
    if (!ul.childElementCount) ul.append(el("li", { class: "muted" }, "no open PRs or worktrees"));
    out.append(el("h2", {}, `${repo.label}: PRs + worktrees`), ul);
  }
  out.append(el("div", { class: "muted small" }, `fetched ${new Date(live.fetchedAt).toLocaleTimeString()}`));
  return out;
};

const loadRail = async (project, refresh = false) => {
  try {
    const q = `project=${encodeURIComponent(projectId)}${refresh ? "&refresh" : ""}`;
    const [sessions, live] = await Promise.all([api(`/api/sessions?project=${encodeURIComponent(projectId)}`), api(`/api/live?${q}`)]);
    $("#sessions").replaceChildren(renderSessions(sessions));
    $("#live").replaceChildren(renderLive(live, project));
  } catch (err) {
    setStatus(err.message, true);
  }
};

/* ---------- boot ---------- */

const boot = async () => {
  if (!projectId) return renderPicker();
  const projects = await api("/api/projects");
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    setStatus(`No project "${projectId}"`, true);
    return renderPicker();
  }
  document.title = `${project.name} · Session Console`;
  $("#project-name").textContent = project.name;
  $("#project").hidden = false;
  $("#reload").hidden = false;
  $("#reload").addEventListener("click", () => {
    loadBoard();
    loadRail(project, true);
  });
  await Promise.all([loadBoard(), loadRail(project)]);
};

boot().catch((err) => setStatus(err.message, true));
