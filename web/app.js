// The console UI. Plain DOM and fetch; the same file runs in a browser or an Electron
// window because it only ever talks to /api/*. One project at a time: `?project=<id>`
// selects it, no parameter reopens the last one, and `?pick` shows the picker.
import { jetSvg } from "./jet.js";
import { PROJECT_PROPS, applyProjectTheme } from "./theme.js";
import { strike, loading, missile, flares, flyby } from "./afterburner.js";
import { mountCommandCenter } from "./command.js";
import { mountDevBadge } from "./dev-badge.js";
import { icon } from "./icons.js";
import { lamp } from "./lamp.js";
import { failed, leave, toast } from "./toast.js";
import * as claudeUsage from "./providers/claude.js";


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

/**
 * Maverick's own confirm and prompt, in place of the browser's. Resolves true or false; with
 * `field` it resolves the trimmed text, or null on cancel. Escape and the backdrop cancel, the
 * page behind goes inert, and focus returns where it was. A dangerous question focuses cancel,
 * so a reflex Enter cannot destroy anything; Enter in a field submits, as a form does.
 */
const ask = ({ title, body, confirm, danger = false, field = null }) =>
  new Promise((resolve) => {
    const before = document.activeElement;
    // A drawer under the ask has already made the page inert; closing the ask gives back only what it took.
    const page = [...document.body.children].filter((n) => !n.inert);
    const finish = (value) => {
      window.removeEventListener("keydown", onKey, true);
      for (const n of page) n.inert = false;
      document.body.classList.remove("ask-open");
      leave(backdrop);
      before?.focus?.();
      resolve(value);
    };
    const bail = () => finish(field ? null : false);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      bail();
    };
    const input = field ? el("input", { type: "text", placeholder: field.placeholder ?? "", value: field.value ?? "", "aria-label": title }) : null;
    const ok = el("button", { type: "submit", class: danger ? "danger" : "primary" }, confirm);
    const no = btn("cancel", bail, "ghost");
    if (input) {
      ok.disabled = !input.value.trim();
      input.addEventListener("input", () => { ok.disabled = !input.value.trim(); });
    }
    // The dialog is the box; the form inside it only carries Enter. A form may not take the dialog role.
    const form = el("div", { class: "ask", role: "dialog", "aria-modal": "true", "aria-labelledby": "ask-title", ...(body ? { "aria-describedby": "ask-body" } : {}) },
      el("form", { class: "ask-form", onsubmit: (e) => { e.preventDefault(); finish(field ? input.value.trim() : true); } },
        el("h2", { id: "ask-title" }, title),
        body ? el("p", { id: "ask-body" }, body) : null,
        input,
        el("div", { class: "ask-actions" }, no, ok)));
    const backdrop = el("div", { class: "ask-backdrop", onclick: (e) => { if (e.target === backdrop) bail(); } }, form);
    for (const n of page) n.inert = true;
    document.body.append(backdrop);
    document.body.classList.add("ask-open");
    window.addEventListener("keydown", onKey, true);
    (input ?? (danger ? no : ok)).focus();
  });

/** The two questions every session surface asks: close an interactive claude, or stop / remove a background one. */
const askClose = (s) => ask({ title: `Close "${s.title ?? s.name}"?`, body: `This ends the Claude process in ${s.app ?? "its terminal"}${s.tty ? ` (${s.tty})` : ""}. The conversation stays on disk and can be resumed later.`, confirm: "close", danger: true });
const askEnd = (done, label) => ask(done
  ? { title: `Remove ${label}?`, body: "It leaves the list; its transcript stays on disk.", confirm: "remove" }
  : { title: `Stop ${label}?`, body: "Its conversation is kept and can be resumed.", confirm: "stop", danger: true });

const api = async (path, init) => {
  const res = await fetch(path, init);
  // A failure does not always answer in JSON: a route that is not there answers 405 with an
  // empty body, and parsing that first reported "Unexpected end of JSON input", which names
  // neither the status nor the path. The status is the thing worth saying.
  const raw = await res.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    if (res.ok) throw new Error(`${path} answered ${res.status} with something that is not JSON`);
    body = null;
  }
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText} on ${path}`);
  return body;
};
const post = (path, body) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

const projectId = new URLSearchParams(location.search).get("project");
let project = null;

try {
} catch {}

/* ---------- picker ---------- */

const renderPicker = async () => {
  $("#picker").hidden = false;
  const list = $("#project-list");
  let projects;
  try {
    projects = await api("/api/projects");
  } catch (err) {
    // The list could not be read; importing still works, so the page says so and offers the read again.
    list.replaceChildren(el("li", { class: "trouble" }, `Could not read your projects: ${err.message}`, btn("try again", renderPicker)));
    return;
  }
  list.replaceChildren(
    ...projects.map((p) =>
      el(
        "li",
        {},
        el("a", { href: `/?project=${encodeURIComponent(p.id)}` }, p.name),
        el("div", { class: "muted mono" }, `${p.path} · ${p.trackers?.length ? p.trackers.map((t) => t.label).join(", ") : "no tracker found"}`),
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            onclick: async () => {
              if (!(await ask({ title: `Forget "${p.name}"?`, body: "The directory is untouched.", confirm: "forget" }))) return;
              try {
                await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
              } catch (err) {
                return failed(`forget "${p.name}"`, err);
              }
              try { if (localStorage.getItem("mv.project") === p.id) localStorage.removeItem("mv.project"); } catch {}
              toast(`Forgot "${p.name}". Its directory is untouched.`);
              renderPicker();
            },
          },
          "forget",
        ),
      ),
    ),
  );
  if (!projects.length) list.append(el("li", { class: "muted" }, "No projects yet. Import a directory below, or paste its path."));
};

$("#import").addEventListener("click", async () => {
  setStatus("Waiting for the Finder dialog…");
  try {
    const result = await post("/api/projects/import");
    if (result.cancelled) return toast("Nothing imported: the Finder dialog was cancelled.");
    location.href = `/?project=${encodeURIComponent(result.id)}`;
  } catch (err) {
    failed("import the directory", err);
  } finally {
    setStatus("");
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
    failed(`add ${path}`, err);
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

// The title is the card's button: Enter opens the drawer, where every verb lives, the move
// included. A click anywhere else on the card opens it too; a drag moves it.
const cardFor = (trackerIndex, item, number, draggable = true) =>
  el(
    "div",
    {
      class: `card${item.checked ? " checked" : ""}`,
      draggable: draggable ? "true" : "false",
      onmouseenter: (e) => scheduleHover(e.currentTarget, item),
      onmouseleave: hideHover,
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
        if (e.target.closest("button:not(.title)")) return;
        hideHover();
        openDrawer(trackerIndex, item);
      },
    },
    number === null ? null : el("span", { class: "num" }, String(number)),
    el("button", { type: "button", class: "title", onfocus: hideHover }, el("span", {}, item.title)),
    el("div", { class: "meta" }, releaseChip(item), dueChip(item), ...tagChips(item), item.unplanned ? el("span", { class: "chip unplanned", title: "on the roadmap with no plan: a plan: field that names a real file" }, "unplanned") : null, createdOf(item) ? el("span", { class: "since", title: `${item.created ? "created" : "entry last changed"} ${fmtDate(createdOf(item))}` }, fmtDate(createdOf(item), true)) : null),
    item.checked
      ? null
      : el(
          "button",
          {
            type: "button",
            class: "spawn ghost",
            "aria-label": `spawn a session on ${item.title}`,
            title: "Spawn a headless Claude session on this item and open it below",
            onclick: (e) => {
              e.stopPropagation();
              spawnOnItem(trackerIndex, item, e.currentTarget.closest(".card"));
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

/** The calendar date where the person is, not at Greenwich: at 7pm Pacific the UTC date is already tomorrow. */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-18" as "Sep 18, 2026"; `short` drops the year when it is this year. */
const fmtDate = (iso, short = false) => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso ?? "";
  const [, y, mo, d] = m;
  const day = `${MONTHS[Number(mo) - 1]} ${Number(d)}`;
  return short && y === today().slice(0, 4) ? day : `${day}, ${y}`;
};
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
/** A document inside the project, served read-only. */
const fileHref = (path) => `/files?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`;
/**
 * One write from the board or the calendar. The bar says what is under way while it runs; the
 * outcome is a toast, and a refusal names the action. The board repaints from the file either
 * way. Resolves true when the write went through, so a drawer closes only then.
 */
const write = async (what, done, run, undo = null) => {
  setStatus(`${what}…`);
  try {
    await run();
    toast(done, undo ? { action: { label: "undo", run: undo } } : {});
    return true;
  } catch (err) {
    failed(what, err);
    return false;
  } finally {
    setStatus("");
    await loadBoard();
  }
};
const short = (title) => (title.length > 48 ? `"${title.slice(0, 47)}…"` : `"${title}"`);
const editItemBody = (trackerIndex, item, newBody) =>
  post("/api/edit", { project: projectId, tracker: trackerIndex, itemStart: item.start, itemFirstLine: item.firstLine, body: newBody });
/** The item on the repainted board that `is` picks: lines move under a write, so an undo finds its item again. */
const findItem = (trackerIndex, is) => lastTrackers[trackerIndex]?.sections.flatMap((s) => s.groups.flatMap((g) => g.items)).find(is);
/** An edit and its undo: the undo writes the old body back over the item that now carries the new one. */
const editWithUndo = (trackerIndex, item, newBody, what, done) =>
  write(what, done, () => editItemBody(trackerIndex, item, newBody), () => {
    const now = findItem(trackerIndex, (i) => i.body === newBody);
    if (now) write(`undo: ${what}`, `Undone: ${what}.`, () => editItemBody(trackerIndex, now, item.body));
    else failed(`undo: ${what}`, new Error("the item changed again since"));
  });
const createdOf = (item) => item.created ?? item.lineDate;
/** The source line minus the date already shown as created ("Cory, 2026-09-14." becomes "Cory"). */
const sourceWithoutDate = (item) => {
  if (!item.source) return "";
  const stripped = item.created ? item.source.replace(item.created, "") : item.source;
  return stripped.replace(/^[\s,.;:]+|[\s,.;:]+$/g, "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
};
const releaseChip = (item) => {
  const slot = item.fields?.release;
  if (!slot || !lastTrackers.length) return null;
  const slots = planningSlots(lastTrackers);
  const label = slot === "next" ? slots.next.label : slot === "next+1" ? slots.nextNext.label : slot;
  return el("span", { class: "chip release", title: slot === "next" ? "planned for the next release" : "planned for the release after next" }, label);
};

/** Calendar state: done is green, a deadline gone by is red (it failed), within a week is lit, later is plain. */
const eventState = (e) => {
  if (e.kind !== "item") return "";
  if (e.item.checked || e.column === "shipped") return "done";
  const days = Math.round((new Date(e.date) - new Date(today())) / 86400000);
  return days < 0 ? "overdue" : days <= 7 ? "soon" : "";
};
const EVENT_WORDS = { done: "done", overdue: "overdue", soon: "due within a week", "": "due later" };
const EVENT_ICONS = { done: "decision", overdue: "finding" };
/** One thing on a day: a button, so it is reached and opened from the keyboard like anything else. */
const calEvent = (cls, label, words, onclick) =>
  el("button", { type: "button", class: `cal-event ${cls}`, title: `${label}${words ? `, ${words}` : ""}`, "aria-label": `${label}${words ? `, ${words}` : ""}`, onclick }, label);

const dueChip = (item) => {
  const due = item.fields?.due;
  if (!due) return null;
  return el("span", { class: `chip due ${dueState(due, item.checked)}`, title: `due ${fmtDate(due)}` }, `due ${fmtDate(due, true)}`);
};

const dropIndexIn = (list, y) => {
  const cards = [...list.querySelectorAll(".card:not(.dragging)")];
  const idx = cards.findIndex((c) => y < c.getBoundingClientRect().top + c.offsetHeight / 2);
  return idx < 0 ? cards.length : idx;
};

const showsInLane = (item, laneId) => {
  if (laneId === "shipped") return true;
  if (item.checked) return false;
  return isDevItem(item);
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
    if (await moveItem(trackerIndex, item, section, group, targetIndex)) flares(list);
  });
  return list;
};

/** The one move, from a drop or from the drawer: the same write to the tracker either way. Undo moves it back. */
const moveItem = (trackerIndex, item, section, group, targetIndex, undoing = false) => {
  const where = group.name ? cleanGroupName(group.name) : laneName(section);
  const from = placeOf(trackerIndex, item);
  const run = () => post("/api/move", { project: projectId, tracker: trackerIndex, itemStart: item.start, itemFirstLine: item.firstLine, targetHeading: section.heading, targetGroup: group.name, targetIndex });
  const back = () => {
    const now = findItem(trackerIndex, (i) => i.firstLine === item.firstLine);
    if (now && from) moveItem(trackerIndex, now, from.section, from.group, from.at, true);
    else failed(`move ${short(item.title)} back`, new Error("it is no longer on the board"));
  };
  return write(`move ${short(item.title)}${undoing ? " back" : ""}`, undoing ? `Moved ${short(item.title)} back.` : `Moved ${short(item.title)} to ${where}, #${targetIndex + 1}.`, run, undoing ? null : back);
};
const laneName = (section) => LANES.find(([id]) => id === section.column)?.[1] ?? section.heading;

