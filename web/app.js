// The console UI. Plain DOM and fetch; the same file runs in a browser or an Electron
// window because it only ever talks to /api/*.

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
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
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
    setStatus(`Moving "${item.title.slice(0, 50)}"...`);
    try {
      const { commit } = await api("/api/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tracker: trackerIndex,
          itemStart: item.start,
          itemFirstLine: item.firstLine,
          targetHeading: section.heading,
          targetGroup: group.name,
          targetIndex,
        }),
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
    const trackers = await api("/api/board");
    const boards = $("#boards");
    boards.replaceChildren(...trackers.map(renderBoard));
  } catch (err) {
    setStatus(err.message, true);
  }
};

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
          el("div", { class: "muted" }, `${r.status}${r.project ? ` · ${r.project}` : ""}${r.pr ? ` · ${r.pr}` : ""}`),
        ),
      );
      walk(r.id, depth + 1);
    }
  };
  walk("", 0);
  if (!records.length) list.append(el("li", { class: "muted" }, "No session records yet (bin/session-open writes them)."));
  return list;
};

const renderLive = (live) => {
  const out = el("div");
  const claude = el("ul");
  for (const s of live.claudeSessions) {
    const where = s.cwd.replace(/^\/Users\/[^/]+\/Projects\//, "");
    claude.append(
      el(
        "li",
        { class: `claude-session ${s.status ?? ""}`, title: `pid ${s.pid} · ${s.sessionId}` },
        el("span", { class: "role" }, s.status ?? "?"),
        document.createTextNode(`${s.name ?? s.pid} · ${where}`),
        s.waitingFor ? el("div", { class: "muted" }, s.waitingFor) : null,
      ),
    );
  }
  if (!live.claudeSessions.length) claude.append(el("li", { class: "muted" }, "no running Claude sessions"));
  out.append(el("h2", {}, "Running Claude sessions"), claude);
  const servers = el("ul");
  for (const s of live.devServers) servers.append(el("li", {}, `${s.branch ?? "?"} → :${s.port ?? "?"}`));
  if (!live.devServers.length) servers.append(el("li", { class: "muted" }, "no dev servers"));
  out.append(el("h2", {}, "Dev servers"), servers);
  for (const repo of live.repos) {
    const ul = el("ul");
    for (const pr of repo.pullRequests) {
      ul.append(el("li", {}, el("a", { href: pr.url, target: "_blank" }, `#${pr.number}`), ` ${pr.isDraft ? "(draft) " : ""}${pr.title}`));
    }
    for (const wt of repo.worktrees) {
      if (wt.branch === "develop") continue;
      ul.append(el("li", { class: "muted" }, `worktree ${wt.branch} @ ${wt.head}`));
    }
    if (repo.error) ul.append(el("li", { class: "muted" }, repo.error));
    out.append(el("h2", {}, `${repo.label}: PRs + worktrees`), ul);
  }
  out.append(el("div", { class: "muted" }, `fetched ${live.fetchedAt}`));
  return out;
};

const loadRail = async () => {
  try {
    const [sessions, live] = await Promise.all([api("/api/sessions"), api("/api/live")]);
    $("#sessions").replaceChildren(renderSessions(sessions));
    $("#live").replaceChildren(renderLive(live));
  } catch (err) {
    setStatus(err.message, true);
  }
};

$("#reload").addEventListener("click", () => {
  loadBoard();
  loadRail();
});
loadBoard();
loadRail();
