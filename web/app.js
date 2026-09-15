// The console UI. Plain DOM and fetch; the same file runs in a browser or an Electron
// window because it only ever talks to /api/*. One project at a time: `?project=<id>`
// selects it, no parameter shows the picker.
import { strike, scheduleWeather } from "./bolt.js";


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

let statusTimer = null;
const setStatus = (msg, isError = false) => {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
  s.classList.add("flash");
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => s.classList.remove("flash"), 900);
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

// Lanes. Priority is the roadmap: its `###` groups are releases, ordered top to bottom,
// and the order inside a release is the runway for that deployment. Done gathers every
// checked item plus the "shipped, pending release" section: merged, waiting on a deploy.
const LANES = [
  ["backlog", "Backlog", ""],
  ["priority", "Roadmap", "runway"],
  ["in-progress", "In progress", ""],
  ["shipped", "Done · awaiting deploy", "done"],
];

let collapsed = new Set();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem("console.collapsed") ?? "[]"));
} catch {}
const persistCollapsed = () => {
  try { localStorage.setItem("console.collapsed", JSON.stringify([...collapsed])); } catch {}
};

let dragging = null;

const cardFor = (trackerIndex, item, number, draggable = true) =>
  el(
    "div",
    {
      class: `card${item.checked ? " checked" : ""}`,
      draggable: draggable ? "true" : "false",
      title: item.body,
      ondragstart: (e) => {
        if (!draggable) return e.preventDefault();
        dragging = { trackerIndex, item };
        e.currentTarget.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      },
      ondragend: (e) => {
        e.currentTarget.classList.remove("dragging");
        dragging = null;
      },
      onclick: (e) => {
        if (e.target.closest("button")) return;
        openDrawer(trackerIndex, item);
      },
    },
    el("span", { class: "num" }, number === null ? "" : String(number)),
    el("div", { class: "title" }, item.title),
    el("div", { class: "meta" }, dueChip(item), ...tagChips(item), createdOf(item) ? el("span", { class: "since", title: item.created ? "created" : "entry last changed" }, createdOf(item).slice(5)) : null),
    item.checked
      ? null
      : el(
          "button",
          {
            type: "button",
            class: "spawn primary",
            title: "Spawn a headless Claude session on this item and open it below",
            onclick: (e) => {
              e.stopPropagation();
              spawnOnItem(item, e.currentTarget.closest(".card"));
            },
          },
          "spawn",
        ),
  );

/** Index the dragged card would take among a list's visible cards, from the pointer's y position. */

/** The checklist's tags mixed three things. Show them as readable chips; engineering is the default and says nothing, so it is not shown. */
const CATEGORY_WORDS = { DEBT: "tech debt", GS: "Greensource", OPS: "ops", DOCS: "docs", INFRA: "infra", BIZ: "business", STRATEGY: "strategy", NOTE: "note", IDEA: "idea", DECISION: "decision", TEST: "tests", UI: "ui" };
const SIZE_WORDS = { S: "small", M: "medium", L: "large" };
const tagChips = (item) => {
  const out = [];
  const seen = new Set();
  for (const raw of item.tags) {
    const t = raw.toUpperCase();
    if (t === "ENG" || seen.has(t)) continue;
    seen.add(t);
    if (SIZE_WORDS[t]) out.push(el("span", { class: "chip size", title: "size" }, SIZE_WORDS[t]));
    else if (t === "GS") out.push(el("span", { class: "chip greensource", title: "client" }, "Greensource"));
    else if (CATEGORY_WORDS[t]) out.push(el("span", { class: "chip category", title: "category" }, CATEGORY_WORDS[t]));
    else out.push(el("span", { class: "chip kind", title: "kind" }, raw.toLowerCase()));
  }
  if (item.fields?.kind && !seen.has(item.fields.kind.toUpperCase())) out.push(el("span", { class: "chip kind", title: "kind" }, item.fields.kind));
  if (item.fields?.size && !seen.has(item.fields.size.toUpperCase())) out.push(el("span", { class: "chip size", title: "size" }, SIZE_WORDS[item.fields.size.toUpperCase()] ?? item.fields.size));
  return out;
};

const today = () => new Date().toISOString().slice(0, 10);
/** "overdue" | "soon" (within 7 days) | "later" | "" for no date or a checked item. */
const dueState = (due, checked) => {
  if (!due || checked) return "";
  const days = Math.round((new Date(due) - new Date(today())) / 86400000);
  return days < 0 ? "overdue" : days <= 7 ? "soon" : "later";
};
/** Rewrite, insert, or remove one `  - key:` line right under the bullet, leaving everything else alone. */
const withField = (body, key, value) => {
  const lines = body.split("\n");
  const re = new RegExp(`^\\s{2,}- ${key}:`);
  const i = lines.findIndex((l, n) => n > 0 && re.test(l));
  if (!value) return i > 0 ? [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n") : body;
  if (i > 0) lines[i] = `  - ${key}: ${value}`;
  else lines.splice(1, 0, `  - ${key}: ${value}`);
  return lines.join("\n");
};
const withDue = (body, due) => withField(body, "due", due);
const editItemBody = async (trackerIndex, item, newBody, label) => {
  setStatus(label);
  const { commit } = await post("/api/edit", { project: projectId, tracker: trackerIndex, itemStart: item.start, itemFirstLine: item.firstLine, body: newBody });
  setStatus(commit === "no change" ? "no change" : `committed ${commit}`);
};
const createdOf = (item) => item.created ?? item.lineDate;

/** Calendar colour: done is green; within a week (or overdue) is yellow when in progress, red when not. */
const eventState = (e) => {
  if (e.kind !== "item") return "";
  if (e.item.checked || e.column === "shipped") return "done";
  const days = Math.round((new Date(e.date) - new Date(today())) / 86400000);
  if (days > 7) return "";
  return e.column === "in-progress" ? "warn" : "late";
};

const dueChip = (item) => {
  const due = item.fields?.due;
  if (!due) return null;
  return el("span", { class: `due ${dueState(due, item.checked)}` }, due.slice(5));
};

const dropIndexIn = (list, y) => {
  const cards = [...list.querySelectorAll(".card:not(.dragging)")];
  const idx = cards.findIndex((c) => y < c.getBoundingClientRect().top + c.offsetHeight / 2);
  return idx < 0 ? cards.length : idx;
};

const showsInLane = (item, laneId) => {
  if (laneId === "shipped") return true;
  if (item.checked) return false;
  return showAll || isDevItem(item);
};

const itemsList = (trackerIndex, section, group, laneId, numbered) => {
  const list = el("div", { class: "items" });
  const visible = group.items.filter((item) => showsInLane(item, laneId));
  visible.forEach((item, i) => list.append(cardFor(trackerIndex, item, numbered ? i + 1 : null, !item.checked)));
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
    const neighbour = visibleOthers[dropIndexIn(list, e.clientY)];
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
      strike(list);
    } catch (err) {
      setStatus(err.message, true);
    }
    await loadBoard();
  });
  return list;
};