const cleanGroupName = (name) => name.replace(/\[(.*?)\]\(.*?\)/g, "$1").trim();

/** Checked items from every non-done section, shown read-only in the Done lane. */
const doneElsewhere = (tracker) =>
  tracker.sections
    .filter((s) => s.column && s.column !== "shipped")
    .flatMap((s) => s.groups.flatMap((g) => g.items.filter((i) => i.checked)));

const LANE_EMPTY = {
  backlog: "Nothing waiting. Add what you would do later.",
  priority: "Nothing on the roadmap. Add an item, or move one up from the backlog.",
  "in-progress": "Nothing in flight. Move an item here when work starts.",
  shipped: "Nothing done since the last deploy.",
};

const quickAdd = (tracker, section, label, key) => {
  const input = el("input", { type: "text", placeholder: `add to ${label.toLowerCase()}`, "aria-label": `new item in ${label}`, autocomplete: "off" });
  return el("form", {
    class: "quick-add",
    "data-lane": key,
    onsubmit: async (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      const ok = await write(`add ${short(title)}`, `Added ${short(title)} to ${label}.`, () => post("/api/items", { project: projectId, tracker: tracker.index, heading: section.heading, name: "", title }));
      // The board repainted; the lane's new field takes the focus back, and a refusal keeps the words.
      const again = document.querySelector(`.quick-add[data-lane="${key}"] input`);
      if (!again) return;
      if (!ok) again.value = title;
      again.focus();
    },
  }, input, el("button", { type: "submit" }, "add"));
};

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
      foldButton(!isCollapsed, label, () => {
        if (isCollapsed) collapsed.delete(key);
        else collapsed.add(key);
        persistCollapsed();
        loadBoard();
      }),
      el("span", { class: "label" }, label),
      el("span", { class: "count" }, String(count)),
    ),
  );
  if (isCollapsed) return lane;
  // A new item lands at the top of the lane's first section, outside any group, as one typed line.
  if (laneId !== "shipped" && sections.length) lane.append(quickAdd(tracker, sections[0], label, key));
  if (!count) lane.append(el("p", { class: "lane-empty muted small" }, LANE_EMPTY[laneId]));

  for (const section of sections) {
    if (sections.length > 1) lane.append(el("div", { class: "group-name" }, section.heading));
    const releases = laneId === "priority";
    for (const group of section.groups) {
      // Groups are labels, never boxes: the lane stays one runway. An empty group can be deleted.
      const block = el("div", { class: "group" });
      if (group.name) {
        const removable = group.items.length === 0;
        block.append(el("div", { class: "group-name" }, cleanGroupName(group.name), removable ? el("button", { type: "button", class: "ghost icon-btn", "aria-label": `delete the empty group ${cleanGroupName(group.name)}`, title: "delete this empty group", onclick: async () => {
          if (!(await ask({ title: `Delete the empty group "${cleanGroupName(group.name)}"?`, confirm: "delete", danger: true }))) return;
          await write(`delete the group "${cleanGroupName(group.name)}"`, `Deleted the empty group "${cleanGroupName(group.name)}".`, () => api("/api/groups", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: projectId, tracker: tracker.index, heading: section.heading, name: group.name }) }));
        } }, icon("close")) : null));
      }
      block.append(itemsList(tracker.index, section, group, laneId, releases));
      lane.append(block);
    }
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
  // A collapsed lane is a fixed strip, not a fraction: a fraction grows with the window and
  // never actually gets out of the way.
  lanes.style.setProperty("--lane-widths", LANES.map(([id]) => (collapsed.has(`${tracker.index}:${id}`) ? "36px" : id === "priority" ? "minmax(0, 1.5fr)" : "minmax(0, 1fr)")).join(" "));
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
    if ($("#status").textContent === "loading") { $("#status").textContent = ""; $("#status").classList.remove("loading"); }
    // The workspace does not need releases (a GitHub round trip); the board and calendar do.
    if (!releasesData && view !== "workspace") releasesData = await api(`/api/releases?project=${encodeURIComponent(projectId)}`);
    // Every view carries the ship-day banner, so the schedule is not calendar-only.
    [ships, shipDays] = await Promise.all([api(`/api/ships?project=${encodeURIComponent(projectId)}`), api(`/api/ship-schedule?project=${encodeURIComponent(projectId)}`)]);
    $("#project").classList.toggle("workspace-view", view === "workspace");
    $("#boards").replaceChildren(
      ...shipDayBanner(trackers),
      ...(view === "calendar"
        ? [renderCalendar(trackers)]
        : view === "workspace"
          ? [await renderWorkspace()]
          : [releasesSection(trackers), ...trackers.map(renderBoard)]),
    );
    for (const b of document.querySelectorAll("#view-toggle button")) b.classList.toggle("active", b.dataset.view === view);
    if (!trackers.length) $("#boards").append(el("p", { class: "muted" }, "No tracker file the console recognises (CHECKLIST.md, PUNCHLIST.md, TODO.md)."));
  } catch (err) {
    setStatus(err.message, true);
  }
};



/* ---------- hover card ---------- */

let hoverTimer = null;
let hoverNode = null;
const hideHover = () => {
  window.clearTimeout(hoverTimer);
  hoverTimer = null;
  hoverNode?.remove();
  hoverNode = null;
};
const scheduleHover = (card, item) => {
  hideHover();
  hoverTimer = window.setTimeout(() => {
    if (dragging || !card.isConnected) return;
    const rect = card.getBoundingClientRect();
    const node = el("div", { class: "hovercard" });
    const text = el("div", { class: "hovercard-text" });
    const description = item.description || "(no description)";
    text.innerHTML = renderInline(description.length > 700 ? `${description.slice(0, 699)}…` : description);
    node.append(
      el("div", { class: "hovercard-title" }, item.title),
      el("div", { class: "hovercard-meta" }, releaseChip(item), dueChip(item), ...tagChips(item), item.created ? el("span", { class: "muted mono" }, `created ${fmtDate(item.created)}`) : null, sourceWithoutDate(item) ? el("span", { class: "muted" }, sourceWithoutDate(item)) : null),
      text,
      el("div", { class: "hovercard-hint muted mono" }, "click to open · drag to move"),
    );
    document.body.append(node);
    const width = Math.min(420, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.right + 12), window.innerWidth - width - 12);
    const fitsRight = rect.right + 12 + width <= window.innerWidth;
    node.style.width = `${width}px`;
    node.style.left = `${fitsRight ? rect.right + 12 : Math.max(12, rect.left - width - 12)}px`;
    node.style.top = `${Math.min(rect.top, window.innerHeight - node.offsetHeight - 12)}px`;
    void left;
    hoverNode = node;
  }, 380);
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

let drawerOpener = null;
const closeDrawer = () => {
  stopTails();
  $("#drawer-root").replaceChildren();
  for (const n of document.body.children) n.inert = false;
  if (location.hash.startsWith("#L")) history.replaceState(null, "", location.pathname + location.search);
  document.removeEventListener("keydown", onDrawerKey);
  if (drawerOpener?.isConnected) drawerOpener.focus();
  drawerOpener = null;
};
const onDrawerKey = (e) => {
  if (e.key === "Escape") closeDrawer();
};

/**
 * Every drawer: a modal dialog whose one close is the icon in its head. The page behind goes
 * inert, the heading takes focus, and closing gives focus back to what opened it.
 */
