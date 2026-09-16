// The command center: every Claude session on the machine as a panel, grouped by project and
// by the session watching it (an audit parent and its task sessions sit in one bracket).
// A panel opens full screen as a conversation: prompts and replies rendered from the
// transcript, tool calls folded into chips, live. The dock terminal stays one click away for
// typing into a session. Nothing here knows about tokens; usage is the provider widget's job.

import { render as renderMd } from "./markdown.js";
import { jetSvg } from "./jet.js";
import { lamp } from "./lamp.js";
import { icon } from "./icons.js";

const NEAR_BOTTOM = 80;
const rank = { waiting: 0, blocked: 0, busy: 1, running: 1, shell: 2, idle: 3, done: 4, exited: 5, stopped: 5 };
const HOUR = 3600000;
/**
 * A session that has ended. `blocked` is deliberately not here: it is running and stopped at a
 * prompt, which is the loudest thing on the page, not the quietest. Counting it as finished put
 * the same session in "Needs you" and in "Background · done" at once, because those two filters
 * run independently over one list, and painted a lock lamp on a strip marked finished.
 */
const finished = (s) => /^(done|exited|stopped)$/.test(s ?? "");
/**
 * The agent's own word about itself, which outranks the registry's read of its process: it has
 * ended, or it is stopped at a prompt. Neither is something a live pid can show.
 */
const trustAgent = (s) => finished(s) || s === "blocked";