const cleanGroupName = (name) => name.replace(/\[(.*?)\]\(.*?\)/g, "$1").trim();

const addReleaseButton = (trackerIndex, section, lane) =>
  el(
    "button",
    {
      type: "button",
      class: "ghost add-release",
      onclick: async () => {
        const name = prompt("Name the roadmap group (a ### heading under Priority):", "");
        if (!name) return;
        try {
          const { commit } = await post("/api/groups", { project: projectId, tracker: trackerIndex, heading: section.heading, name });
          setStatus(`committed ${commit}`);
          strike(lane);
          await loadBoard();
        } catch (err) {
          setStatus(err.message, true);
        }
      },
    },
    "+ group",
  );

/** Checked items from every non-done section, shown read-only in the Done lane. */
const doneElsewhere = (tracker) =>
  tracker.sections
    .filter((s) => s.column && s.column !== "shipped")
    .flatMap((s) => s.groups.flatMap((g) => g.items.filter((i) => i.checked)));

const renderLane = (tracker, [laneId, label, extraClass]) => {
  const sections = tracker.sections.filter((s) => s.column === laneId);
  const key = `${tracker.index}:${laneId}`;
  const isCollapsed = collapsed.has(key);
  const extras = laneId === "shipped" ? doneElsewhere(tracker) : [];
  const count =
    sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.filter((i) => showsInLane(i, laneId)).length, 0), 0) + extras.length;

  const lane = el("div", { class: `lane ${extraClass}${isCollapsed ? " collapsed" : ""}` });
  lane.append(
    el(
      "h3",
      { class: "lane-title" },
      el(
        "button",
        {
          type: "button",
          class: "ghost fold",
          title: isCollapsed ? "show" : "hide",
          onclick: () => {
            if (isCollapsed) collapsed.delete(key);
            else collapsed.add(key);
            persistCollapsed();
            loadBoard();
          },
        },
        isCollapsed ? "▸" : "▾",
      ),
      el("span", { class: "label" }, label),
      el("span", { class: "count" }, String(count)),
    ),
  );
  if (isCollapsed) return lane;

  for (const section of sections) {
    if (sections.length > 1) lane.append(el("div", { class: "group-name" }, section.heading));
    const releases = laneId === "priority";
    for (const group of section.groups) {
      const block = el("div", { class: releases && group.name ? "release" : "group" });
      if (group.name) {
        const removable = releases && group.items.length === 0;
        block.append(el("div", { class: releases ? "release-name" : "group-name" }, stripDeploy(group.name), removable ? btn("×", async () => {
          if (!confirm(`Delete the empty group "${cleanGroupName(group.name)}"?`)) return;
          try {
            const { commit } = await api("/api/groups", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: projectId, tracker: tracker.index, heading: section.heading, name: group.name }) });
            setStatus(`committed ${commit}`);
          } catch (err) {
            setStatus(err.message, true);
          }
          await loadBoard();
        }, "ghost") : null));
      }
      else if (releases && section.groups.length > 1) block.append(el("div", { class: "release-name unfiled" }, "unassigned"));
      block.append(itemsList(tracker.index, section, group, laneId, releases));
      lane.append(block);
    }
    if (releases) lane.append(addReleaseButton(tracker.index, section, lane));
  }
  if (extras.length) {
    lane.append(el("div", { class: "group-name" }, "checked off elsewhere"));
    const list = el("div", { class: "items" });
    for (const item of extras) list.append(cardFor(tracker.index, item, null, false));
    lane.append(list);
  }
  return lane;
};