const showDrawer = ({ title, head = [], meta = null, body, foot = [], wide = false, backdrop = closeDrawer }) => {
  if (!$("#drawer-root").childElementCount) drawerOpener = document.activeElement;
  const h2 = el("h2", { tabindex: "-1" }, title);
  $("#drawer-root").replaceChildren(
    el("div", { class: "drawer-backdrop", onclick: backdrop }),
    el("aside", { class: `drawer${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": typeof title === "string" ? title : h2.textContent },
      el("div", { class: "drawer-head" }, h2, ...head, el("button", { type: "button", class: "ghost icon-btn", "aria-label": "close", title: "close (Esc)", onclick: closeDrawer }, icon("close"))),
      meta,
      body,
      foot.length ? el("div", { class: "drawer-foot" }, el("div", { class: "drawer-actions" }, ...foot)) : null),
  );
  for (const n of document.body.children) if (n.id !== "drawer-root" && !n.classList.contains("toasts")) n.inert = true;
  document.addEventListener("keydown", onDrawerKey);
  h2.focus();
};

/** Where an item sits: its section, its group and its place in the group, read from the last board. */
const placeOf = (trackerIndex, item) => {
  for (const section of lastTrackers[trackerIndex]?.sections ?? []) {
    for (const group of section.groups) {
      const at = group.items.findIndex((i) => i.start === item.start);
      if (at >= 0) return { section, group, at };
    }
  }
  return null;
};

/**
 * The move without a drag: a destination, and a step up or down the group. Each is the same
 * write a drop makes. A new group takes the item at its end, as a drop below its last card does.
 */
const moveRow = (trackerIndex, item) => {
  const here = placeOf(trackerIndex, item);
  if (!here) return null;
  const places = lastTrackers[trackerIndex].sections.filter((s) => s.column).flatMap((section) => section.groups.map((group) => ({ section, group })));
  const where = el("select", { id: "drawer-move" }, ...places.map(({ section, group }, i) =>
    el("option", { value: String(i), ...(group === here.group ? { selected: "" } : {}) }, `${laneName(section)}${group.name ? ` / ${cleanGroupName(group.name)}` : ""}`)));
  const go = async (section, group, index) => closeIf(await moveItem(trackerIndex, item, section, group, index));
  const up = btn("move up", () => go(here.section, here.group, here.at - 1), "ghost");
  const down = btn("move down", () => go(here.section, here.group, here.at + 1), "ghost");
  up.disabled = here.at === 0;
  down.disabled = here.at === here.group.items.length - 1;
  const move = btn("move", () => {
    const to = places[Number(where.value)];
    if (to.group !== here.group) go(to.section, to.group, to.group.items.length);
  });
  move.disabled = true;
  where.addEventListener("change", () => { move.disabled = places[Number(where.value)].group === here.group; });
  return el("div", { class: "due-row" }, el("label", { class: "k", for: "drawer-move" }, "lane"), where, move, up, down);
};

const openDrawer = (trackerIndex, item) => {
  let editing = false;
  const body = el("div", { class: "drawer-body" });
  const actions = el("div", { class: "drawer-actions" });

  const FIELD_ORDER = ["size", "kind", "status", "owner", "mission", "milestone", "pr", "blocked-by", "links"];
  const saveBody = async (newBody, what, done) => closeIf(await editWithUndo(trackerIndex, item, newBody, what, done));
  const view = () => {
    const grid = el("dl", { class: "fields" });
    const addField = (k, v, cls = "") => grid.append(el("dt", {}, k), el("dd", { class: cls }, v));
    if (item.created) addField("created", fmtDate(item.created));
    else if (item.lineDate) addField("created", `unknown; the entry was last changed ${fmtDate(item.lineDate)}`);
    const sourceText = sourceWithoutDate(item);
    if (sourceText) addField("source", sourceText);
    for (const k of FIELD_ORDER) {
      if (!item.fields[k]) continue;
      const v = item.fields[k];
      if (/^(https?:\/\/|plans\/|deliverables\/|\.\.\/)/.test(v)) addField(k, el("code", {}, v));
      else addField(k, v);
    }
    // The plan is the one field the board checks: a link when the file exists, red when the field names nothing.
    if (item.planFile) addField("plan", el("a", { href: fileHref(item.planFile), target: "_blank" }, el("code", {}, item.fields.plan)));
    else if (item.fields.plan) addField("plan", el("code", {}, item.fields.plan), "overdue");
    else if (!item.checked && !item.planned) addField("plan", item.unplanned ? "none; the roadmap needs one" : "none", item.unplanned ? "needs" : "");
    const tracker = lastTrackers[trackerIndex];
    const slotsNow = planningSlots(lastTrackers);
    const releaseSelect = el("select", { id: "drawer-release" },
      el("option", { value: "" }, "no release"),
      el("option", { value: "next", ...(item.fields.release === "next" ? { selected: "" } : {}) }, `${slotsNow.next.label} (next)`),
      el("option", { value: "next+1", ...(item.fields.release === "next+1" ? { selected: "" } : {}) }, `${slotsNow.nextNext.label} (the one after)`));
    releaseSelect.addEventListener("change", async () => closeIf(await setItemRelease(tracker, item, releaseSelect.value)));
    const releaseRow = el("div", { class: "due-row" }, el("label", { class: "k", for: "drawer-release" }, "release"), releaseSelect);
    const dueInput = el("input", { type: "date", id: "drawer-due", value: item.fields.due ?? "" });
    const dueRow = el(
      "div",
      { class: "due-row" },
      el("label", { class: "k", for: "drawer-due" }, "deadline"),
      dueInput,
      btn("set", async () => closeIf(await setDue(tracker, item, dueInput.value))),
      item.fields.due ? btn("clear", async () => closeIf(await setDue(tracker, item, "")), "ghost") : null,
      item.fields.due ? el("span", { class: `due ${dueState(item.fields.due, item.checked)}` }, dueState(item.fields.due, item.checked) === "overdue" ? "overdue" : dueState(item.fields.due, item.checked) === "soon" ? "within a week" : "later") : null,
    );
    const prose = el("div", { class: "drawer-text" });
    prose.innerHTML = renderInline(item.description || "(no description)");
    body.replaceChildren(grid.childElementCount ? grid : null, releaseRow, dueRow, item.checked ? null : moveRow(trackerIndex, item), prose);
    const parents = (lastSessions ?? []).filter((r) => r.role === "audit" && r.status === "open");
    const supervisor = el("select", { class: "supervisor", "aria-label": "audit parent", title: "audit parent: the finished session is audited under it" },
      el("option", { value: "" }, "no audit parent"),
      ...parents.map((p) => el("option", { value: p.id }, `audit under: ${p.loop}`)),
      el("option", { value: "__new" }, "new audit parent…"));
    supervisor.addEventListener("change", async () => {
      if (supervisor.value !== "__new") return;
      const name = await ask({ title: "Name the audit parent", body: "A group of task sessions it oversees.", confirm: "create", field: { placeholder: "audit parent name" } });
      supervisor.value = "";
      if (!name) return;
      try {
        const created = await post("/api/audit-parents", { project: projectId, name });
        supervisor.insertBefore(el("option", { value: created.id, selected: "" }, `audit under: ${created.loop}`), supervisor.lastElementChild);
        supervisor.value = created.id;
        toast(`Created the audit parent "${created.loop}".`);
        loadRail();
      } catch (err) {
        failed("create the audit parent", err);
      }
    });
    const flipped = item.body.replace(/^- (\[( |x)\] )?/i, item.checked ? "- [ ] " : "- [x] ");
    // replaceChildren paints a null as the word "null"; el() drops them, this does not, so filter.
    // One primary: plan an unplanned item, spawn on a planned one.
    actions.replaceChildren(...[
      item.checked || item.planned ? null : btn("plan it", () => { closeDrawer(); planItem(trackerIndex, item); }, "primary"),
      item.checked ? null : btn("spawn", () => { const parent = supervisor.value || undefined; closeDrawer(); spawnOnItem(trackerIndex, item, null, parent); }, item.planned ? "primary" : ""),
      item.checked ? null : supervisor,
      el("span", { class: "spacer" }),
      btn(item.checked ? "reopen" : "mark done", () => saveBody(flipped, item.checked ? `reopen ${short(item.title)}` : `mark ${short(item.title)} done`, item.checked ? `Reopened ${short(item.title)}.` : `Marked ${short(item.title)} done.`)),
      btn("remove", async () => {
        const reason = await ask({ title: "Why is this leaving the tracker?", body: "It moves to the Removed section with the date and this reason.", confirm: "remove", danger: true, field: { placeholder: "reason" } });
        if (!reason) return;
        if (await write(`remove ${short(item.title)}`, `Removed ${short(item.title)}. It is in the Removed section with your reason.`, () => post("/api/remove", { project: projectId, tracker: trackerIndex, itemStart: item.start, itemFirstLine: item.firstLine, reason }))) closeDrawer();
      }, "danger"),
      btn("edit markdown", () => { editing = true; edit(); }),
    ].filter(Boolean));
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
      btn("save", () => saveBody(area.value, `save ${short(item.title)}`, `Saved ${short(item.title)}.`), "primary"),
    );
  };

  showDrawer({
    title: item.title,
    meta: el("div", { class: "drawer-meta" }, ...tagChips(item), dueChip(item), el("span", { class: "spacer" }), el("span", { class: "muted mono" }, `line ${item.start + 1} · ${item.checked ? "done" : "open"}`)),
    body,
    backdrop: () => { if (!editing) closeDrawer(); },
  });
  $("#drawer-root .drawer").append(el("div", { class: "drawer-foot" }, actions));
  view();
  history.replaceState(null, "", `#L${item.start + 1}`);
};


/* ---------- calendar ---------- */

let calendarMonth = today().slice(0, 7);
let view = "workspace";
try { view = ["board", "calendar"].includes(localStorage.getItem("console.view")) ? localStorage.getItem("console.view") : "workspace"; } catch {}
const viewParam = new URLSearchParams(location.search).get("view");
if (["board", "calendar", "workspace"].includes(viewParam)) view = viewParam;
// A pop-out window is already pinned to what it is showing, so it drops the navigation: the
// bar, the page title, the tab row and the instruments. Set before first paint, not after,
// or the chrome flashes in and out on the way.
if (new URLSearchParams(location.search).get("bare") === "1") document.body.classList.add("bare");

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
          if (!isDevItem(item)) continue;
          events.push({ date: item.fields.due, kind: "item", title: item.title, tracker, section, item, column: section.column });
        }
      }
    }
  }
  return events;
};

let calDrag = null;

const stripDeploy = (name) => cleanGroupName(name).replace(/\s*\(?\s*(?:deploy|ship)\s+\d{4}-\d{2}-\d{2}\s*\)?/i, "").trim();

const setDeployDate = (tracker, section, group, date) => {
  const newName = date ? `${stripDeploy(group.name)} (deploy ${date})` : stripDeploy(group.name);
  return post("/api/groups/rename", { project: projectId, tracker: tracker.index, heading: section.heading, oldName: group.name, newName });
};