const age = (ms) => {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const clip = (s, n) => {
  const flat = (s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
/** Markdown flattened to prose for a one-line excerpt: no fences, headings, emphasis, or link syntax. */
const plain = (md) =>
  (md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/\*\*([^*]+)(\*\*|$)/g, "$1")
    .replace(/[_*]([^_*\n]+)([_*]|$)/g, "$1")
    .replace(/[_*]+/g, "")
    .replace(/`([^`]*)(`|$)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "");
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/** One flat list of sessions from the three sources the server returns. */
const assemble = (all) => {
  const byClaudeId = new Map(all.records.filter((r) => r.claudeId).map((r) => [r.claudeId, r]));
  // A name Cory typed outranks every derived title: Claude Code's first-prompt guess, the
  // record's loop, the agent's own name. One precedence, applied on every path below.
  const named = (sessionId, ...fallbacks) => all.names?.[sessionId] ?? fallbacks.find((f) => f) ?? null;
  const bySessionId = new Map();
  const sessions = [];
  for (const s of all.interactive) {
    sessions.push({
      key: `pid:${s.pid}`, kind: "interactive", pid: s.pid, sessionId: s.sessionId, cwd: s.cwd, project: s.project,
      title: named(s.sessionId, s.title, s.name, `pid ${s.pid}`), status: s.status ?? "idle", waitingFor: s.waitingFor, app: s.terminalId ? "Maverick" : s.app, tty: s.tty,
      elapsed: s.elapsed, at: s.updatedAt ?? s.startedAt, lastPrompt: s.lastPrompt, lastReply: s.lastReply, terminalId: s.terminalId,
    });
  }
  for (const s of sessions) bySessionId.set(s.sessionId, s);
  for (const a of all.background) {
    const record = byClaudeId.get(a.id);
    // A background agent's process is also in the registry; one panel, with the agent's id for attach and stop.
    const twin = bySessionId.get(a.sessionId);
    const merged = {
      ...(twin ?? {}),
      key: `bg:${a.id}`, kind: "background", claudeId: a.id, sessionId: a.sessionId, cwd: a.cwd, project: a.project ?? twin?.project ?? record?.project,
      title: named(a.sessionId, record?.loop, twin?.title, a.name, a.id), status: trustAgent(a.state) ? a.state : twin?.status ?? a.state ?? "running", at: twin?.at ?? a.startedAt, record,
      lastPrompt: a.lastPrompt ?? twin?.lastPrompt, lastReply: a.lastReply ?? twin?.lastReply,
    };
    if (twin) sessions.splice(sessions.indexOf(twin), 1, merged);
    else sessions.push(merged);
    bySessionId.set(a.sessionId, merged);
  }
  // Records that are parents of others (audit parents, drivers) or children of a parent.
  const parents = new Map();
  for (const r of all.records) {
    if (r.parent) {
      if (!parents.has(r.parent)) parents.set(r.parent, []);
      parents.get(r.parent).push(r);
    }
  }
  for (const r of all.records) if (r.role === "audit" && !parents.has(r.id)) parents.set(r.id, []);
  return { sessions, parents, records: all.records, byClaudeId };
};

export const mountCommandCenter = (root, ctx) => {
  const { el, text, api, post, ask, askClose, askEnd, loading, openTerminal, createTerminal, sendInput, acceptDrops, setStatus } = ctx;
  const DAY = 86400000;
  let all = null;
  let model = null;
  let full = null; // { session, offset, events, timer, scroller, list }
  let timer = null;
  let editing = false; // a rename is open: the repaint would tear the input out mid-word
  let formations = [];
  let activeFormation = new URLSearchParams(location.search).get("formation");
  // A strip is the paper flight strip a controller picks up and moves to another rack. The tabs
  // are the racks, so drag and drop is one rule: a strip dropped on a tab flies there. Inside a
  // formation the lead slot and the flight are two more racks, which is promote and demote.
  let dragging = null; // { sessionId, from: formation id or null for the rack, title }

  /* ---------- panels ---------- */



  const roleChip = (record) => (record ? el("span", { class: "role" }, record.role) : null);

  const auditChip = (record) => {
    const v = record?.auditView;
    if (!v || v.verdict === "none") return null;
    return el("span", { class: `verdict ${v.verdict}${v.decision ? ` ${v.decision}` : ""}` }, v.verdict === "pending" ? `auditing (${v.agentState ?? "…"})` : `${v.verdict}${v.decision ? ` · ${v.decision}` : ""}`);
  };

  /** Where the session lives. Inside a project's own section its name is on the heading already. */
  const whereText = (s, inProject = false) => {
    const proj = all.projects.find((p) => p.id === s.project);
    const rel = proj ? s.cwd.replace(proj.path, "").replace(/^\//, "") : s.cwd.replace(/^\/Users\/[^/]+\//, "~/");
    const place = proj ? (inProject ? rel : `${proj.name}${rel ? `/${rel}` : ""}`) : rel;
    return [s.kind === "background" ? "background" : s.app ?? "terminal", s.tty, place].filter(Boolean).join(" · ");
  };

  const dockFor = (s) => (s.kind === "background" ? { kind: "attach", id: s.claudeId, title: s.title } : { kind: "resume", sessionId: s.sessionId, title: s.title });

  /** `long` names the object: the rack has one column to spare, the overlay header has room. */
  const endButton = (s, cls = "danger", long = false) =>
    s.kind === "background"
      ? el("button", { type: "button", class: cls, onclick: async (e) => {
          e.stopPropagation();
          const done = finished(s.status);
          if (!(await askEnd(done, `"${s.title}"`))) return;
          try {
            const r = await post(`/api/agents/${s.claudeId}/${done ? "remove" : "stop"}`);
            setStatus(r.output || (done ? `removed ${s.claudeId}` : `stopped ${s.claudeId}`), Boolean(r.failed));
          } catch (err) {
            setStatus(err.message, true);
          }
          window.setTimeout(load, 1200);
        }, title: finished(s.status) ? `remove the record for "${s.title}"` : `stop the background agent running "${s.title}"` },
        finished(s.status) ? (long ? "remove record" : "remove") : long ? "stop agent" : "stop")
      : el("button", { type: "button", class: cls, onclick: async (e) => {
          e.stopPropagation();
          if (!(await askClose(s))) return;
          try {
            await post(`/api/sessions/${s.pid}/close`);
            setStatus(`closed pid ${s.pid}`);
          } catch (err) {
            setStatus(err.message, true);
          }
          window.setTimeout(load, 1500);
        }, title: `close the Claude running "${s.title}"` }, long ? "end session" : "close");

  /** Open the session full screen with its terminal already attached. */
  const terminalButton = (s) => el("button", { type: "button", class: "ghost act", title: "open this session with its terminal", onclick: (e) => { e.stopPropagation(); openFull(s, { stick: true }); } }, "open");

  /**
   * Rename in place, the way a controller annotates a flight strip: the name becomes an input
   * where it sits. Enter or blur commits, Escape restores, an empty name hands the session back
   * the title Claude Code derived from its first prompt.
   */
  const renameButton = (s, nameEl) =>
    el("button", { type: "button", class: "ghost act", title: `rename "${s.title}"`, onclick: () => {
      const input = el("input", { type: "text", class: "strip-rename", value: s.title, "aria-label": `rename ${s.title}` });
      // A draggable ancestor swallows text selection inside the input, so the strip puts its
      // handle down while the name is being typed.
      const host = nameEl.closest(".strip");
      host?.setAttribute("draggable", "false");
      const restore = () => { editing = false; host?.setAttribute("draggable", "true"); input.replaceWith(nameEl); };
      const commit = async () => {
        if (!input.isConnected) return; // already restored, by Escape or by the blur that follows it
        const name = input.value.trim();
        const was = s.title;
        restore();
        if (name === was) return;
        // Show the new name at once: rebuilding every session record takes over a second, and a
        // rename that appears to do nothing reads as a rename that failed.
        s.title = name || was;
        nameEl.textContent = s.title;
        try {
          await post("/api/sessions/name", { sessionId: s.sessionId, name });
          setStatus(name ? `renamed to "${name}"` : "name cleared");
        } catch (err) {
          s.title = was;
          nameEl.textContent = was;
          setStatus(err.message, true);
        }
      };
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { ev.preventDefault(); restore(); }
      });
      input.addEventListener("blur", commit);
      editing = true;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
    } }, "rename");

  /** A session with no id cannot be renamed; the slot still shows the verb, greyed. */
  const disabledRename = () => {
    const b = el("button", { type: "button", class: "ghost act", title: "this session has no id to rename" }, "rename");
    b.disabled = true;
    return b;
  };

  /** The last exchange, carried only by the strips you are meant to read. */
  const say = (s) =>
    el("div", { class: "strip-say" },
      s.lastPrompt ? el("p", { class: "you" }, el("span", { class: "who" }, "you"), text(clip(plain(s.lastPrompt), 150))) : null,
      s.lastReply ? el("p", { class: "claude" }, el("span", { class: "who" }, "claude"), text(clip(plain(s.lastReply), 260))) : el("p", { class: "claude empty" }, "nothing said yet"));

  /**
   * One session as a flight progress strip. The line is a grid of fixed columns, so the lamp,
   * state, timing and the three verbs line up down the whole rack however long a title runs.
   * `full` carries the last exchange under the line; `line` is the bare strip.
   */
  /**
   * The six columns every strip shares, in order. A live session and a dead record both go
   * through here, so the two can never drift out of alignment with each other. An action slot
   * is always emitted: a missing verb would slide the rest into the wrong column.
   */
  const stripLine = ({ status, band, name, chips = [], state, note, when, up, where, acts = [] }) =>
    el("div", { class: "strip-line" },
      lamp(status, band),
      el("div", { class: "strip-id" }, name, ...chips),
      el("span", { class: "strip-state", title: [state, note].filter(Boolean).join(" · ") }, el("b", {}, state), note ? el("i", {}, note) : null),
      el("span", { class: "strip-when", title: [when, up].filter(Boolean).join(" · ") }, when, up ? el("i", {}, up) : null),
      el("span", { class: "strip-where", title: where }, where),
      el("div", { class: "strip-acts" }, ...acts));

  /** One session as a flight progress strip. `full` carries the last exchange under the line. */
  const strip = (s, record, full = false, band = "") => {
    const name = el("h4", { class: "strip-name" }, s.title);
    const inFormation = formations.find((x) => x.id === activeFormation) ?? null;
    return el("article", {
      class: `strip ${s.status}${finished(s.status) ? " finished" : ""}${full ? " full" : ""}`,
      tabindex: "0",
      title: s.title,
      // A session with no id has nothing a formation could hold on to, so it stays put.
      draggable: s.sessionId ? "true" : "false",
      ondragstart: (e) => {
        dragging = { sessionId: s.sessionId, from: activeFormation, title: s.title };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", s.sessionId);
        document.body.classList.add("dragging-strip");
      },
      ondragend: endDrag,
      // Inside a formation the same moves the drags make are on the strip, for a pointer that
      // would rather click and for the keyboard's own menu key.
      oncontextmenu: inFormation && s.sessionId ? (e) => { e.preventDefault(); stripMenu(inFormation, s, e.clientX, e.clientY); } : null,
      onclick: (e) => { if (!e.target.closest("button, input")) openFull(s); },
      onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openFull(s); } },
    },
    stripLine({
      status: s.status,
      band,
      name,
      chips: [roleChip(record), auditChip(record)],
      state: s.status,
      note: s.waitingFor,
      when: age(s.at),
      up: s.elapsed ? `up ${s.elapsed}` : null,
      where: whereText(s, true),
      acts: [s.sessionId ? renameButton(s, name) : disabledRename(), terminalButton(s), endButton(s, "ghost act end")],
    }),
    full ? say(s) : null);
  };

  /** A record whose session is gone: the strip stays in the rack, greyed, carrying its handoff. */
  const ghost = (record) =>
    el("article", { class: `strip ghost ${record.status}`, title: record.loop },
      stripLine({
        status: "stopped",
        band: "stale",
        name: el("h4", { class: "strip-name" }, record.loop),
        chips: [roleChip(record), auditChip(record)],
        state: record.status,
        when: record.ended ? age(Date.parse(record.ended)) : "",
        where: record.pr ?? "",
      }),
      record.handoff ? el("div", { class: "strip-say" }, el("p", { class: "claude" }, el("span", { class: "who" }, "handoff"), text(clip(record.handoff, 240)))) : null);

  const sessionForRecord = (r) => (r.claudeId ? model.sessions.find((s) => s.claudeId === r.claudeId) : model.sessions.find((s) => s.sessionId === r.id)) ?? null;

  /** A lead and the sessions it watches: the lead's own strip, then its wings indented under it. */
  const formation = (parentRecord, used) => {
    const children = model.parents.get(parentRecord.id) ?? [];
    const parentSession = sessionForRecord(parentRecord);
    if (parentSession) used.add(parentSession.key);
    const lead = el("div", { class: "cc-lead" },
      jetSvg("jet-glyph lead"),
      el("span", { class: "role" }, parentRecord.role === "audit" ? "audit parent" : parentRecord.role),
      el("b", {}, parentRecord.loop),
      el("span", { class: "sub" }, `${parentSession ? parentSession.status : parentRecord.status} · watching ${children.length} session${children.length === 1 ? "" : "s"}`),
      parentSession ? el("button", { type: "button", class: "ghost", onclick: () => openFull(parentSession) }, "open lead") : null,
    );
    const wings = el("div", { class: "rack-strips cc-wings" });
    for (const c of children) {
      const s = sessionForRecord(c);
      if (s) {
        used.add(s.key);
        wings.append(strip(s, c, true, "working"));
      } else wings.append(ghost(c));
    }
    if (!children.length) wings.append(el("p", { class: "muted small cc-empty" }, "no task sessions under this lead yet: pick it when you spawn from a card"));
    return el("section", { class: "cc-formation" }, lead, wings);
  };

  /** A formation with nothing alive in it, folded to one line. */
  const closedFormation = (parentRecord) => {
    const children = model.parents.get(parentRecord.id) ?? [];
    return el("li", { class: "cc-closed-row", title: parentRecord.handoff ?? "" },
      el("span", { class: "lamp" }),
      el("span", { class: "role" }, parentRecord.role),
      el("span", { class: "name" }, parentRecord.loop),
      el("span", { class: "sub" }, `${parentRecord.status} · ${children.length} session${children.length === 1 ? "" : "s"}${parentRecord.handoff ? ` · ${clip(parentRecord.handoff, 90)}` : ""}`),
    );
  };

  /* ---------- formations: a lead and its flight, as tabs ---------- */

  /** PATCH without repainting: a move across two formations is two writes and one paint. */
  const patchFormation = async (id, patch) => {
    const next = await api(`/api/formations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    formations = formations.map((f) => (f.id === id ? next : f));
    return next;
  };

  const saveFormation = async (id, patch) => {
    await patchFormation(id, patch);
    paint();
  };

  const endDrag = () => {
    dragging = null;
    document.body.classList.remove("dragging-strip");
    for (const n of document.querySelectorAll(".drop-on")) n.classList.remove("drop-on");
  };

  /** Wire a node as somewhere a strip in the air can land. `accepts` decides; `land` moves it. */
  const dropZone = (node, accepts, land) => {
    node.addEventListener("dragover", (e) => {
      if (!dragging || !accepts(dragging)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      node.classList.add("drop-on");
    });
    // Crossing into a child fires dragleave on the parent, and the ring would flicker off.
    node.addEventListener("dragleave", (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove("drop-on"); });
    node.addEventListener("drop", (e) => {
      node.classList.remove("drop-on");
      if (!dragging || !accepts(dragging)) return;
      e.preventDefault();
      const d = dragging;
      endDrag();
      land(d);
    });
    return node;
  };

  const leaveFormation = (f, sessionId) =>
    patchFormation(f.id, f.lead === sessionId ? { lead: null } : { members: f.members.filter((m) => m !== sessionId) });

  /**
   * A strip dropped on a tab flies to that rack: it leaves whichever formation it was in and
   * joins the one it landed on. Dropping on "Rack" is the same move with nothing to join, which
   * is how a session is taken out of a formation.
   */
  const moveTo = async (d, toId) => {
    try {
      const from = d.from ? formations.find((f) => f.id === d.from) : null;
      if (from) await leaveFormation(from, d.sessionId);
      const to = toId ? formations.find((f) => f.id === toId) : null;
      if (to) await patchFormation(to.id, { members: [...to.members, d.sessionId] });
      setStatus(to ? `${d.title} joined ${to.name}` : `${d.title} left ${from?.name ?? "the formation"}`);
    } catch (err) {
      setStatus(err.message, true);
    }
    paint();
  };

  /** Promote to lead. Whoever was leading drops into the flight, so the roster is unchanged. */
  const promote = async (f, sessionId) => {
    try {
      await patchFormation(f.id, { lead: sessionId, members: [...f.members.filter((m) => m !== sessionId), ...(f.lead && f.lead !== sessionId ? [f.lead] : [])] });
      setStatus(`${f.name} has a new lead`);
    } catch (err) {
      setStatus(err.message, true);
    }
    paint();
  };

  const demote = async (f, sessionId) => {
    try {
      await patchFormation(f.id, { lead: null, members: [...f.members, sessionId] });
      setStatus(`${f.name} is flying without a lead`);
    } catch (err) {
      setStatus(err.message, true);
    }
    paint();
  };

  /** This project's sessions, minus whoever is already in this formation. */
  const mySessions = () => model.sessions.filter((s) => s.project === ctx.projectId);
  const addable = (f) => mySessions().filter((s) => s.sessionId && s.sessionId !== f.lead && !f.members.includes(s.sessionId));

  const disband = async (f) => {
    if (!(await askEnd(true, `formation ${f.name}`))) return;
    await api(`/api/formations/${f.id}`, { method: "DELETE" });
    formations = formations.filter((x) => x.id !== f.id);
    if (activeFormation === f.id) activeFormation = null;
    paint();
  };

  const renameFormation = async (f) => {
    const name = await ask({ title: `Rename ${f.name}`, body: "Callsigns are easier to hold than numbers, but it is your formation.", confirm: "rename", field: { value: f.name, placeholder: "callsign" } });
    if (name && name !== f.name) saveFormation(f.id, { name });
  };

  /** A little menu at the pointer: `[label, run, class]` a row. */
  const popMenu = (label, x, y, rows) => {
    document.querySelector(".tab-menu")?.remove();
    const menu = el("div", { class: "menu tab-menu", role: "dialog", "aria-label": label },
      ...rows.map(([caption, run, cls]) =>
        el("button", { type: "button", class: `pick-row${cls ? ` ${cls}` : ""}`, onclick: () => { menu.remove(); run(); } }, el("b", {}, caption))));
    menu.style.top = `${y + 4}px`;
    menu.style.left = `${x}px`;
    document.body.append(menu);
    window.setTimeout(() => document.addEventListener("click", function once() { menu.remove(); document.removeEventListener("click", once); }), 0);
  };

  /** Right-click a formation tab. Closing a tab should not need a trip into the formation. */
  const tabMenu = (f, x, y) =>
    popMenu(`${f.name} formation`, x, y, [["Rename…", () => renameFormation(f)], ["Disband", () => disband(f), "danger"]]);

  /** Right-click a strip inside a formation: the drags, for anyone who would rather click. */
  const stripMenu = (f, s, x, y) =>
    popMenu(`${s.title} in ${f.name}`, x, y, [
      f.lead === s.sessionId
        ? ["Drop into the flight", () => demote(f, s.sessionId)]
        : ["Promote to lead", () => promote(f, s.sessionId)],
      [`Remove from ${f.name}`, () => moveTo({ sessionId: s.sessionId, from: f.id, title: s.title }, null), "danger"],
    ]);

  const formationTabs = () => {
    const tab = (id, label, count, f) =>
      dropZone(el("button", { type: "button", class: activeFormation === id ? "on" : "",
        title: f ? `${f.name} · drop a strip here to bring it into the flight · right-click for rename and disband` : "every session in this project · drop a strip here to take it out of its formation",
        oncontextmenu: f ? (e) => { e.preventDefault(); tabMenu(f, e.clientX, e.clientY); } : null,
        onclick: () => {
        activeFormation = id;
        const u = new URL(location.href);
        if (id) u.searchParams.set("formation", id); else u.searchParams.delete("formation");
        history.replaceState({}, "", u);
        paint();
      } }, label, count != null ? el("b", {}, String(count)) : null),
      // The rack you came from is not somewhere to land.
      (d) => d.from !== id, (d) => moveTo(d, id));
    return el("div", { class: "forms" },
      tab(null, "Rack", mySessions().length),
      ...formations.map((f) => tab(f.id, f.name, slots(f), f)),
      el("button", { type: "button", class: "new", title: "new formation", onclick: async () => {
        const f = await api("/api/formations?project=" + encodeURIComponent(ctx.projectId), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        formations = [...formations, f];
        activeFormation = f.id;
        paint();
      } }, icon("plus")));
  };

  const pickSession = (f, onPick, label) => {
    const options = addable(f);
    if (!options.length) return setStatus("every session in this project is already in this formation");
    const menu = el("div", { class: "menu pick-menu", role: "dialog", "aria-label": label },
      el("h4", {}, label),
      ...options.map((s) => el("button", { type: "button", class: "pick-row", onclick: () => { menu.remove(); onPick(s); } },
        lamp(s.status), el("b", {}, s.title), el("i", {}, s.status))));
    menu.style.top = "96px";
    menu.style.left = "24px";
    document.body.append(menu);
    window.setTimeout(() => document.addEventListener("click", function once(ev) {
      if (!menu.isConnected) return document.removeEventListener("click", once);
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", once); }
    }), 0);
  };

  /** Everything the formation is holding: its lead, its flight, and the slots still starting. */
  const slots = (f) => (f.lead ? 1 : 0) + f.members.length + (f.pending?.length ?? 0);

  /** A slot held for a session that is still starting: the strip is drawn, waiting for its session. */
  const startingSlot = (p) =>
    el("article", { class: "strip ghost starting", title: `${p.title} is starting in a terminal of its own; it takes this slot as Claude Code registers it` },
      stripLine({
        status: "busy",
        band: "working",
        name: el("h4", { class: "strip-name" }, p.title),
        state: "starting",
        when: "",
        where: "waiting for it to register",
      }));

  /**
   * Start a claude straight into this formation, so the flight grows in one step instead of
   * two. The slot is held by the pty it starts in and fills itself the moment Claude Code
   * registers the session, which is also what wires the strip's `open` to this same terminal.
   * It inherits the lead's working directory when that is inside the project, so a flight works
   * one tree. The callsign (the lead is 1) names the slot while it is starting and titles its
   * terminal; the session itself keeps whatever title Claude Code derives, which says more about
   * the work than a position does.
   */
  const newSessionButton = (f, as) => {
    const title = `${f.name} ${as === "lead" ? 1 : slots(f) + 1}`;
    return el("button", { type: "button", class: "ghost", title: `start a new claude in this formation as ${title}`, onclick: async (e) => {
      e.stopPropagation();
      const leader = f.lead ? mySessions().find((s) => s.sessionId === f.lead) : null;
      const path = all.projects.find((p) => p.id === ctx.projectId)?.path;
      const inside = leader?.cwd && path && (leader.cwd === path || leader.cwd.startsWith(`${path}/`));
      try {
        const { formation } = await post(`/api/formations/${f.id}/sessions`, { project: ctx.projectId, title, as, ...(inside ? { cwd: leader.cwd } : {}) });
        formations = formations.map((x) => (x.id === formation.id ? formation : x));
        setStatus(`${title} is starting; it takes its slot as it registers`);
        paint();
      } catch (err) {
        setStatus(err.message, true);
      }
    } }, "new session");
  };

  const formationView = (f) => {
    const byId = new Map(mySessions().filter((s) => s.sessionId).map((s) => [s.sessionId, s]));
    const lead = f.lead ? byId.get(f.lead) : null;
    const flight = f.members.map((id) => byId.get(id)).filter(Boolean);
    const gone = (f.lead && !lead ? 1 : 0) + f.members.length - flight.length;
    const holding = f.pending ?? [];
    const starting = (as) => holding.filter((p) => p.as === as);
    return el("section", { class: "cc-project formation" },
      // Drop a strip on the lead slot to put it in front; the lead it replaces joins the flight.
      dropZone(el("section", { class: "rack lead-rack" },
        el("h4", {}, jetSvg("jet-glyph band"), el("span", {}, "Oversight"),
          el("span", { class: "spacer" }),
          el("button", { type: "button", class: "ghost", onclick: (e) => { e.stopPropagation(); pickSession(f, (s) => saveFormation(f.id, { lead: s.sessionId }), "Who is the lead?"); } }, lead ? "change lead" : "assign a lead"),
          lead || starting("lead").length ? null : newSessionButton(f, "lead")),
        lead
          ? el("div", { class: "rack-strips" }, strip(lead, model.byClaudeId.get(lead.claudeId), true, "working"))
          : starting("lead").length
            ? el("div", { class: "rack-strips" }, ...starting("lead").map(startingSlot))
            : el("p", { class: "muted small cc-empty" }, "No lead yet. The lead is the session that orchestrates; the flight reports into it. Drop a strip here to put one in front.")),
        (d) => d.from === f.id && d.sessionId !== f.lead, (d) => promote(f, d.sessionId)),
      // Drop the lead back into the flight to stand it down.
      dropZone(el("section", { class: "rack" },
        el("h4", {}, el("span", {}, "Flight"), el("span", { class: "n" }, String(flight.length)),
          el("span", { class: "spacer" }),
          el("button", { type: "button", class: "ghost", onclick: (e) => { e.stopPropagation(); pickSession(f, (s) => saveFormation(f.id, { members: [...f.members, s.sessionId] }), "Add to the flight"); } }, "add a session"),
          newSessionButton(f, "member")),
        flight.length || starting("member").length
          ? el("div", { class: "rack-strips" }, ...flight.map((s) => strip(s, model.byClaudeId.get(s.claudeId), false, "working")), ...starting("member").map(startingSlot))
          : el("p", { class: "muted small cc-empty" }, "Nothing flying with it yet. Drop a strip here, or start one.")),
        (d) => d.from === f.id && d.sessionId === f.lead, (d) => demote(f, d.sessionId)),
      gone ? el("p", { class: "muted small cc-empty" }, `${gone} session${gone === 1 ? " is" : "s are"} no longer running; the formation keeps the slot.`) : null,
      // One closing row, not two stray lines: how the strips move, then the way out.
      el("div", { class: "forms-foot" },
        el("span", { class: "muted small" }, "Drag a strip onto another tab to move it, or onto Rack to take it out."),
        el("span", { class: "spacer" }),
        el("button", { type: "button", class: "ghost", onclick: () => disband(f) }, "disband this formation")));
  };

  const rack = (name, sessions, cls = "", full = false) =>
    sessions.length
      ? el("section", { class: `rack ${cls}` },
          el("h4", {}, cls === "needs" ? jetSvg("jet-glyph band") : null, el("span", {}, name), el("span", { class: "n" }, String(sessions.length))),
          el("div", { class: "rack-strips" }, ...sessions.map((s) => strip(s, s.record ?? model.byClaudeId.get(s.claudeId), full, cls))))
      : null;

  const projectSection = (proj, sessions) => {
    const used = new Set();
    const formations = [];
    const closed = [];
    const inProject = (r) => (proj ? r.project === proj.id || r.project === proj.name : !r.project || !all.projects.some((p) => p.id === r.project || p.name === r.project));
    for (const parentId of model.parents.keys()) {
      const parentRecord = model.records.find((r) => r.id === parentId);
      if (!parentRecord || !inProject(parentRecord)) continue;
      const children = model.parents.get(parentId) ?? [];
      const alive = sessionForRecord(parentRecord) || children.some((c) => sessionForRecord(c));
      if (alive) formations.push(formation(parentRecord, used));
      else closed.push(closedFormation(parentRecord));
    }
    const loose = sessions.filter((s) => !used.has(s.key)).sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || (b.at ?? 0) - (a.at ?? 0));
    const is = (...st) => (s) => st.includes(s.status);
    const needs = loose.filter(is("waiting", "blocked"));
    const working = loose.filter(is("busy", "running"));
    const done = loose.filter((s) => finished(s.status));
    const idle = loose.filter((s) => !needs.includes(s) && !working.includes(s) && !done.includes(s));
    // Idle within a day is a session you are between turns on; older is a tab you have probably moved on from.
    const stale = idle.filter((s) => s.at && Date.now() - s.at > DAY);
    // Between turns for under an hour is a conversation you are in the middle of; it is your move.
    const recent = idle.filter((s) => s.at && Date.now() - s.at <= HOUR);
    const fresh = idle.filter((s) => !stale.includes(s) && !recent.includes(s));
    const busy = sessions.filter(is("busy", "running")).length;
    const waiting = sessions.filter(is("waiting", "blocked")).length;
    if (!sessions.length && !formations.length && !closed.length) return null;
    // No project heading: the bar already names the project, and every rack carries its own
    // count. The line here only repeats what is above it and what is below it.
    return el(
      "section",
      { class: "cc-project" },
      rack("Needs you", needs, "needs", true),
      ...formations,
      rack("Working", working, "working", true),
      rack("Needs action", recent, "action", true),
      rack("Idle", fresh, "idle"),
      rack("Stale · idle over a day", stale, "stale"),
      rack("Background · done", done, "done"),
      closed.length ? el("ul", { class: "cc-closed" }, ...closed) : null,
    );
  };

  const paint = () => {
    if (!all) return;
    model = assemble(all);
    // One project at a time. Maverick is opened on a project; sessions running somewhere else
    // are that project's business, not this page's.
    const mine = model.sessions.filter((s) => s.project === ctx.projectId);
    ctx.filterRoot?.replaceChildren(formationTabs());
    const active = formations.find((f) => f.id === activeFormation);
    if (activeFormation && !active) activeFormation = null;
    const proj = all.projects.find((p) => p.id === ctx.projectId) ?? null;
    const section = active ? formationView(active) : projectSection(proj, mine);
    const sections = section ? [section] : [el("p", { class: "muted small cc-empty" }, "no sessions in this project")];
    root.replaceChildren(...sections);
    if (full) paintFullHead();
  };

  /* ---------- full screen conversation ---------- */

  const chip = (t) => el("span", { class: "tool-chip", title: t.gloss }, el("b", {}, t.name), t.gloss ? text(` ${clip(t.gloss, 64)}`) : null);

  /** Fold a run of tool-only turns into one collapsible block. */
  const turnNodes = (events) => {
    const nodes = [];
    let work = null;
    const flushWork = () => {
      if (!work) return;
      const n = work.tools.length;
      const details = el("details", { class: "turn work" }, el("summary", {}, `${n} tool call${n === 1 ? "" : "s"}`, el("span", { class: "t" }, timeOf(work.t))), el("div", { class: "chips" }, ...work.tools.map(chip)));
      nodes.push(details);
      work = null;
    };
    for (const e of events) {
      if (e.role === "assistant" && !e.text && e.tools?.length) {
        work ??= { t: e.t, tools: [] };
        work.tools.push(...e.tools);
        continue;
      }
      if (e.role === "user" && !e.text && e.results && !e.interrupted) continue; // tool results feed the same fold
      flushWork();
      if (e.role === "system") {
        nodes.push(el("details", { class: "turn system" }, el("summary", {}, e.label, el("span", { class: "t" }, timeOf(e.t))), el("pre", {}, e.text ?? "")));
        continue;
      }
      if (e.interrupted) {
        nodes.push(el("div", { class: "turn interrupted" }, "interrupted", el("span", { class: "t" }, timeOf(e.t))));
        continue;
      }
      if (e.role === "user") {
        nodes.push(el("div", { class: "turn user" }, el("span", { class: "who" }, "you", el("span", { class: "t" }, timeOf(e.t))), renderMd(e.text ?? "", { project: ctx.projectId })));
      } else {
        const body = renderMd(e.text ?? "", { project: ctx.projectId });
        const tools = e.tools?.length ? el("div", { class: "chips" }, ...e.tools.map(chip)) : null;
        nodes.push(el("div", { class: "turn claude" }, el("span", { class: "who" }, "claude", el("span", { class: "t" }, timeOf(e.t))), body, tools));
      }
    }
    flushWork();
    return nodes;
  };

  const paintFullHead = () => {
    if (!full) return;
    const live = model.sessions.find((s) => s.key === full.session.key) ?? full.session;
    full.session = live;
    full.head.replaceChildren(
      el("button", { type: "button", class: "ghost back", onclick: closeFull }, "← all sessions"),
      lamp(live.status),
      el("h2", { title: live.title }, full.title ?? live.title),
      el("span", { class: "meta" }, el("span", { class: "k" }, live.status), live.waitingFor ? el("span", {}, live.waitingFor) : null, el("span", {}, whereText(live)), el("span", { class: "mono" }, live.sessionId.slice(0, 8))),
      el("span", { class: "spacer" }),
      endButton(live, "ghost end-long", true),
      full?.stickPane ? null : el("button", { type: "button", class: "primary", onclick: () => takeTheStick(live) }, "Take the stick"),
      // Top right is where every interface puts dismiss, so that is all it may do here.
      el("button", { type: "button", class: "ghost icon-btn dismiss", "aria-label": "close this view; the session keeps running", title: "close this view; the session keeps running", onclick: closeFull }, icon("close")),
    );
  };

  const pullTranscript = async () => {
    if (!full || full.busy) return; // one read in flight at a time, or the first (widening) read is appended twice
    const f = full;
    f.busy = true;
    let page;
    try {
      page = await api(`/api/transcript?cwd=${encodeURIComponent(f.session.cwd)}&session=${encodeURIComponent(f.session.sessionId)}&from=${f.offset}`);
    } finally {
      f.busy = false;
    }
    if (full !== f) return;
    if (page.title && !f.title) {
      f.title = page.title;
      paintFullHead();
    }
    if (!page.events.length) {
      f.offset = page.offset;
      return;
    }
    const nearBottom = f.scroller.scrollHeight - f.scroller.scrollTop - f.scroller.clientHeight < NEAR_BOTTOM;
    // Re-render from the last unfinished fold so consecutive tool turns keep merging.
    f.events.push(...page.events);
    f.offset = page.offset;
    f.list.replaceChildren(...turnNodes(f.events));
    if (f.list.childElementCount === 0) f.list.append(el("p", { class: "muted cc-empty" }, "the transcript is empty so far"));
    if (nearBottom || f.first) f.scroller.scrollTop = f.scroller.scrollHeight;
    f.first = false;
  };

  /** Typing into the session. A background session gets a real composer over a headless attach; a terminal's session cannot be reached. */
  const paintComposer = () => {
    const f = full;
    if (!f) return;
    const s = f.session;
    const peer = s.kind !== "background" && !s.terminalId; // lives in another terminal: reached over its messaging socket
    if (finished(s.status)) {
      f.composer.replaceChildren(el("div", { class: "notice" }, el("span", {}, `This background session has ${s.status}. Its conversation stays on disk.`)));
      return;
    }
    const area = el("textarea", { rows: "2", placeholder: peer ? `Message this session in ${s.app ?? "its terminal"}. It arrives as a peer message; Enter sends.` : "Message this session. Enter sends, Shift+Enter for a new line, drop files to attach." });
    const send = async () => {
      const body = area.value.trim();
      if (!body) return;
      area.disabled = true;
      try {
        if (peer) {
          // Another terminal's session: Claude Code's messaging socket, the channel sessions use for each other.
          await post(`/api/sessions/${s.pid}/message`, { text: body });
        } else {
          // A session living in Maverick's dock is typed into through its own pty; a background one through a headless attach.
          const target = s.terminalId ?? (f.stick ??= await createTerminal({ kind: "attach", id: s.claudeId, title: s.title })).id;
          await sendInput(target, body);
          await new Promise((r) => window.setTimeout(r, 180)); // a burst ending in Enter reads as a paste; a beat later it submits
          await sendInput(target, "\r");
        }
        area.value = "";
        setStatus("sent");
      } catch (err) {
        setStatus(err.message, true);
      } finally {
        area.disabled = false;
        area.focus();
      }
    };
    area.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    acceptDrops(f.composer, (paths) => {
      area.value = `${area.value}${area.value && !area.value.endsWith(" ") ? " " : ""}${paths.join(" ")} `;
      area.focus();
    });
    f.composer.replaceChildren(
      el("div", { class: "row" }, area, el("button", { type: "button", class: "primary", onclick: send }, "Send")),
      el("div", { class: "hint" },
        el("span", {}, peer
          ? `Lives in ${s.app ?? "a terminal"}${s.tty ? ` on ${s.tty}` : ""} · sent over its session socket, so Claude reads it as a peer's request under that session's permissions`
          : `Enter sends · Shift+Enter for a new line · drop a file to attach its path${s.terminalId ? " · this session lives in Maverick's dock" : ""}`),
        peer && s.app && s.pid ? el("button", { type: "button", class: "ghost", onclick: async () => { try { await post(`/api/sessions/${s.pid}/focus`); setStatus(`${s.app} brought to the front: look for ${s.tty ?? "the tab"}`); } catch (err) { setStatus(err.message, true); } } }, `open in ${s.app}`) : null,
        null),
    );
  };

  /**
   * The terminal, inside the session's own view. This is what the dock used to be: a pane over
   * live content was the confusing part, so it lives where the session already is.
   */
  const takeTheStick = async (session) => {
    if (!full || full.stickPane) return;
    const pane = el("div", { class: "cc-stick" }, el("div", { class: "cc-stick-head" },
      el("span", { class: "k" }, "terminal"),
      el("span", { class: "t" }, session.title),
      el("span", { class: "spacer" }),
      el("button", { type: "button", class: "ghost icon-btn", "aria-label": "detach the terminal; the session keeps running", title: "detach; the session keeps running", onclick: dropTheStick }, icon("close"))));
    const host = el("div", { class: "term" });
    pane.append(host);
    full.overlay.insertBefore(pane, full.composer);
    full.stickPane = pane;
    try {
      const info = session.terminalId
        ? (await api("/api/terminals")).find((t) => t.id === session.terminalId)
        : (full.stick ??= await createTerminal(dockFor(session)));
      if (!info) throw new Error("that terminal is gone");
      const term = new window.Terminal({ fontFamily: "JetBrains Mono, Menlo, monospace", fontSize: 12.5, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, theme: { background: "#0a0c0f", foreground: "#e8ecf1" } });
      const fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      const src = new EventSource(`/api/terminals/${info.id}/stream`);
      src.onmessage = (e) => term.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
      src.addEventListener("exit", () => { term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n"); src.close(); });
      term.onData((d) => fetch(`/api/terminals/${info.id}/input`, { method: "POST", body: d, keepalive: true }).catch(() => {}));
      term.onResize(({ cols, rows }) => post(`/api/terminals/${info.id}/resize`, { cols, rows }).catch(() => {}));
      acceptDrops(host, (paths) => sendInput(info.id, `${paths.join(" ")} `));
      full.stickTerm = { term, fit, src, id: info.id };
      term.focus();
      paintFullHead();
    } catch (err) {
      pane.append(el("p", { class: "muted small" }, err.message));
    }
  };

  const dropTheStick = () => {
    if (!full?.stickPane) return;
    full.stickTerm?.src.close();
    full.stickTerm?.term.dispose();
    full.stickPane.remove();
    full.stickPane = null;
    full.stickTerm = null;
    paintFullHead();
  };

  const openFull = (session, opts = {}) => {
    closeFull();
    const head = el("header", { class: "cc-full-head" });
    const list = el("div", { class: "cc-conv" });
    const scroller = el("div", { class: "cc-full-body" }, list);
    const composer = el("div", { class: "cc-composer" });
    const overlay = el("section", { class: "cc-full", role: "dialog", "aria-label": session.title }, head, scroller, composer);
    full = { session, offset: 0, events: [], head, list, scroller, composer, overlay, first: true };
    document.body.append(overlay);
    document.body.classList.add("cc-full-open");
    paintFullHead();
    paintComposer();
    list.append(el("p", { class: "muted cc-empty" }, "reading the transcript…"));
    pullTranscript().catch((err) => list.replaceChildren(el("p", { class: "muted cc-empty" }, err.message)));
    full.timer = window.setInterval(() => pullTranscript().catch(() => {}), 2500);
    history.pushState({ ccFull: session.key }, "", location.href);
    if (opts.stick) takeTheStick(session);
  };

  const closeFull = () => {
    if (!full) return;
    window.clearInterval(full.timer);
    full.stickTerm?.src.close();
    full.stickTerm?.term.dispose();
    if (full.stick) fetch(`/api/terminals/${full.stick.id}`, { method: "DELETE" }).catch(() => {}); // detach; the session keeps running
    full.overlay.remove();
    document.body.classList.remove("cc-full-open");
    full = null;
  };
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && full) { closeFull(); history.back(); } });
  window.addEventListener("popstate", () => closeFull());

  /* ---------- data ---------- */

  let firstLoad = true;
  const load = async () => {
    // Rebuilding every session record takes over a second; the jet flies while it does.
    const stop = firstLoad ? loading?.() : null;
    try {
      [all, formations] = await Promise.all([
        api("/api/sessions/all"),
        api(`/api/formations?project=${encodeURIComponent(ctx.projectId)}`).catch(() => []),
      ]);
      paint();
    } catch (err) {
      // refresh lives in the page head, so it survives this.
      root.replaceChildren(el("p", { class: "muted cc-empty" }, `sessions unavailable: ${err.message}`));
    } finally {
      firstLoad = false;
      stop?.();
    }
  };
  root.replaceChildren(el("p", { class: "muted cc-empty" }, "reading sessions…"));
  load();
  timer = window.setInterval(() => { if (document.visibilityState === "visible" && !editing) load(); }, 10_000);
  return { refresh: load, stop: () => { window.clearInterval(timer); closeFull(); } };
};