const renderBoard = (tracker) => {
  const lanes = el("div", { class: "lanes" });
  for (const lane of LANES) lanes.append(renderLane(tracker, lane));
  lanes.style.gridTemplateColumns = LANES.map(([id]) => (collapsed.has(`${tracker.index}:${id}`) ? "minmax(0, 0.16fr)" : id === "priority" ? "1.5fr" : "1fr")).join(" ");
  return el(
    "section",
    { class: "board" },
    el("div", { class: "board-title" }, el("h2", {}, tracker.label), el("code", {}, tracker.path.replace(project.path, "").replace(/^\//, ""))),
    lanes,
  );
};

let lastTrackers = [];
const loadBoard = async () => {
  try {
    const trackers = await api(`/api/board?project=${encodeURIComponent(projectId)}`);
    lastTrackers = trackers;
    if (!releasesData) releasesData = await api(`/api/releases?project=${encodeURIComponent(projectId)}`);
    $("#boards").replaceChildren(
      ...(view === "calendar"
        ? [renderCalendar(trackers)]
        : [el("section", { class: "board-releases" }, el("h3", { class: "strip-title" }, "Releases"), renderReleases(trackers)), ...trackers.map(renderBoard)]),
    );
    for (const b of document.querySelectorAll("#view-toggle button")) b.classList.toggle("active", b.dataset.view === view);
    if (!trackers.length) $("#boards").append(el("p", { class: "muted" }, "No tracker file the console recognises (CHECKLIST.md, PUNCHLIST.md, TODO.md)."));
  } catch (err) {
    setStatus(err.message, true);
  }
};


/* ---------- item drawer ---------- */

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
/** Enough markdown to read a checklist entry: bold, code, links shown as their text. */
const renderInline = (md) =>
  escapeHtml(md)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/~~(.+?)~~/g, "<s>$1</s>");

const closeDrawer = () => {
  $("#drawer-root").replaceChildren();
  if (location.hash.startsWith("#L")) history.replaceState(null, "", location.pathname + location.search);
  document.removeEventListener("keydown", onDrawerKey);
};
const onDrawerKey = (e) => {
  if (e.key === "Escape") closeDrawer();
};

const openDrawer = (trackerIndex, item) => {
  let editing = false;
  const root = $("#drawer-root");
  const body = el("div", { class: "drawer-body" });
  const head = el("h2", {}, item.title);
  const actions = el("div", { class: "drawer-actions" });

  const FIELD_ORDER = ["due", "release", "size", "kind", "status", "owner", "plan", "pr", "blocked-by", "links"];
  const saveBody = async (newBody, label) => {
    setStatus(label);
    try {
      const { commit } = await post("/api/edit", { project: projectId, tracker: trackerIndex, itemStart: item.start, itemFirstLine: item.firstLine, body: newBody });
      setStatus(`committed ${commit}`);
      closeDrawer();
      await loadBoard();
    } catch (err) {
      setStatus(err.message, true);
    }
  };
  const view = () => {
    const grid = el("dl", { class: "fields" });
    const addField = (k, v, cls = "") => grid.append(el("dt", {}, k), el("dd", { class: cls }, v));
    if (item.created) addField("created", item.created);
    else if (item.lineDate) addField("created", `unknown; the entry was last changed ${item.lineDate}`);
    if (item.source) addField("source", item.source);
    for (const k of FIELD_ORDER) {
      if (!item.fields[k]) continue;
      const v = item.fields[k];
      if (k === "due") addField("due", `${v}${dueState(v, item.checked) === "overdue" ? " · overdue" : ""}`, dueState(v, item.checked));
      else if (/^(https?:\/\/|plans\/|deliverables\/|\.\.\/)/.test(v)) addField(k, el("code", {}, v));
      else addField(k, v);
    }
    const slotsNow = planningSlots(lastTrackers);
    const releaseSelect = el("select", { class: "supervisor" },
      el("option", { value: "" }, "no release"),
      el("option", { value: "next", ...(item.fields.release === "next" ? { selected: "" } : {}) }, `${slotsNow.next.label} (next)`),
      el("option", { value: "next+1", ...(item.fields.release === "next+1" ? { selected: "" } : {}) }, `${slotsNow.nextNext.label} (the one after)`));
    releaseSelect.addEventListener("change", () => saveBody(withField(item.body, "release", releaseSelect.value), "planning release"));
    const releaseRow = el("div", { class: "due-row" }, el("span", { class: "k" }, "release"), releaseSelect);
    const dueInput = el("input", { type: "date", value: item.fields.due ?? "" });
    const dueRow = el(
      "div",
      { class: "due-row" },
      el("span", { class: "k" }, "deadline"),
      dueInput,
      btn("set", () => saveBody(withDue(item.body, dueInput.value), "setting deadline"), "primary"),
      item.fields.due ? btn("clear", () => saveBody(withDue(item.body, ""), "clearing deadline"), "ghost") : null,
    );
    const prose = el("div", { class: "drawer-text" });
    prose.innerHTML = renderInline(item.description || "(no description)");
    body.replaceChildren(grid.childElementCount ? grid : null, releaseRow, dueRow, prose);
    const parents = (lastSessions ?? []).filter((r) => r.role === "audit" && r.status === "open");
    const supervisor = el("select", { class: "supervisor", title: "audit parent: the finished session is audited under it" },
      el("option", { value: "" }, "no audit parent"),
      ...parents.map((p) => el("option", { value: p.id }, `audit under: ${p.loop}`)),
      el("option", { value: "__new" }, "new audit parent…"));
    supervisor.addEventListener("change", async () => {
      if (supervisor.value !== "__new") return;
      const name = prompt("Name the audit parent (a group of task sessions it oversees):", "");
      supervisor.value = "";
      if (!name) return;
      try {
        const created = await post("/api/audit-parents", { project: projectId, name });
        supervisor.insertBefore(el("option", { value: created.id, selected: "" }, `audit under: ${created.loop}`), supervisor.lastElementChild);
        supervisor.value = created.id;
        loadRail();
      } catch (err) {
        setStatus(err.message, true);
      }
    });
    actions.replaceChildren(
      item.checked ? null : btn("spawn", () => { const parent = supervisor.value || undefined; closeDrawer(); spawnOnItem(item, null, parent); }, "primary"),
      item.checked ? null : supervisor,
      el("span", { class: "spacer" }),
      btn("edit markdown", () => { editing = true; edit(); }),
      btn("close", closeDrawer),
    );
  };
  const edit = () => {
    const area = el("textarea", { spellcheck: "false" });
    area.value = item.body;
    body.replaceChildren(area);
    area.focus();
    actions.replaceChildren(
      el("span", { class: "muted small mono" }, "first line must stay a bullet · saves and commits"),
      el("span", { class: "spacer" }),
      btn("cancel", () => { editing = false; view(); }),
      btn("save", async () => {
        setStatus("saving");
        try {
          const { commit } = await post("/api/edit", {
            project: projectId,
            tracker: trackerIndex,
            itemStart: item.start,
            itemFirstLine: item.firstLine,
            body: area.value,
          });
          setStatus(`committed ${commit}`);
          closeDrawer();
          await loadBoard();
        } catch (err) {
          setStatus(err.message, true);
        }
      }, "primary"),
    );
  };

  root.replaceChildren(
    el("div", { class: "drawer-backdrop", onclick: () => { if (!editing) closeDrawer(); } }),
    el(
      "aside",
      { class: "drawer", role: "dialog", "aria-label": item.title },
      el("div", { class: "drawer-head" }, head, btn("×", closeDrawer, "ghost")),
      el("div", { class: "drawer-meta" }, ...tagChips(item), dueChip(item), el("span", { class: "spacer" }), el("span", { class: "muted mono" }, `line ${item.start + 1}${item.checked ? " · checked" : ""}`)),
      body,
      el("div", { class: "drawer-foot" }, actions),
    ),
  );
  document.addEventListener("keydown", onDrawerKey);
  view();
  history.replaceState(null, "", `#L${item.start + 1}`);
};


/* ---------- calendar ---------- */

let calendarMonth = today().slice(0, 7);
let view = "board";
try { view = localStorage.getItem("console.view") === "calendar" ? "calendar" : "board"; } catch {}
if (new URLSearchParams(location.search).get("view") === "calendar") view = "calendar";

const eventsFor = (trackers) => {
  const events = [];
  const slots = planningSlots(trackers);
  for (const slot of [slots.next, slots.nextNext]) if (slot.deploy) events.push({ date: slot.deploy, kind: "release", title: slot.label, slot });
  for (const tracker of trackers) {
    for (const section of tracker.sections) {
      if (!section.column) continue;
      for (const group of section.groups) {
        for (const item of group.items) {
          if (!item.fields.due) continue;
          if (!showAll && !isDevItem(item)) continue;
          events.push({ date: item.fields.due, kind: "item", title: item.title, tracker, section, item, column: section.column });
        }
      }
    }
  }
  return events;
};

let calDrag = null;

const stripDeploy = (name) => cleanGroupName(name).replace(/\s*\(?\s*(?:deploy|ship)\s+\d{4}-\d{2}-\d{2}\s*\)?/i, "").trim();

const setDeployDate = async (tracker, section, group, date) => {
  const newName = date ? `${stripDeploy(group.name)} (deploy ${date})` : stripDeploy(group.name);
  setStatus(`scheduling ${stripDeploy(group.name)}`);
  const { commit } = await post("/api/groups/rename", { project: projectId, tracker: tracker.index, heading: section.heading, oldName: group.name, newName });
  setStatus(`committed ${commit}`);
};

const draggableItem = (node, tracker, item, section) => {
  node.draggable = true;
  node.addEventListener("dragstart", (e) => {
    calDrag = { type: "item", tracker, item, section };
    node.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  node.addEventListener("dragend", () => { node.classList.remove("dragging"); calDrag = null; });
  return node;
};

const dropZone = (node, accepts, onDrop) => {
  node.addEventListener("dragover", (e) => {
    if (!calDrag || !accepts(calDrag)) return;
    e.preventDefault();
    node.classList.add("over");
  });
  node.addEventListener("dragleave", () => node.classList.remove("over"));
  node.addEventListener("drop", async (e) => {
    e.preventDefault();
    node.classList.remove("over");
    if (!calDrag || !accepts(calDrag)) return;
    const drag = calDrag;
    calDrag = null;
    try {
      await onDrop(drag);
      strike(node);
    } catch (err) {
      setStatus(err.message, true);
    }
    await loadBoard();
  });
  return node;
};

let releasesData = null;

const isFeatureItem = (i) => i.fields.kind === "feature" || i.tags.some((t) => t.toLowerCase() === "feature");
const isBugItem = (i) => i.fields.kind === "bug" || i.tags.some((t) => t.toLowerCase() === "bug");
const bump = (version, level) => {
  const [maj, min, pat] = version.split(".").map((n) => Number(n) || 0);
  return level === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
};
/** The two planning slots: what is in them, and the version each earns from its contents. */
const planningSlots = (trackers) => {
  const items = trackers.flatMap((t) => t.sections.filter((sec) => sec.column && sec.column !== "shipped").flatMap((sec) => sec.groups.flatMap((g) => g.items.filter((i) => !i.checked && (showAll || isDevItem(i))).map((i) => ({ tracker: t, section: sec, item: i })))));
  const next = items.filter(({ item }) => item.fields.release === "next");
  const nextNext = items.filter(({ item }) => item.fields.release === "next+1");
  const base = releasesData?.shipped[0]?.version ?? "0.0.0";
  const merged = releasesData?.next?.counts ?? { added: 0, fixed: 0, changed: 0, prs: 0, prFeatures: 0, prFixes: 0 };
  const nextHasFeatures = merged.added > 0 || merged.prFeatures > 0 || next.some(({ item }) => isFeatureItem(item));
  const nextHasAnything = nextHasFeatures || merged.fixed > 0 || merged.changed > 0 || merged.prs > 0 || next.length > 0;
  const nextVersion = nextHasAnything ? bump(base, nextHasFeatures ? "minor" : "patch") : base;
  const nnHasFeatures = nextNext.some(({ item }) => isFeatureItem(item));
  const nextNextVersion = nextNext.length ? bump(nextVersion, nnHasFeatures ? "minor" : "patch") : bump(nextVersion, "minor");
  const slots = releasesData?.slots ?? {};
  return {
    base,
    next: { key: "next", label: slots.next?.name ?? `v${nextVersion}`, computed: `v${nextVersion}`, deploy: slots.next?.deploy, items: next, merged },
    nextNext: { key: "next+1", label: slots["next+1"]?.name ?? `v${nextNextVersion}`, computed: `v${nextNextVersion}`, deploy: slots["next+1"]?.deploy, items: nextNext },
  };
};

const setItemRelease = async (tracker, item, slotKey) => {
  await editItemBody(tracker.index, item, withField(item.body, "release", slotKey), slotKey ? `planning for ${slotKey}` : "removing from release");
};

/** A slot card accepts a card dragged from the board (dragging) or from the calendar (calDrag). */
const acceptsAnyItemDrag = () => (calDrag && calDrag.type === "item") || dragging;
const draggedItem = () => (calDrag && calDrag.type === "item" ? { tracker: calDrag.tracker, item: calDrag.item } : dragging ? { tracker: lastTrackers[dragging.trackerIndex], item: dragging.item } : null);


const stat = (n, label) => el("div", { class: "stat" }, el("b", {}, String(n)), el("span", {}, label));

const openReleaseDrawer = (release, kind, planned) => {
  const root = $("#drawer-root");
  const list = el("div", { class: "release-list" });
  if (planned) {
    const dateInput = el("input", { type: "date", value: planned.group.due ?? "" });
    list.append(
      el("div", { class: "due-row" }, el("span", { class: "k" }, "deploy date"), dateInput,
        btn("set", async () => { try { await setDeployDate(planned.tracker, planned.section, planned.group, dateInput.value); closeDrawer(); releasesData = null; await loadBoard(); } catch (err) { setStatus(err.message, true); } }, "primary")),
      el("h3", {}, `${planned.items.length} planned items (drag more in from the Roadmap on the board)`),
    );
    const ul = el("ul");
    for (const i of planned.items) ul.append(el("li", { onclick: () => openDrawer(planned.tracker.index, i) }, i.title));
    list.append(ul);
  } else {
    if (release.prs.length) {
      list.append(el("h3", {}, `${release.prs.length} pull requests merged`));
      const ul = el("ul");
      for (const pr of release.prs) ul.append(el("li", {}, el("span", { class: `kind ${pr.kind}` }, pr.kind), el("a", { href: pr.url, target: "_blank" }, `${pr.repo}#${pr.number}`), text(` ${pr.title}`), el("span", { class: "when" }, pr.mergedAt.slice(0, 10))));
      list.append(ul);
    }
    for (const kindName of ["Added", "Changed", "Fixed", "Removed"]) {
      const bullets = release.bullets.filter((b) => b.kind === kindName);
      if (!bullets.length) continue;
      list.append(el("h3", {}, `${kindName} (${bullets.length})`));
      const ul = el("ul");
      for (const b of bullets) {
        const li = el("li");
        li.innerHTML = renderInline(b.text);
        ul.append(li);
      }
      list.append(ul);
    }
  }
  const head = kind === "next" ? "Next release (unreleased)" : planned ? `${planned.name} · planned` : `${release.version} · shipped ${release.date ?? ""}`;
  if (release?.compare?.length) {
    list.prepend(el("div", { class: "compare-links" }, ...release.compare.map((c) => el("a", { href: c.url, target: "_blank" }, `${c.repo} on GitHub ↗`))));
  }
  root.replaceChildren(
    el("div", { class: "drawer-backdrop", onclick: closeDrawer }),
    el(
      "aside",
      { class: "drawer", role: "dialog" },
      el("div", { class: "drawer-head" }, el("h2", {}, head), btn("×", closeDrawer, "ghost")),
      el("div", { class: "drawer-body" }, list),
      el("div", { class: "drawer-foot" }, el("div", { class: "drawer-actions" }, el("span", { class: "spacer" }), btn("close", closeDrawer))),
    ),
  );
  document.addEventListener("keydown", onDrawerKey);
};

const releaseCard = (release, kind) => {
  const c = release.counts;
  return el(
    "div",
    { class: `release-card ${kind}`, onclick: () => { history.replaceState(null, "", `#release-${kind === "next" ? "next" : release.version}`); openReleaseDrawer(release, kind); } },
    el("div", {}, el("span", { class: "version" }, kind === "next" ? "Next" : release.version), el("span", { class: "state" }, kind === "next" ? "unreleased, on develop" : `shipped ${release.date ?? ""}`)),
    el("div", { class: "stats" }, stat(c.added, "features"), stat(c.fixed, "fixes"), stat(c.prs, "PRs")),
    el("div", { class: "foot" }, `${c.prFeatures} feat · ${c.prFixes} fix PRs${kind === "next" ? ` since ${releasesData.shipped[0]?.version ?? "last tag"}` : ""} · click for the list`),
  );
};

const slotCard = (slot, trackers) => {
  const featureCount = (slot.merged?.added ?? 0) + slot.items.filter(({ item }) => isFeatureItem(item)).length;
  const fixCount = (slot.merged?.fixed ?? 0) + slot.items.filter(({ item }) => isBugItem(item)).length;
  const card = el(
    "div",
    { class: `release-card slot ${slot.key === "next" ? "next" : "next-next"}`, onclick: () => { history.replaceState(null, "", `#release-${slot.key}`); openSlotDrawer(slot, trackers); } },
    el("div", {}, el("span", { class: "version" }, slot.label), el("span", { class: "state" }, slot.key === "next" ? `next release${slot.label !== slot.computed ? ` · computed ${slot.computed}` : ""}` : `the one after${slot.label !== slot.computed ? ` · computed ${slot.computed}` : ""}`)),
    el("div", { class: "stats" }, stat(featureCount, "features"), stat(fixCount, "fixes"), stat(slot.key === "next" ? slot.merged.prs : slot.items.length, slot.key === "next" ? "PRs merged" : "planned")),
    el("div", { class: "foot" }, slot.key === "next" ? `${slot.items.length} planned · ${slot.merged.prs} merged since ${slot.merged ? (releasesData?.shipped[0]?.version ?? "last tag") : ""}${slot.deploy ? ` · deploy ${slot.deploy}` : ""} · drop cards here` : `${slot.items.length} planned${slot.deploy ? ` · deploy ${slot.deploy}` : ""} · drop cards here`),
  );
  card.addEventListener("dragover", (e) => { if (!acceptsAnyItemDrag()) return; e.preventDefault(); card.classList.add("over"); });
  card.addEventListener("dragleave", () => card.classList.remove("over"));
  card.addEventListener("drop", async (e) => {
    e.preventDefault();
    card.classList.remove("over");
    const d = draggedItem();
    calDrag = null;
    dragging = null;
    if (!d) return;
    try {
      await setItemRelease(d.tracker, d.item, slot.key);
      strike(card);
    } catch (err) {
      setStatus(err.message, true);
    }
    await loadBoard();
  });
  return card;
};

const openSlotDrawer = (slot, trackers) => {
  const root = $("#drawer-root");
  const list = el("div", { class: "release-list" });
  const nameInput = el("input", { type: "text", value: slot.label, placeholder: slot.computed, style: "width: 120px" });
  const dateInput = el("input", { type: "date", value: slot.deploy ?? "" });
  const save = async () => {
    try {
      const name = nameInput.value.trim() === slot.computed ? "" : nameInput.value.trim();
      await post("/api/release-slots", { project: projectId, slot: slot.key, name, deploy: dateInput.value });
      releasesData = null;
      closeDrawer();
      await loadBoard();
    } catch (err) {
      setStatus(err.message, true);
    }
  };
  list.append(
    el("div", { class: "due-row" }, el("span", { class: "k" }, "version"), nameInput, el("span", { class: "muted small mono" }, `computed ${slot.computed}`)),
    el("div", { class: "due-row" }, el("span", { class: "k" }, "deploy"), dateInput, btn("save", save, "primary")),
  );
  if (slot.key === "next" && releasesData?.next) {
    const r = releasesData.next;
    if (r.compare?.length) list.append(el("div", { class: "compare-links" }, ...r.compare.map((c) => el("a", { href: c.url, target: "_blank" }, `${c.repo} on GitHub ↗`))));
  }
  list.append(el("h3", {}, `${slot.items.length} planned items`));
  const planned = el("ul");
  for (const { tracker, item } of slot.items) {
    planned.append(el("li", {}, el("span", { class: `kind ${isBugItem(item) ? "fix" : isFeatureItem(item) ? "feature" : "other"}` }, isBugItem(item) ? "fix" : isFeatureItem(item) ? "feature" : "item"), el("a", { href: "#", onclick: (e) => { e.preventDefault(); openDrawer(tracker.index, item); } }, item.title), btn("remove", (e) => { e.stopPropagation(); setItemRelease(tracker, item, "").then(() => { closeDrawer(); loadBoard(); }); }, "ghost")));
  }
  if (!slot.items.length) planned.append(el("li", { class: "muted" }, "none yet: drag a card onto this release, or pick it in the card's drawer"));
  list.append(planned);
  if (slot.key === "next" && releasesData?.next) {
    const r = releasesData.next;
    if (r.prs.length) {
      list.append(el("h3", {}, `${r.prs.length} pull requests already merged`));
      const ul = el("ul");
      for (const pr of r.prs) ul.append(el("li", {}, el("span", { class: `kind ${pr.kind}` }, pr.kind), el("a", { href: pr.url, target: "_blank" }, `${pr.repo}#${pr.number}`), text(` ${pr.title}`), el("span", { class: "when" }, pr.mergedAt.slice(0, 10))));
      list.append(ul);
    }
    for (const kindName of ["Added", "Changed", "Fixed", "Removed"]) {
      const bullets = r.bullets.filter((b) => b.kind === kindName);
      if (!bullets.length) continue;
      list.append(el("h3", {}, `${kindName} (${bullets.length}) in the changelog`));
      const ul = el("ul");
      for (const b of bullets) { const li = el("li"); li.innerHTML = renderInline(b.text); ul.append(li); }
      list.append(ul);
    }
  }
  root.replaceChildren(
    el("div", { class: "drawer-backdrop", onclick: closeDrawer }),
    el("aside", { class: "drawer", role: "dialog" },
      el("div", { class: "drawer-head" }, el("h2", {}, `${slot.label} · ${slot.key === "next" ? "next release" : "the one after"}`), btn("×", closeDrawer, "ghost")),
      el("div", { class: "drawer-body" }, list),
      el("div", { class: "drawer-foot" }, el("div", { class: "drawer-actions" }, el("span", { class: "spacer" }), btn("close", closeDrawer)))),
  );
  document.addEventListener("keydown", onDrawerKey);
};

const renderReleases = (trackers) => {
  // A timeline: oldest shipped on the left, the two planned releases on the right.
  const strip = el("div", { class: "releases" });
  const slots = planningSlots(trackers);
  for (const r of [...(releasesData?.shipped ?? [])].reverse()) strip.append(releaseCard(r, "shipped"));
  strip.append(slotCard(slots.next, trackers), slotCard(slots.nextNext, trackers));
  requestAnimationFrame(() => { strip.scrollLeft = strip.scrollWidth; });
  return strip;
};

const renderCalendar = (trackers) => {
  const [y, m] = calendarMonth.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const events = eventsFor(trackers);
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const shift = (delta) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    calendarMonth = d.toISOString().slice(0, 7);
    loadBoard();
  };
  const head = el(
    "div",
    { class: "cal-head" },
    btn("‹", () => shift(-1), "ghost"),
    el("h2", {}, first.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })),
    btn("›", () => shift(1), "ghost"),
    btn("today", () => { calendarMonth = today().slice(0, 7); loadBoard(); }, "ghost"),
    el("span", { class: "spacer" }),
    el("span", { class: "muted small mono" }, "drag an item onto a day to set its deadline"),
  );
  const grid = el("div", { class: "cal-grid" });
  for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid.append(el("div", { class: "cal-dow" }, d));
  for (let i = 0; i < lead; i += 1) grid.append(el("div", { class: "cal-cell pad" }));
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const cell = el("div", { class: `cal-cell${date === today() ? " today" : ""}` }, el("div", { class: "cal-day" }, String(day)));
    for (const e of byDate.get(date) ?? []) {
      const node = el(
        "div",
        { class: `cal-event ${e.kind} ${eventState(e)}`, title: `${e.title}${e.column ? ` · ${e.column}` : ""}`, onclick: () => { if (e.item) openDrawer(e.tracker.index, e.item); else if (e.slot) openSlotDrawer(e.slot, trackers); } },
        e.kind === "release" ? `⚡ ${e.title}` : e.title,
      );
      if (e.item && !e.item.checked) draggableItem(node, e.tracker, e.item, e.section);
      cell.append(node);
    }
    dropZone(cell, (d) => d.type === "item" && d.item.fields.due !== date, (d) => editItemBody(d.tracker.index, d.item, withDue(d.item.body, date), `deadline ${date}`));
    grid.append(cell);
  }
  const undated = trackers.flatMap((t) => t.sections.filter((s) => s.column === "priority").flatMap((s) => s.groups.flatMap((g) => g.items.filter((i) => !i.checked && !i.fields.due && (showAll || isDevItem(i))).map((i) => ({ t, i, s })))));
  const side = el("div", { class: "cal-undated" }, el("h3", {}, `Roadmap items without a deadline (${undated.length})`), el("div", { class: "muted small" }, "drop a dated item here to clear its deadline"));
  dropZone(side, (d) => d.type === "item" && Boolean(d.item.fields.due), (d) => editItemBody(d.tracker.index, d.item, withDue(d.item.body, ""), "clearing deadline"));
  for (const { t, i, s } of undated.slice(0, 60)) side.append(draggableItem(el("div", { class: "cal-event item undated", onclick: () => openDrawer(t.index, i) }, i.title), t, i, s));
  return el(
    "section",
    { class: "calendar" },
    el("h3", { class: "strip-title" }, "Releases"),
    renderReleases(trackers),
    head,
    el("div", { class: "cal-legend" }, el("span", { class: "cal-event item done" }, "complete"), el("span", { class: "cal-event item warn" }, "in progress, due within a week"), el("span", { class: "cal-event item late" }, "not started, due within a week"), el("span", { class: "cal-event item" }, "later")),
    grid,
    side,
  );
};