const setDue = (tracker, item, date) =>
  editWithUndo(tracker.index, item, withDue(item.body, date), date ? `set the deadline of ${short(item.title)}` : `clear the deadline of ${short(item.title)}`, date ? `${short(item.title)} is due ${fmtDate(date)}.` : `${short(item.title)} has no deadline.`);

const draggable = (node, payload) => {
  node.draggable = true;
  node.addEventListener("dragstart", (e) => {
    calDrag = payload;
    node.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  node.addEventListener("dragend", () => { node.classList.remove("dragging"); calDrag = null; });
  return node;
};
const draggableItem = (node, tracker, item, section) => draggable(node, { type: "item", tracker, item, section });
const draggableShip = (node, occ) => draggable(node, { type: "ship", occ });

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
    if (await onDrop(drag)) flares(node);
  });
  return node;
};

let releasesData = null;
/** { schedule, occurrences } from /api/ship-schedule, for the calendar and the ship-day banner. */
let shipDays = null;

const isFeatureItem = (i) => i.fields.kind === "feature" || i.tags.some((t) => t.toLowerCase() === "feature");
const isBugItem = (i) => i.fields.kind === "bug" || i.tags.some((t) => t.toLowerCase() === "bug");
const bump = (version, level) => {
  const [maj, min, pat] = version.split(".").map((n) => Number(n) || 0);
  return level === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
};
/** The two planning slots: what is in them, and the version each earns from its contents. */
const planningSlots = (trackers) => {
  const items = trackers.flatMap((t) => t.sections.filter((sec) => sec.column && sec.column !== "shipped").flatMap((sec) => sec.groups.flatMap((g) => g.items.filter((i) => !i.checked && isDevItem(i)).map((i) => ({ tracker: t, section: sec, item: i })))));
  const next = items.filter(({ item }) => item.fields.release === "next");
  const nextNext = items.filter(({ item }) => item.fields.release === "next+1");
  const base = releasesData?.shipped[0]?.version ?? "0.0.0";
  const merged = releasesData?.next?.counts ?? { added: 0, fixed: 0, changed: 0, prs: 0, prFeatures: 0, prFixes: 0 };
  const nextHasFeatures = merged.added > 0 || merged.prFeatures > 0 || next.some(({ item }) => isFeatureItem(item));
  const nextHasAnything = nextHasFeatures || merged.fixed > 0 || merged.changed > 0 || merged.prs > 0 || next.length > 0;
  // A project with no shipped version yet starts at 0.1.0 rather than shipping "0.0.0".
  const unversioned = !(releasesData?.shipped?.length);
  const nextVersion = nextHasAnything || unversioned ? bump(base, nextHasFeatures || unversioned ? "minor" : "patch") : base;
  const nnHasFeatures = nextNext.some(({ item }) => isFeatureItem(item));
  const nextNextVersion = nextNext.length ? bump(nextVersion, nnHasFeatures ? "minor" : "patch") : bump(nextVersion, "minor");
  const slots = releasesData?.slots ?? {};
  return {
    base,
    next: { key: "next", label: slots.next?.name ?? `v${nextVersion}`, computed: `v${nextVersion}`, deploy: slots.next?.deploy, items: next, merged },
    nextNext: { key: "next+1", label: slots["next+1"]?.name ?? `v${nextNextVersion}`, computed: `v${nextNextVersion}`, deploy: slots["next+1"]?.deploy, items: nextNext },
  };
};

const setItemRelease = (tracker, item, slotKey) => {
  const slot = slotKey ? (slotKey === "next" ? planningSlots(lastTrackers).next : planningSlots(lastTrackers).nextNext).label : "";
  return editWithUndo(tracker.index, item, withField(item.body, "release", slotKey), slot ? `plan ${short(item.title)} for ${slot}` : `take ${short(item.title)} out of its release`, slot ? `${short(item.title)} is planned for ${slot}.` : `${short(item.title)} is out of its release.`);
};

/** A slot card accepts a card dragged from the board (dragging) or from the calendar (calDrag). */
const acceptsAnyItemDrag = () => (calDrag && calDrag.type === "item") || dragging;
const draggedItem = () => (calDrag && calDrag.type === "item" ? { tracker: calDrag.tracker, item: calDrag.item } : dragging ? { tracker: lastTrackers[dragging.trackerIndex], item: dragging.item } : null);


const stat = (n, one, many = `${one}s`) => el("span", { class: "stat" }, el("b", {}, String(n)), n === 1 ? one : many);

const openReleaseDrawer = (release, kind, planned, live = false) => {
  const list = el("div", { class: "release-list" });
  if (release && !planned) {
    const c = release.counts;
    list.append(el("div", { class: "release-summary" },
      live ? el("span", { class: "badge live" }, "live in production") : el("span", { class: "badge released" }, "released"),
      el("span", { class: "mono small muted" }, `${release.date ? fmtDate(release.date) : "undated"} · ${c.added} added · ${c.changed} changed · ${c.fixed} fixed${c.removed ? ` · ${c.removed} removed` : ""} · ${c.prs} PRs`)));
  }
  if (planned) {
    const dateInput = el("input", { type: "date", value: planned.group.due ?? "", "aria-label": "deploy date" });
    list.append(
      el("div", { class: "due-row" }, el("span", { class: "k" }, "deploy date"), dateInput,
        btn("set", async () => { releasesData = null; if (await write(`set the deploy date of ${stripDeploy(planned.group.name)}`, dateInput.value ? `${stripDeploy(planned.group.name)} deploys ${fmtDate(dateInput.value)}.` : `${stripDeploy(planned.group.name)} has no deploy date.`, () => setDeployDate(planned.tracker, planned.section, planned.group, dateInput.value))) closeDrawer(); }, "primary")),
      el("h3", {}, `${planned.items.length} planned items (drag more in from the Roadmap on the board)`),
    );
    const ul = el("ul");
    for (const i of planned.items) ul.append(el("li", { onclick: () => openDrawer(planned.tracker.index, i) }, i.title));
    list.append(ul);
  } else {
    list.append(el("h3", {}, "Changelog"));
    for (const kindName of ["Added", "Changed", "Fixed", "Removed"]) {
      const bullets = release.bullets.filter((b) => b.kind === kindName);
      if (!bullets.length) continue;
      list.append(el("h4", {}, `${kindName} (${bullets.length})`));
      const ul = el("ul");
      for (const b of bullets) {
        const li = el("li");
        li.innerHTML = renderInline(b.text) + (b.key ? ` <span class="key">${escapeHtml(b.key)}</span>` : "");
        ul.append(li);
      }
      list.append(ul);
    }
    if (!release.bullets.length) list.append(el("div", { class: "muted small" }, "no changelog entries for this version"));
    if (release.prs.length) {
      list.append(el("h3", {}, `${release.prs.length} pull requests merged`));
      const ul = el("ul");
      for (const pr of release.prs) ul.append(el("li", {}, el("span", { class: `kind ${pr.kind}` }, pr.kind), el("a", { href: pr.url, target: "_blank" }, `${pr.repo}#${pr.number}`), text(` ${pr.title}`), el("span", { class: "when" }, fmtDate(pr.mergedAt, true))));
      list.append(ul);
    }
  }
  const head = kind === "next" ? "Next release (unreleased)" : planned ? `${planned.name} · planned` : `v${release.version}${live ? " · live in production" : " · released"}`;
  if (release?.compare?.length) {
    list.prepend(el("div", { class: "compare-links" }, ...release.compare.map((c) => el("a", { href: c.url, target: "_blank" }, `${c.repo} on GitHub ↗`))));
  }
  showDrawer({ title: head, body: el("div", { class: "drawer-body" }, list) });
};

const releaseCard = (release, kind, live = false) => {
  const c = release.counts;
  return el(
    "div",
    { class: `release-card ${kind}${live ? " live" : ""}`, tabindex: "0", role: "button", onkeydown: (ev) => { if (ev.key === "Enter") ev.currentTarget.click(); }, onclick: () => { history.replaceState(null, "", `#release-${release.version}`); openReleaseDrawer(release, kind, null, live); } },
    el("div", { class: "release-card-head" },
      el("span", { class: "version" }, `v${release.version}`),
      live ? el("span", { class: "badge live" }, "live in production") : el("span", { class: "badge released" }, "released")),
    el("div", { class: "release-date" }, release.date ? `released ${fmtDate(release.date)}` : "release date unknown"),
    el("p", { class: "stats" }, stat(c.added, "feature"), stat(c.fixed, "fix", "fixes"), stat(c.changed, "change"), stat(c.prs, "PR")),
    el("div", { class: "cta-slot" }, el("span", { class: "muted small" }, "click for the changelog and PRs")),
  );
};

const slotCard = (slot, trackers) => {
  const featureCount = (slot.merged?.added ?? 0) + slot.items.filter(({ item }) => isFeatureItem(item)).length;
  const fixCount = (slot.merged?.fixed ?? 0) + slot.items.filter(({ item }) => isBugItem(item)).length;
  const card = el(
    "div",
    { class: `release-card slot ${slot.key === "next" ? "next" : "next-next"}`, tabindex: "0", role: "button", onkeydown: (ev) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) ev.currentTarget.click(); }, onclick: () => { history.replaceState(null, "", `#release-${slot.key}`); openSlotDrawer(slot, trackers); } },
    el("div", { class: "release-card-head" }, el("span", { class: "version" }, slot.label), el("span", { class: "badge planned" }, slot.key === "next" ? "next release" : "the one after")),
    el("div", { class: "release-date" }, slot.deploy ? `deploy ${fmtDate(slot.deploy)}` : "no deploy date yet", slot.label !== slot.computed ? el("span", { class: "muted" }, ` · computed ${slot.computed}`) : null),
    el("p", { class: "stats" }, stat(featureCount, "feature"), stat(fixCount, "fix", "fixes"), stat(slot.items.length, "planned", "planned"), slot.key === "next" ? stat(slot.merged.prs, `merged since ${releasesData?.shipped[0]?.version ?? "the last tag"}`, `merged since ${releasesData?.shipped[0]?.version ?? "the last tag"}`) : null),
  );
  const existing = slot.key === "next" ? shipFor(slot.label.replace(/^v/, "")) : null;
  const label = existing ? (existing.finished ? "shipped" : `continue shipping · ${shipProgress(existing).done}/${shipProgress(existing).total}`) : `ship ${slot.label}`;
  card.append(el("div", { class: "cta-slot" },
    slot.key === "next" ? btn(label, (e) => { e.stopPropagation(); startTheShip(slot.label.replace(/^v/, "")); }, "primary") : el("span", { class: "muted small" }, "drop cards here to plan")));
  card.addEventListener("dragover", (e) => { if (!acceptsAnyItemDrag()) return; e.preventDefault(); card.classList.add("over"); });
  card.addEventListener("dragleave", () => card.classList.remove("over"));
  card.addEventListener("drop", async (e) => {
    e.preventDefault();
    card.classList.remove("over");
    const d = draggedItem();
    calDrag = null;
    dragging = null;
    if (d && (await setItemRelease(d.tracker, d.item, slot.key))) flares(card);
  });
  return card;
};

const openSlotDrawer = (slot, trackers) => {
  const list = el("div", { class: "release-list" });
  const nameInput = el("input", { type: "text", value: slot.label, placeholder: slot.computed, "aria-label": "version", style: "width: 120px" });
  const dateInput = el("input", { type: "date", value: slot.deploy ?? "", "aria-label": "deploy date" });
  const save = async () => {
    const name = nameInput.value.trim() === slot.computed ? "" : nameInput.value.trim();
    releasesData = null;
    if (await write(`save ${slot.label}`, `Saved ${name || slot.computed}${dateInput.value ? `, deploying ${fmtDate(dateInput.value)}` : ""}.`, () => post("/api/release-slots", { project: projectId, slot: slot.key, name, deploy: dateInput.value }))) closeDrawer();
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
    planned.append(el("li", {}, el("span", { class: `kind ${isBugItem(item) ? "fix" : isFeatureItem(item) ? "feature" : "other"}` }, isBugItem(item) ? "fix" : isFeatureItem(item) ? "feature" : "item"), el("a", { href: "#", onclick: (e) => { e.preventDefault(); openDrawer(tracker.index, item); } }, item.title), btn("remove", async (e) => { e.stopPropagation(); if (await setItemRelease(tracker, item, "")) closeDrawer(); }, "ghost")));
  }
  if (!slot.items.length) planned.append(el("li", { class: "muted" }, "none yet: drag a card onto this release, or pick it in the card's drawer"));
  list.append(planned);
  if (slot.key === "next" && releasesData?.next) {
    const r = releasesData.next;
    if (r.prs.length) {
      list.append(el("h3", {}, `${r.prs.length} pull requests already merged`));
      const ul = el("ul");
      for (const pr of r.prs) ul.append(el("li", {}, el("span", { class: `kind ${pr.kind}` }, pr.kind), el("a", { href: pr.url, target: "_blank" }, `${pr.repo}#${pr.number}`), text(` ${pr.title}`), el("span", { class: "when" }, fmtDate(pr.mergedAt, true))));
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
  showDrawer({ title: `${slot.label} · ${slot.key === "next" ? "next release" : "the one after"}`, body: el("div", { class: "drawer-body" }, list) });
};

/** Every fold on the board: the drawn chevron, down when open and turned a quarter when closed. */
const foldButton = (open, what, onclick) => {
  const b = el("button", { type: "button", class: "ghost icon-btn fold", onclick }, icon("chevron"));
  setFold(b, open, what);
  return b;
};
const setFold = (b, open, what) => {
  b.setAttribute("aria-expanded", String(open));
  b.setAttribute("aria-label", `${open ? "hide" : "show"} ${what.toLowerCase()}`);
  b.title = `${open ? "hide" : "show"} ${what.toLowerCase()}`;
};

/** The releases strip with a fold, remembered like the sessions rail. */
const releasesSection = (trackers) => {
  let collapsed = false;
  try { collapsed = localStorage.getItem("console.releases") === "collapsed"; } catch {}
  const section = el("section", { class: `board-releases${collapsed ? " collapsed" : ""}` });
  const fold = foldButton(!collapsed, "releases", () => {
    collapsed = !collapsed;
    section.classList.toggle("collapsed", collapsed);
    setFold(fold, !collapsed, "releases");
    try { localStorage.setItem("console.releases", collapsed ? "collapsed" : "open"); } catch {}
  });
  section.append(el("h3", { class: "strip-title releases-fold" }, fold, text("Releases")), renderReleases(trackers));
  return section;
};

const renderReleases = (trackers) => {
  // Future on the left, past on the right: the one after, next, then released versions newest first; the newest released one is live.
  const strip = el("div", { class: "releases" });
  const slots = planningSlots(trackers);
  strip.append(slotCard(slots.nextNext, trackers), slotCard(slots.next, trackers));
  (releasesData?.shipped ?? []).forEach((r, i) => strip.append(releaseCard(r, "shipped", i === 0)));
  return strip;
};

/* ---------- ship days ---------- */

/** "shipped" | "now" (today) | "missed" (past and unmarked) | "" for a future one. */
const shipDayState = (occ) => {
  const t = today();
  return occ.shipped ? "shipped" : occ.date === t ? "now" : occ.date < t ? "missed" : "";
};

const cadenceWords = (c) => {
  if (!c) return "no cadence";
  const weekday = new Date(`${c.anchor}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
  return c.everyWeeks === 1 ? `every ${weekday}` : `every ${c.everyWeeks} weeks on ${weekday}`;
};

const SHIP_DAY_WORDS = {
  move: (date, o) => [`move the ship day to ${fmtDate(o.to, true)}`, `The ship day of ${fmtDate(date, true)} is now ${fmtDate(o.to, true)}.`],
  ship: (date, o) => [`mark ${fmtDate(date, true)} shipped`, `${fmtDate(date, true)} is marked shipped${o.version ? ` as v${o.version}` : ""}.`],
  unship: (date) => [`unmark ${fmtDate(date, true)}`, `${fmtDate(date, true)} is no longer marked shipped.`],
  remove: (date) => [`cancel the ship day on ${fmtDate(date, true)}`, `The ship day on ${fmtDate(date, true)} is cancelled.`],
  add: (date) => [`add a ship day on ${fmtDate(date, true)}`, `${fmtDate(date, true)} is a ship day.`],
};
/** Resolves true when the day changed, so the drawer that asked closes only then. */
const setShipDay = (action, date, opts = {}) => write(...SHIP_DAY_WORDS[action](date, opts), () => post("/api/ship-schedule/day", { project: projectId, action, date, ...opts }));
const closeIf = (ok) => { if (ok) closeDrawer(); };

/** The version the next ship would carry, bare (no leading v), for the wizard and the record. */
const nextVersionBare = (trackers) => planningSlots(trackers).next.label.replace(/^v/, "");

const startTheShip = (version) => {
  flyby();
  window.setTimeout(() => { location.href = `/ship.html?project=${encodeURIComponent(projectId)}&version=${encodeURIComponent(version)}`; }, 350);
};

const openShipDayDrawer = (occ, trackers) => {
  const version = nextVersionBare(trackers);
  const list = el("div", { class: "release-list" });
  const state = shipDayState(occ);
  if (occ.shipped) {
    list.append(el("div", { class: "due-row" },
      el("span", { class: "badge released" }, "shipped"),
      el("span", { class: "muted small mono" }, `${occ.shipped.version ? `v${occ.shipped.version} · ` : ""}marked ${fmtDate(occ.shipped.at.slice(0, 10))}`),
      btn("undo", () => setShipDay("unship", occ.origin).then(closeIf), "ghost")));
  } else {
    list.append(el("div", { class: "due-row" },
      el("span", { class: "k" }, "this day"),
      btn(`start the ship (v${version})`, () => startTheShip(version), "primary"),
      btn("mark shipped", () => setShipDay("ship", occ.origin, { version }).then(closeIf))));
  }
  if (occ.movedFrom) {
    list.append(el("p", { class: "muted small" },
      occ.date > occ.movedFrom ? `Pushed back from ${fmtDate(occ.movedFrom)}.` : `Pulled forward from ${fmtDate(occ.movedFrom)}.`,
      " ", btn("put it back", () => setShipDay("move", occ.origin, { to: occ.origin }).then(closeIf), "ghost")));
  }
  const moveTo = el("input", { type: "date", value: occ.date, "aria-label": "move the ship day to" });
  list.append(el("div", { class: "due-row" },
    el("span", { class: "k" }, "move it"),
    moveTo,
    btn("move", () => { if (moveTo.value) setShipDay("move", occ.origin, { to: moveTo.value }).then(closeIf); })));
  list.append(el("div", { class: "due-row" },
    el("span", { class: "k" }, occ.source === "cadence" ? cadenceWords(shipDays?.schedule?.cadence) : "one-off"),
    btn("cancel this ship day", async () => {
      if (await ask({ title: `Cancel the ship day on ${fmtDate(occ.date)}?`, body: occ.source === "cadence" ? "The cadence keeps running; only this one comes off the calendar." : "This one-off ship day is removed.", confirm: "cancel it", danger: true })) {
        closeIf(await setShipDay("remove", occ.origin));
      }
    }, "ghost danger")));
  showDrawer({ title: `Ship day · ${fmtDate(occ.date)}`, head: state ? [el("span", { class: `chip ship ${state}` }, state === "now" ? "today" : state)] : [], body: el("div", { class: "drawer-body" }, list) });
};

/**
 * The notification: today is ship day, or the last one went by unmarked. Shown above whichever
 * view is on, because the point is that it finds you. Nothing older than a month is raised; the
 * banner is a nudge, not a ledger.
 */
const shipDayBanner = (trackers) => {
  const occ = shipDays?.occurrences ?? [];
  const t = today();
  const now = occ.find((o) => o.date === t && !o.shipped);
  const missed = occ.findLast((o) => o.date < t && !o.shipped && (Date.parse(t) - Date.parse(o.date)) / 86400000 <= 30);
  const live = now ?? missed;
  if (!live) return [];
  const version = nextVersionBare(trackers);
  return [el("div", { class: `ship-banner${now ? "" : " missed"}` },
    el("span", { class: "ship-banner-mark" }, now ? "🛫" : "⚠"),
    el("strong", {}, now ? "Ship day." : `Ship day was ${fmtDate(live.date)}.`),
    el("span", { class: "muted" }, now ? `Planned for v${version}.` : "It went by without being marked."),
    el("span", { class: "spacer" }),
    btn(`start the ship (v${version})`, () => startTheShip(version), "primary"),
    btn("mark shipped", () => setShipDay("ship", live.origin, { version })),
    btn("push it back", () => openShipDayDrawer(live, trackers), "ghost"),
  )];
};

/** The cadence control, under the calendar head: how often this project means to ship. */
const shipCadenceRow = () => {
  const cadence = shipDays?.schedule?.cadence ?? null;
  const every = el("select", { class: "cadence-every", "aria-label": "how often to ship" },
    el("option", { value: "0" }, "no cadence"),
    ...[1, 2, 3, 4, 6].map((n) => el("option", { value: String(n) }, n === 1 ? "every week" : `every ${n} weeks`)));
  every.value = cadence ? String(cadence.everyWeeks) : "0";
  const anchor = el("input", { type: "date", value: cadence?.anchor ?? today(), "aria-label": "first ship day", title: "the first ship day; its weekday is the cadence's weekday" });
  const apply = () => {
    const weeks = Number(every.value);
    const cadence = weeks ? { everyWeeks: weeks, anchor: anchor.value } : null;
    return write(cadence ? `set ship days to ${cadenceWords(cadence)}` : "clear the ship cadence", cadence ? `Ship days are ${cadenceWords(cadence)}.` : "The ship cadence is cleared.", () => post("/api/ship-schedule", { project: projectId, cadence }));
  };
  every.addEventListener("change", apply);
  anchor.addEventListener("change", () => { if (Number(every.value)) apply(); });
  const oneOff = el("input", { type: "date", "aria-label": "one-off ship day", title: "a ship day on its own, outside the cadence" });
  const next = (shipDays?.occurrences ?? []).find((o) => o.date >= today());
  return el("div", { class: "cal-ships" },
    el("span", { class: "k" }, "Ship days"),
    every,
    el("span", { class: "muted small" }, "from"),
    anchor,
    next ? el("span", { class: "muted small mono" }, `next ${fmtDate(next.date, true)}`) : el("span", { class: "muted small" }, "none scheduled"),
    el("span", { class: "spacer" }),
    oneOff,
    btn("add a one-off", () => { if (oneOff.value) setShipDay("add", oneOff.value); }, "ghost"),
  );
};

const renderCalendar = (trackers) => {
  const [y, m] = calendarMonth.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const events = eventsFor(trackers);
  const shipByDate = new Map();
  for (const o of shipDays?.occurrences ?? []) {
    if (!shipByDate.has(o.date)) shipByDate.set(o.date, []);
    shipByDate.get(o.date).push(o);
  }
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
  const monthName = (delta) => new Date(Date.UTC(y, m - 1 + delta, 1)).toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const head = el(
    "div",
    { class: "cal-head" },
    el("button", { type: "button", class: "ghost icon-btn month-prev", "aria-label": `previous month, ${monthName(-1)}`, title: monthName(-1), onclick: () => shift(-1) }, icon("chevron")),
    el("h2", {}, monthName(0)),
    el("button", { type: "button", class: "ghost icon-btn month-next", "aria-label": `next month, ${monthName(1)}`, title: monthName(1), onclick: () => shift(1) }, icon("chevron")),
    btn("today", () => { calendarMonth = today().slice(0, 7); loadBoard(); }, "ghost"),
    el("span", { class: "spacer" }),
    el("span", { class: "muted small mono" }, "drag an item onto a day to set its deadline, or a ship day to move it"),
  );
  const grid = el("div", { class: "cal-grid" });
  for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid.append(el("div", { class: "cal-dow" }, d));
  for (let i = 0; i < lead; i += 1) grid.append(el("div", { class: "cal-cell pad" }));
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
    const cell = el("div", { class: `cal-cell${date === today() ? " today" : ""}` }, el("div", { class: "cal-day" }, el("span", { class: "cal-wd" }, `${weekday} `), String(day)));
    for (const occ of shipByDate.get(date) ?? []) {
      const state = shipDayState(occ);
      const label = occ.shipped ? `shipped${occ.shipped.version ? ` v${occ.shipped.version}` : ""}` : "ship day";
      const words = [state === "missed" ? "went by unmarked" : state === "now" ? "today" : "", occ.movedFrom ? `moved from ${fmtDate(occ.movedFrom)}` : ""].filter(Boolean).join(", ");
      cell.append(draggableShip(calEvent(`ship ${state}`, label, words, () => openShipDayDrawer(occ, trackers)), occ));
    }
    for (const e of byDate.get(date) ?? []) {
      const state = eventState(e);
      const node = e.kind === "release"
        ? calEvent("release", `${e.title} deploys`, "", () => openSlotDrawer(e.slot, trackers))
        : calEvent(`item ${state}`, e.title, EVENT_WORDS[state], () => openDrawer(e.tracker.index, e.item));
      if (EVENT_ICONS[state]) node.prepend(icon(EVENT_ICONS[state]));
      if (e.item && !e.item.checked) draggableItem(node, e.tracker, e.item, e.section);
      cell.append(node);
    }
    dropZone(
      cell,
      (d) => (d.type === "item" ? d.item.fields.due !== date : d.type === "ship" ? d.occ.date !== date : false),
      (d) => (d.type === "ship"
        ? setShipDay("move", d.occ.origin, { to: date })
        : setDue(d.tracker, d.item, date)),
    );
    grid.append(cell);
  }
  const undated = trackers.flatMap((t) => t.sections.filter((s) => s.column === "priority").flatMap((s) => s.groups.flatMap((g) => g.items.filter((i) => !i.checked && !i.fields.due && isDevItem(i)).map((i) => ({ t, i, s })))));
  const side = el("div", { class: "cal-undated" }, el("h3", {}, `Roadmap items without a deadline (${undated.length})`), el("div", { class: "muted small" }, "drop a dated item here to clear its deadline"));
  dropZone(side, (d) => d.type === "item" && Boolean(d.item.fields.due), (d) => setDue(d.tracker, d.item, ""));
  for (const { t, i, s } of undated.slice(0, 60)) side.append(draggableItem(calEvent("item undated", i.title, "", () => openDrawer(t.index, i)), t, i, s));
  const key = (cls, words, iconName) => el("span", { class: `cal-key ${cls}` }, iconName ? icon(iconName) : null, words);
  return el(
    "section",
    { class: "calendar" },
    releasesSection(trackers),
    shipCadenceRow(),
    head,
    el("div", { class: "cal-legend" }, key("item done", "done", "decision"), key("item overdue", "overdue", "finding"), key("item soon", "due within a week"), key("item", "due later"), key("release", "a release deploys"), key("ship", "ship day")),
    grid,
    side,
  );
};


const openFindingsDrawer = (child, v) => {
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
  showDrawer({
    title: `Audit: ${child.loop}`,
    meta: el("div", { class: "drawer-meta" }, el("span", { class: `verdict ${v.verdict}` }, v.verdict), v.decision ? el("span", { class: "muted mono" }, v.decision) : null, el("span", { class: "spacer" }), el("span", { class: "muted mono" }, child.audit?.file ?? "")),
    body: el("div", { class: "drawer-body" }, body),
    foot: [btn("accept findings", () => decide("accepted"), "primary"), btn("reject findings", () => decide("rejected"), "danger")],
  });
};



/* ---------- live view of a background session, rendered inside the wizard ---------- */

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

/** Find the console terminal attached to a background session, or attach one quietly (not in the dock). */
const terminalFor = async (claudeId, title) => {
  const open = await api("/api/terminals");
  const existing = open.find((t) => t.exitCode === null && t.agentId === claudeId);
  if (existing) return existing;
  return post("/api/terminals", { project: projectId, kind: "attach", id: claudeId, title, cols: 110, rows: 32 });
};

const tailInto = async (node, claudeId, title) => {
  if (tails.has(claudeId)) return;
  // A live stream keeps a headless capture from ever settling, so screenshots opt out.
  if (new URLSearchParams(location.search).has("nolive")) {
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
    node.textContent = lines.slice(-16).join("\n") || "(no output yet)";
  };
  const timer = window.setInterval(paint, 1200);
  tails.set(claudeId, { source, term, host, timer, info });
  paint();
};

/* ---------- ship wizard ---------- */

let ships = [];
const jetGlyph = () => jetSvg("jet-glyph");

const shipFor = (version) => ships.find((sh) => sh.version === version);
const shipProgress = (ship) => {
  const done = ship.steps.filter((st) => st.status === "done" || st.status === "skipped").length;
  return { done, total: ship.steps.length };
};

const openShipWizard = async (version) => {
  const bare = version.replace(/^v/, "");
  let ship = await api(`/api/ships/${encodeURIComponent(bare)}?project=${encodeURIComponent(projectId)}`);
  if (!ship) ship = await post("/api/ships", { project: projectId, version: bare });
  history.replaceState(null, "", `#ship-${bare}`);
  const list = el("div", { class: "ship-steps" });

  const refresh = async () => {
    const before = ship.steps.map((st) => st.status).join();
    ship = await api(`/api/ships/${encodeURIComponent(bare)}?project=${encodeURIComponent(projectId)}`);
    render();
    ships = await api(`/api/ships?project=${encodeURIComponent(projectId)}`);
    if (before !== ship.steps.map((st) => st.status).join()) {
      const runwayNode = list.querySelector(".runway");
      if (runwayNode) flares(runwayNode);
      loadBoard();
    }
  };
  const stepCall = async (step, action, body) => {
    if (action === "run") flyby();
    try {
      await post(`/api/ships/${encodeURIComponent(bare)}/steps/${encodeURIComponent(step.id)}${action ? `/${action}` : ""}?project=${encodeURIComponent(projectId)}`, body);
      await refresh();
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  let agentStates = new Map();
  const pollStates = async () => {
    try {
      const live = await api(`/api/live?project=${encodeURIComponent(projectId)}&refresh`);
      agentStates = new Map(live.backgroundAgents.map((a) => [a.id, a.state ?? ""]));
      for (const [id, state] of agentStates) {
        const flag = list.querySelector(`[data-agent="${id}"] .agent-state`);
        if (flag) {
          flag.textContent = state === "blocked" ? "waiting for your input: open the session" : state === "working" ? "working" : state;
          flag.className = `agent-state ${state}`;
        }
      }
    } catch {
      /* the rail poll is best effort */
    }
  };

  const render = () => {
    const { done, total } = shipProgress(ship);
    const pct = (done / total) * 100;
    const runway = el("div", { class: "ship-progress" },
      el("div", { class: "runway", style: `--p:${pct}` }, el("div", { class: "fill" }), el("div", { class: "jet-marker" }, jetGlyph())),
      el("span", { class: "mono small muted" }, `${done} of ${total} steps${ship.finished ? ` · shipped ${fmtDate(ship.finished)}` : ""}`));
    list.replaceChildren(runway);
    const current = ship.steps.find((st) => st.status !== "done" && st.status !== "skipped");
    for (const step of ship.steps) {
      const notes = el("textarea", { class: "ship-notes", placeholder: "notes for this step (saved as you leave the field)", rows: "2" });
      notes.value = step.notes ?? "";
      notes.addEventListener("change", () => stepCall(step, "", { notes: notes.value }));
      const live = step.status === "running" && step.claudeId ? el("pre", { class: "ship-live" }, "connecting to the session…") : null;
      const row = el(
        "div",
        { class: `ship-step ${step.status}${step === current ? " current" : ""}`, "data-agent": step.claudeId ?? "" },
        el("div", { class: "ship-step-head" },
          el("span", { class: `lamp ${step.status === "running" ? "busy" : ""}` }),
          el("span", { class: "ship-step-title" }, step.title),
          el("span", { class: `verdict ${step.status}` }, step.status === "done" && step.id === "audits" && /No un-audited/.test(step.report ?? "") ? "done · nothing to audit" : step.status),
          step.status === "running" ? el("span", { class: `agent-state ${agentStates.get(step.claudeId) ?? ""}` }, agentStates.get(step.claudeId) ?? "starting") : null,
          el("span", { class: "spacer" }),
          el("span", { class: "actions" },
            step.status === "pending" || step.status === "failed" ? btn(step.id === "audits" ? "run audits" : "run", () => stepCall(step, "run"), "primary") : null,
            step.claudeId ? btn("open session", async () => {
              await terminalFor(step.claudeId, `ship ${bare}: ${step.title}`);
              stopTails();
              closeDrawer();
              setStatus(`ship ${bare}: ${step.title} is attached. Find it in the workspace.`);
            }) : null,
            step.status !== "done" && step.status !== "skipped" && step.status !== "pending" ? btn("mark done", () => stepCall(step, "", { status: "done" })) : null,
            step.status === "pending" ? btn("skip", () => stepCall(step, "", { status: "skipped" }), "ghost") : null,
            step.status === "done" || step.status === "skipped" ? btn("reopen", () => stepCall(step, "", { status: "pending" }), "ghost") : null,
          ),
        ),
        step.ended ? el("div", { class: "ship-when muted small mono" }, `${step.status} ${new Date(step.ended).toLocaleTimeString()}${step.started ? ` · started ${new Date(step.started).toLocaleTimeString()}` : ""}`) : step.started ? el("div", { class: "ship-when muted small mono" }, `started ${new Date(step.started).toLocaleTimeString()}`) : null,
        step.report ? el("div", { class: "ship-report" }, el("span", { class: "k" }, "result"), text(step.report)) : null,
        live,
        step.artifacts?.length ? el("div", { class: "ship-artifacts" }, ...step.artifacts.map((a) => el("a", { href: fileHref(a), target: "_blank" }, `${a} ↗`))) : null,
        notes,
      );
      list.append(row);
      if (live) tailInto(live, step.claudeId, `ship ${bare}: ${step.title}`).catch((err) => { live.textContent = err.message; });
    }
    pollStates();
  };

  showDrawer({ title: `Ship v${bare}`, head: [el("span", { class: "muted mono small" }, `started ${fmtDate(ship.started)} · progress is saved; close and come back any time`)], body: el("div", { class: "drawer-body" }, list), foot: [btn("refresh", refresh, "ghost")], wide: true });
  render();
  ships = await api(`/api/ships?project=${encodeURIComponent(projectId)}`);
  const poll = window.setInterval(() => { if (!document.contains(list)) { window.clearInterval(poll); stopTails(); return; } if (ship.steps.some((st) => st.status === "running")) refresh(); }, 8000);
  // the jet flies in and becomes the progress runway
  flyby({ y: 60, duration: 900 });
};


/* ---------- workspace: the command center, with the usage widget in its corner ---------- */

let commandCenter = null;

const renderWorkspace = async () => {
  commandCenter?.stop();
  const wrap = el("section", { class: "workspace" });
  const usageRoot = el("div", { class: "cu-root" });
  // The project filter is rendered into the page head by the command center, so the head is
  // one row: title, what you are looking at, then the instruments.
  const filterRoot = el("div", { class: "ws-filter" });
  wrap.append(
    el("div", { class: "ws-head" },
      el("h1", { class: "ws-title" }, "Command center"),
      filterRoot,
      el("span", { class: "ws-gap" }),
      el("div", { class: "ws-tools" },
        usageRoot,
        el("button", { type: "button", class: "ghost icon-btn", "aria-label": "refresh sessions", title: "refresh sessions", onclick: () => commandCenter?.refresh() }, icon("refresh")),
      ),
    ),
  );
  const center = el("div", { class: "cc" });
  wrap.append(center);
  claudeUsage.mount(usageRoot, { api, post });
  commandCenter = mountCommandCenter(center, { el, text, api, post, ask, askClose, askEnd, loading, openTerminal, createTerminal, sendInput, acceptDrops, setStatus, projectId, project, filterRoot });
  return wrap;
};

/* ---------- sessions ---------- */

const sessionRow = (cls, name, sub, actions, lampTitle) =>
  el(
    "li",
    { class: `row ${cls}` },
    lamp(cls, /^(idle|shell)$/.test(cls) ? "" : undefined),
    el("span", { class: "name", title: [].concat(name).map((n) => (typeof n === "string" ? n : n.textContent ?? "")).join("") }, ...[].concat(name)),
    el("span", { class: "actions" }, ...actions),
    sub ? el("span", { class: "sub" }, sub) : null,
  );

const btn = (label, onclick, cls = "") => el("button", { type: "button", class: cls, onclick }, label);

let lastSessions = null;

/**
 * What the rail says at a glance, in the shapes the workspace already uses: how many want you,
 * how many are running, how many are parked. Survives the rail being collapsed to a strip.
 */
const railTally = (live) => {
  const all = live.claudeSessions ?? [];
  const count = (test) => all.filter((s) => test(s.status ?? "")).length;
  const groups = [
    ["waiting", count((st) => /^(waiting|blocked)$/.test(st)), "waiting on you"],
    ["busy", count((st) => /^(busy|running)$/.test(st)), "working"],
    ["idle", count((st) => /^(idle|shell)$/.test(st)), "parked"],
  ].filter(([, n]) => n > 0);
  if (!groups.length) return el("div", { class: "rail-tally empty" }, el("span", { class: "muted small" }, "idle"));
  return el("div", { class: "rail-tally" },
    ...groups.map(([status, n, what]) =>
      el("span", { class: "t", title: `${n} ${what}` }, lamp(status), el("b", {}, String(n)))));
};

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
        { class: `row session-live ${s.status ?? ""}` },
        lamp(s.status ?? "idle"),
        el("span", { class: "name", title: s.title ?? s.name ?? String(s.pid) }, s.title ?? s.name ?? String(s.pid)),
        el(
          "span",
          { class: "actions" },
          btn("open", () => openTerminal({ kind: "resume", sessionId: s.sessionId, title: s.title ?? s.name ?? s.sessionId.slice(0, 8) })),
          btn("close", async () => {
            if (!(await askClose(s))) return;
            try {
              await post(`/api/sessions/${s.pid}/close`);
              toast(`Closed "${s.title ?? s.name ?? s.pid}".`);
            } catch (err) {
              failed(`close "${s.title ?? s.name ?? s.pid}"`, err);
            }
            window.setTimeout(() => loadRail(true), 1500);
          }, "danger"),
        ),
        el("span", { class: "doing" }, el("span", { class: "k" }, s.status ?? "?"), text(s.waitingFor ? `${s.waitingFor} · ` : ""), el("span", { class: "age" }, `${age(s.updatedAt)}${s.elapsed ? ` · up ${s.elapsed}` : ""}${where ? ` · ${where}` : ""}`)),
        s.lastPrompt ? el("span", { class: "doing detail", title: s.lastPrompt }, el("span", { class: "k" }, "you"), text(s.lastPrompt)) : null,
        s.lastReply ? el("span", { class: "doing detail", title: s.lastReply }, el("span", { class: "k" }, "claude"), text(s.lastReply)) : null,
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
          btn(/^(done|exited|stopped|blocked)$/.test(a.state ?? "") ? "remove" : "stop", async () => {
            const finished = /^(done|exited|stopped|blocked)$/.test(a.state ?? "");
            if (!(await askEnd(finished, `background session ${a.id}`))) return;
            try {
              const r = await post(`/api/agents/${a.id}/${finished ? "remove" : "stop"}`);
              if (r.failed) failed(`${finished ? "remove" : "stop"} ${a.id}`, new Error(r.output));
              else toast(finished ? `Removed ${a.id}.` : `Stopped ${a.id}.`);
            } catch (err) {
              failed(`${finished ? "remove" : "stop"} ${a.id}`, err);
            }
            loadRail(true);
          }, "danger"),
        ],
      ),
    );
  }
  if (!running.childElementCount) running.append(el("li", { class: "empty" }, "No session is running here. New session starts one."));
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
    $("#tally").replaceChildren(railTally(live));
    $("#sessions").replaceChildren(renderSessions(sessions, live));
    $("#live").replaceChildren(renderLive(live));
  } catch (err) {
    setStatus(err.message, true);
  }
};