const openFindingsDrawer = (child, v) => {
  const root = $("#drawer-root");
  const body = el("div", { class: "drawer-text" });
  body.innerHTML = renderInline(v.findings ?? "");
  const decide = async (decision) => {
    try {
      await post(`/api/sessions/${child.id}/decision`, { decision });
      setStatus(`findings ${decision}`);
      closeDrawer();
      loadRail(true);
    } catch (err) {
      setStatus(err.message, true);
    }
  };
  root.replaceChildren(
    el("div", { class: "drawer-backdrop", onclick: closeDrawer }),
    el(
      "aside",
      { class: "drawer", role: "dialog" },
      el("div", { class: "drawer-head" }, el("h2", {}, `Audit: ${child.loop}`), btn("×", closeDrawer, "ghost")),
      el("div", { class: "drawer-meta" }, el("span", { class: `verdict ${v.verdict}` }, v.verdict), v.decision ? el("span", { class: "muted mono" }, v.decision) : null, el("span", { class: "spacer" }), el("span", { class: "muted mono" }, child.audit?.file ?? "")),
      el("div", { class: "drawer-body" }, body),
      el("div", { class: "drawer-foot" }, el("div", { class: "drawer-actions" }, btn("accept findings", () => decide("accepted"), "primary"), btn("reject findings", () => decide("rejected"), "danger"), el("span", { class: "spacer" }), btn("close", closeDrawer))),
    ),
  );
  document.addEventListener("keydown", onDrawerKey);
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

const expandedSessions = new Set();
let lastSessions = null;

const renderSessions = (records, live) => {
  const out = document.createDocumentFragment();
  const byClaudeId = new Map(records.filter((r) => r.claudeId).map((r) => [r.claudeId, r]));

  const running = el("ul");
  const rank = { waiting: 0, blocked: 0, busy: 1, running: 1, shell: 2, idle: 3 };
  const ordered = [...live.claudeSessions].sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const age = (ms) => {
    if (!ms) return "";
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  for (const s of ordered) {
    const where = [s.app, s.tty, s.cwd.replace(project.path, "").replace(/^\//, "")].filter(Boolean).join(" · ");
    running.append(
      el(
        "li",
        {
          class: `row session-live ${s.status ?? ""}${expandedSessions.has(s.sessionId) ? " expanded" : ""}`,
          onclick: (e) => {
            if (e.target.closest("button")) return;
            if (expandedSessions.has(s.sessionId)) expandedSessions.delete(s.sessionId);
            else expandedSessions.add(s.sessionId);
            e.currentTarget.classList.toggle("expanded");
          },
        },
        el("span", { class: "lamp", title: `pid ${s.pid}` }),
        el("span", { class: "name" }, s.title ?? s.name ?? String(s.pid)),
        el(
          "span",
          { class: "actions" },
          btn("open", () => openTerminal({ kind: "resume", sessionId: s.sessionId, title: s.title ?? s.name ?? s.sessionId.slice(0, 8) })),
          btn("close", async () => {
            if (!confirm(`Close "${s.title ?? s.name}"?\n\nThis ends the Claude process in ${s.app ?? "its terminal"} (${s.tty ?? "no tty"}). The conversation stays on disk and can be resumed later.`)) return;
            try {
              await post(`/api/sessions/${s.pid}/close?project=${encodeURIComponent(projectId)}`);
              setStatus(`closed pid ${s.pid}`);
            } catch (err) {
              setStatus(err.message, true);
            }
            window.setTimeout(() => loadRail(true), 1500);
          }, "danger"),
        ),
        el("span", { class: "doing" }, el("span", { class: "k" }, s.status ?? "?"), text(s.waitingFor ? `${s.waitingFor} · ` : ""), el("span", { class: "age" }, `${age(s.updatedAt)}${s.elapsed ? ` · up ${s.elapsed}` : ""}${where ? ` · ${where}` : ""}`)),
        s.lastPrompt ? el("span", { class: "doing detail" }, el("span", { class: "k" }, "you"), text(s.lastPrompt)) : null,
        s.lastReply ? el("span", { class: "doing detail" }, el("span", { class: "k" }, "claude"), text(s.lastReply)) : null,
      ),
    );
  }
  for (const a of live.backgroundAgents) {
    const record = byClaudeId.get(a.id);
    running.append(
      sessionRow(
        a.state ?? "",
        record ? [el("span", { class: "role" }, record.role), text(record.loop)] : (a.name ?? a.id),
        `background · ${a.state ?? "?"} · started ${age(a.startedAt)} · ${a.id}`,
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

  const parents = records.filter((r) => r.role === "audit");
  if (parents.length) {
    const wrap = el("div");
    for (const parent of parents) {
      const children = records.filter((r) => r.parent === parent.id);
      const ul = el("ul");
      for (const c of children) {
        const v = c.auditView ?? { verdict: "none" };
        const agent = live.backgroundAgents.find((a) => a.id === c.claudeId);
        const chip = el("span", { class: `verdict ${v.verdict}${v.decision ? ` ${v.decision}` : ""}` }, v.verdict === "none" ? "not audited" : v.verdict === "pending" ? `auditing (${v.agentState ?? "…"})` : `${v.verdict}${v.decision ? ` · ${v.decision}` : ""}`);
        ul.append(
          sessionRow(
            agent?.state ?? c.status,
            [el("span", { class: "role" }, c.role), text(c.loop)],
            [agent ? `task ${agent.state}` : c.status, c.claudeId ? `claude attach ${c.claudeId}` : null].filter(Boolean).join(" · "),
            [
              chip,
              v.verdict === "none" && c.claudeId ? btn("audit now", async () => { try { await post(`/api/sessions/${c.id}/audit?project=${encodeURIComponent(projectId)}`); setStatus("audit started"); } catch (err) { setStatus(err.message, true); } loadRail(true); }) : null,
              v.findings ? btn("findings", () => openFindingsDrawer(c, v)) : null,
              c.claudeId && agent ? btn("open", () => openTerminal({ kind: "attach", id: c.claudeId, title: c.loop })) : null,
            ].filter(Boolean),
          ),
        );
      }
      if (!children.length) ul.append(el("li", { class: "empty" }, "no task sessions yet: pick this parent when you spawn from a card"));
      wrap.append(el("h3", {}, el("span", { class: "role" }, "audit parent"), text(parent.loop)), ul);
    }
    out.append(wrap);
  }
  const recorded = records.filter((r) => r.role !== "audit" && !r.parent && (!r.claudeId || !live.backgroundAgents.some((a) => a.id === r.claudeId)));
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
    lastSessions = sessions;
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
    else {
      $("#dock").hidden = true;
      document.body.classList.remove("docked");
    }
  }
};

const mountTerminal = (info) => {
  $("#dock").hidden = false;
  document.body.classList.add("docked");
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

const openTerminal = async ({ kind, id, sessionId, title, prompt, cwd, parent }) => {
  setStatus(`opening ${title ?? kind}`);
  try {
    const info = await post("/api/terminals", { project: projectId, kind, id, sessionId, title, prompt, cwd, parent, ...termSize() });
    mountTerminal(info);
    setStatus(`terminal ${info.id}: ${info.command.join(" ")}`);
    if (kind === "spawn") loadRail(true);
  } catch (err) {
    setStatus(err.message, true);
  }
};

const spawnOnItem = (item, card, parent) => {
  if (!confirm(`Spawn a headless Claude session on:\n\n${item.title}\n\nIt starts in ${project.path} in auto permission mode and opens below.${parent ? "\nWhen it finishes, the auditor reviews it." : ""}`)) return;
  if (card) strike(card);
  openTerminal({ kind: "spawn", title: item.title.slice(0, 80), prompt: item.body, parent });
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

  $("#view-toggle").hidden = false;
  for (const b of document.querySelectorAll("#view-toggle button")) {
    b.addEventListener("click", () => {
      view = b.dataset.view;
      try { localStorage.setItem("console.view", view); } catch {}
      loadBoard();
    });
  }

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
  let railCollapsed = false;
  try { railCollapsed = localStorage.getItem("console.rail") === "collapsed"; } catch {}
  const applyRail = () => {
    $("#project").classList.toggle("rail-collapsed", railCollapsed);
    $("#rail-fold").textContent = railCollapsed ? "▸" : "▾";
    $("#rail-fold").title = railCollapsed ? "show sessions" : "hide sessions";
  };
  $("#rail-fold").addEventListener("click", () => {
    railCollapsed = !railCollapsed;
    try { localStorage.setItem("console.rail", railCollapsed ? "collapsed" : "open"); } catch {}
    applyRail();
  });
  applyRail();
  $("#new-session").addEventListener("click", (e) => {
    strike(e.currentTarget);
    openTerminal({ kind: "new", title: `claude · ${project.name}` });
  });

  await Promise.all([loadBoard(), loadRail()]);
  const linkedRelease = location.hash.match(/^#release-(.+)$/);
  if (linkedRelease) {
    releasesData = releasesData ?? (await api(`/api/releases?project=${encodeURIComponent(projectId)}`));
    await loadBoard();
    const want = decodeURIComponent(linkedRelease[1]);
    if (want === "next" || want === "next+1") {
      const slots = planningSlots(lastTrackers);
      openSlotDrawer(want === "next" ? slots.next : slots.nextNext, lastTrackers);
    } else {
      const r = releasesData.shipped.find((x) => x.version === want);
      if (r) openReleaseDrawer(r, "shipped");
    }
  }
  const linked = location.hash.match(/^#L(\d+)$/);
  if (linked) {
    const line = Number(linked[1]) - 1;
    for (const tracker of lastTrackers) {
      const item = tracker.sections.flatMap((sec) => sec.groups.flatMap((g) => g.items)).find((i) => i.start === line);
      if (item) openDrawer(tracker.index, item);
    }
  }
  scheduleWeather();
  const existing = await api("/api/terminals");
  for (const t of existing) if (t.exitCode === null) mountTerminal(t);
};

boot().catch((err) => setStatus(err.message, true));