/* ---------- terminals ----------
   There is no dock any more. A terminal is created headlessly and surfaced inside the session's
   own full-screen view, which already knows how to carry one: a panel covering half the page
   over live content was the confusing part, not the terminal. */

const termSize = () => ({ cols: 120, rows: 34 });

/** A pty without a view: the command center's composer types into one of these. */
const createTerminal = (opts) => post("/api/terminals", { project: projectId, ...opts, ...termSize() });
const sendInput = (id, data) => fetch(`/api/terminals/${id}/input`, { method: "POST", body: data, keepalive: true });
/** A dropped file is saved under the console's home and its path is what gets typed. */
const uploadDrop = async (file) => {
  const res = await fetch(`/api/drop?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${res.status} uploading ${file.name}`);
  return body.path;
};
const quotePath = (p) => (/\s/.test(p) ? `"${p}"` : p);
const acceptDrops = (host, onPaths) => {
  host.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    host.classList.add("dropping");
  });
  host.addEventListener("dragleave", () => host.classList.remove("dropping"));
  host.addEventListener("drop", async (e) => {
    host.classList.remove("dropping");
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    try {
      const paths = [];
      for (const f of e.dataTransfer.files) paths.push(await uploadDrop(f));
      onPaths(paths.map(quotePath));
      setStatus(`${paths.length} file${paths.length === 1 ? "" : "s"} attached`);
    } catch (err) {
      setStatus(err.message, true);
    }
  });
};

/** Starting a session or a shell is an action: what it did is a toast, and a failure names it. */
const openTerminal = async (body) => {
  const { kind, title } = body;
  try {
    const info = await createTerminal(body);
    toast(`${info.title}: running. It appears in the rack as it registers.`);
    if (kind === "spawn") loadRail(true);
    commandCenter?.refresh();
    return info;
  } catch (err) {
    failed(`start ${title ?? kind}`, err);
  }
};

const itemRef = (trackerIndex, item) => ({ tracker: trackerIndex, itemStart: item.start, itemFirstLine: item.firstLine });

/** The CAG, in a terminal, planning one item: it interviews, writes the plan document, and sets the field. */
const planItem = (trackerIndex, item) => openTerminal({ kind: "cag", item: itemRef(trackerIndex, item), title: `plan: ${item.title.slice(0, 60)}` });

const spawnOnItem = async (trackerIndex, item, card, parent) => {
  // The server refuses an unplanned item too; this is the page offering the better verb first.
  if (!item.planned) {
    if (await ask({ title: "This item has no plan", body: `${item.title}\n\nNothing is spawned on an item without a plan: field naming a real file. The CAG can write one with you now.`, confirm: "plan it" })) planItem(trackerIndex, item);
    return;
  }
  if (!(await ask({ title: "Spawn a headless Claude session on this item?", body: `${item.title}\n\nIt starts in ${project.path} in auto permission mode and opens below.${parent ? " When it finishes, the auditor reviews it." : ""}`, confirm: "spawn" }))) return;
  if (card) missile(card);
  openTerminal({ kind: "spawn", item: itemRef(trackerIndex, item), title: item.title.slice(0, 80), parent });
};

/* ---------- theme: the project's colours and display font ---------- */

/** Whether Maverick wears the project's colours or its own. Cory's call, remembered. */
const usingProjectTheme = () => {
  try { return localStorage.getItem("mv.projectTheme") !== "0"; } catch { return true; }
};

/**
 * Clearing the inline overrides is what "the Maverick theme" means: the stylesheet's own
 * tokens take over, and they already flip with light and dark.
 */
const applyTheme = (theme) => {
  const root = document.documentElement.style;
  if (!theme || !usingProjectTheme()) {
    for (const prop of PROJECT_PROPS) root.removeProperty(prop);
    return;
  }
  applyProjectTheme(root, theme);
  if (theme.font !== "Chakra Petch" && !document.querySelector(`link[data-font="${theme.font}"]`)) {
    document.head.append(el("link", { rel: "stylesheet", "data-font": theme.font, href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font).replace(/%20/g, "+")}:wght@500;600;700&display=swap` }));
  }
  $("#brand-mark").replaceChildren(jetSvg("jet-glyph mark"));
};

/* ---------- boot ---------- */

const boot = async () => {
  void mountDevBadge();
  $("#brand-mark").replaceChildren(jetSvg("jet-glyph mark"));
  if (!projectId) {
    // The page is where you start: no project in the URL reopens the last one, unless the
    // picker was asked for by name.
    let last = null;
    try { last = localStorage.getItem("mv.project"); } catch {}
    if (last && !new URLSearchParams(location.search).has("pick")) return location.replace(`/?project=${encodeURIComponent(last)}`);
    return renderPicker();
  }
  setStatus("loading");
  $("#status").classList.add("loading");
  const projects = await api("/api/projects");
  project = projects.find((p) => p.id === projectId);
  if (!project) {
    try { if (localStorage.getItem("mv.project") === projectId) localStorage.removeItem("mv.project"); } catch {}
    setStatus(`no project "${projectId}"`, true);
    return renderPicker();
  }
  document.title = `${project.name} · Maverick`;
  try { localStorage.setItem("mv.project", projectId); } catch {}
  applyTheme(project.theme);

  // The project is identity, not a form field: a pill carrying its own accent, opening a list.
  const pick = $("#project-pick");
  let pickMenu = null;
  const closePick = () => { pickMenu?.remove(); pickMenu = null; };
  const pickBtn = el("button", { type: "button", class: "pick-btn", "aria-haspopup": "true",
    onclick: (e) => {
      // Hold the element, not the event: currentTarget is null once the handler returns, and
      // reading it from the outside-click listener threw, so the menu never closed.
      const anchor = e.currentTarget;
      if (pickMenu) return closePick();
      pickMenu = el("div", { class: "menu pick-menu", role: "dialog", "aria-label": "Projects" },
        el("h4", {}, "Projects"),
        ...projects.map((p) => el("a", { class: `pick-row${p.id === projectId ? " on" : ""}`, href: `/?project=${encodeURIComponent(p.id)}` },
          el("span", { class: "dot", style: `background:${p.theme?.accent ?? "var(--accent)"}` }),
          el("b", {}, p.name),
          el("i", {}, p.path.replace(/^\/Users\/[^/]+\//, "~/")))),
        el("a", { class: "pick-row all", href: "/?pick" }, el("span", { class: "dot none" }), el("b", {}, "All projects")));
      const r = anchor.getBoundingClientRect();
      pickMenu.style.top = `${r.bottom + 8}px`;
      pickMenu.style.left = `${r.left}px`;
      document.body.append(pickMenu);
      window.setTimeout(() => document.addEventListener("click", function once(ev) {
        if (!pickMenu) return document.removeEventListener("click", once);
        if (!pickMenu.contains(ev.target) && !anchor.contains(ev.target)) { closePick(); document.removeEventListener("click", once); }
      }), 0);
    } },
    el("span", { class: "dot", style: `background:${project.theme?.accent ?? "var(--accent)"}` }),
    el("b", {}, project.name),
    icon("chevron"));
  pick.replaceChildren(pickBtn, btn("change project", () => { location.href = "/?pick"; }, "ghost"));
  pick.hidden = false;
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closePick(); });

  // Views read as instruments: a drawn icon over its name, the live one lifted.
  const VIEWS = [["board", "Board"], ["calendar", "Calendar"], ["workspace", "Workspace"]];
  $("#view-toggle").replaceChildren(...VIEWS.map(([id, label]) =>
    el("button", { type: "button", "data-view": id, title: label }, icon(id), el("span", {}, label))));
  $("#view-toggle").hidden = false;
  for (const b of document.querySelectorAll("#view-toggle button")) {
    b.addEventListener("click", () => {
      view = b.dataset.view;
      try { localStorage.setItem("console.view", view); } catch {}
      loadBoard();
    });
  }


  $("#project").hidden = false;
  $("#reload").hidden = false;
  const ns = $("#new-session");
  ns.replaceChildren(icon("plus"), el("span", {}, "New session"));
  ns.hidden = false;
  // One menu for every preference, so the bar carries one control instead of three.
  const setMode = (m) => {
    if (m) document.documentElement.setAttribute("data-theme", m);
    else document.documentElement.removeAttribute("data-theme");
  };
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const recall = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  setMode(recall("mv.theme", ""));

  const option = (label, hint, on, onchange) => {
    const box = el("input", { type: "checkbox" });
    box.checked = on;
    box.addEventListener("change", () => onchange(box.checked));
    return el("label", { class: "opt" }, box, el("span", {}, el("b", {}, label), el("i", {}, hint)));
  };

  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; document.removeEventListener("keydown", onMenuKey, true); };
  function onMenuKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); } }
  const openMenu = (anchor) => {
    const mode = recall("mv.theme", "");
    const seg = el("div", { class: "seg" }, ...[["", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) =>
      el("button", { type: "button", class: v === mode ? "on" : "", onclick: (e) => {
        remember("mv.theme", v);
        setMode(v);
        for (const b of e.currentTarget.parentElement.children) b.classList.toggle("on", b === e.currentTarget);
      } }, l)));
    menu = el("div", { class: "menu", role: "dialog", "aria-label": "Settings" },
      el("h4", {}, "Appearance"), seg,
      option("The project's colours", project ? `${project.name}'s accent and display face` : "accent and display face", usingProjectTheme(), (on) => {
        remember("mv.projectTheme", on ? "1" : "0");
        applyTheme(project?.theme);
      }),
      );
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    document.body.append(menu);
    document.addEventListener("keydown", onMenuKey, true);
    window.setTimeout(() => document.addEventListener("click", function once(e) {
      if (menu && !menu.contains(e.target) && e.target !== anchor) { closeMenu(); document.removeEventListener("click", once); }
      else if (!menu) document.removeEventListener("click", once);
    }), 0);
  };
  const gear = el("button", { type: "button", class: "ghost icon-btn", "aria-label": "settings", title: "settings",
    onclick: (e) => (menu ? closeMenu() : openMenu(e.currentTarget)) }, icon("settings"));
  $("#reload").before(gear);

  const reload = $("#reload");
  reload.classList.add("ghost", "icon-btn");
  reload.setAttribute("aria-label", "refresh the board");
  reload.setAttribute("title", "refresh the board");
  reload.replaceChildren(icon("refresh"));
  reload.addEventListener("click", () => { loadBoard(); loadRail(true); });
  $("#refresh-live").addEventListener("click", () => loadRail(true));
  let railCollapsed = false;
  try { railCollapsed = localStorage.getItem("console.rail") === "collapsed"; } catch {}
  const applyRail = () => {
    $("#project").classList.toggle("rail-collapsed", railCollapsed);
    setFold($("#rail-fold"), !railCollapsed, "sessions");
  };
  $("#rail-fold").addEventListener("click", () => {
    railCollapsed = !railCollapsed;
    try { localStorage.setItem("console.rail", railCollapsed ? "collapsed" : "open"); } catch {}
    applyRail();
  });
  $("#rail-fold").replaceChildren(icon("chevron"));
  $("#rail-fold").classList.add("icon-btn");
  applyRail();
  // The jet flies when something has happened, so it follows the session starting, not the click.
  $("#new-session").addEventListener("click", async () => {
    if (await openTerminal({ kind: "new", title: `claude · ${project.name}` })) flyby();
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
      if (r) openReleaseDrawer(r, "shipped", null, releasesData.shipped[0] === r);
    }
  }
  const linkedShip = location.hash.match(/^#ship-(.+)$/);
  if (linkedShip) location.href = `/ship.html?project=${encodeURIComponent(projectId)}&version=${encodeURIComponent(decodeURIComponent(linkedShip[1]).replace(/^v/, ""))}`;
  const linked = location.hash.match(/^#L(\d+)$/);
  if (linked) {
    const line = Number(linked[1]) - 1;
    for (const tracker of lastTrackers) {
      const item = tracker.sections.flatMap((sec) => sec.groups.flatMap((g) => g.items)).find((i) => i.start === line);
      if (item) openDrawer(tracker.index, item);
    }
  }
};

boot().catch((err) => setStatus(err.message, true));
