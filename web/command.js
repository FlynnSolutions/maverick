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
  // A shell has no Claude behind it, so nothing above would ever mention it. It is still a
  // terminal you are working in, so it gets a strip like everything else, keyed by its pty.
  for (const t of all.shells ?? []) {
    sessions.push({
      key: `term:${t.id}`, kind: "shell", terminalId: t.id, sessionId: null, cwd: t.cwd, project: t.project,
      title: t.title, status: t.exitCode === null ? "shell" : "exited", app: "Maverick",
      at: Date.parse(t.startedAt), isShell: true,
    });
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
    s.isShell
      ? el("button", { type: "button", class: cls, title: `close the shell "${s.title}"`, onclick: async (e) => {
          e.stopPropagation();
          if (!(await askEnd(false, `the shell "${s.title}"`))) return;
          try {
            await api(`/api/terminals/${s.terminalId}`, { method: "DELETE" });
            setStatus(`closed ${s.title}`);
          } catch (err) {
            setStatus(err.message, true);
          }
          window.setTimeout(load, 600);
        } }, long ? "close shell" : "close")
    : s.kind === "background"
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
  const stripLine = ({ status, band, name, lead = null, chips = [], state, note, when, up, where, acts = [] }) =>
    el("div", { class: "strip-line" },
      lamp(status, band),
      el("div", { class: "strip-id" }, lead, name, ...chips),
      el("span", { class: "strip-state", title: [state, note].filter(Boolean).join(" · ") }, el("b", {}, state), note ? el("i", {}, note) : null),
      el("span", { class: "strip-when", title: [when, up].filter(Boolean).join(" · ") }, when, up ? el("i", {}, up) : null),
      el("span", { class: "strip-where", title: where }, where),
      el("div", { class: "strip-acts" }, ...acts));

  /** One session as a flight progress strip. `wide` carries the last exchange under the line. */
  const strip = (s, record, wide = false, band = "") => {
    const name = el("h4", { class: "strip-name" }, s.title);
    const inFormation = formations.find((x) => x.id === activeFormation) ?? null;
    // Inside a formation a strip opens where it sits, so several run at once. In the rack it
    // still goes full screen: sixteen strips have no room to hold a conversation open.
    const expandable = s.isShell || (Boolean(inFormation) && Boolean(s.sessionId));
    const isOpen = expandable && opened.has(s.key);
    const openIt = () => (expandable ? toggleOpen(s.key) : openFull(s));
    const node = el("article", {
      class: `strip ${s.status}${finished(s.status) ? " finished" : ""}${wide ? " full" : ""}${isOpen ? " open" : ""}`,
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
      onclick: (e) => { if (!e.target.closest("button, input, .cc-pane")) openIt(); },
      onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openIt(); } },
    },
    stripLine({
      status: s.status,
      band,
      name,
      lead: expandable
        ? el("button", { type: "button", class: "strip-turn", "aria-label": isOpen ? `collapse ${s.title}` : `open ${s.title} here`, "aria-expanded": String(isOpen), title: isOpen ? "collapse back to the strip" : "open this session here, beside the others", onclick: (e) => { e.stopPropagation(); openIt(); } }, icon("chevron"))
        : null,
      chips: [roleChip(record), auditChip(record)],
      state: s.status,
      note: s.waitingFor,
      when: age(s.at),
      up: s.elapsed ? `up ${s.elapsed}` : null,
      where: whereText(s, true),
      acts: [s.sessionId ? renameButton(s, name) : disabledRename(), terminalButton(s), endButton(s, "ghost act end")],
    }),
    // An open strip shows the conversation itself; the one-line excerpt would only repeat it.
    isOpen ? null : wide ? say(s) : null);
    if (isOpen) node.append(paneFor(s).node);
    return node;
  };

  /** The pane a strip holds open, made once and kept while the strip stays open. */
  const paneFor = (session) => {
    const open = panes.get(session.key);
    if (open?.inline) {
      open.session = session;
      return open;
    }
    return makePane(session, { inline: true });
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
      el("button", { type: "button", class: "new shell", title: "open a shell in this project", onclick: async () => {
        try {
          const t = await post("/api/terminals", { project: ctx.projectId, kind: "shell", cols: 120, rows: 34 });
          activeFormation = null;
          const u = new URL(location.href);
          u.searchParams.delete("formation");
          history.replaceState({}, "", u);
          opened.add(`term:${t.id}`);
          writeOpen();
          setStatus(`${t.title} opened`);
          await load();
        } catch (err) {
          setStatus(err.message, true);
        }
      } }, icon("terminal")),
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
    // Once the lead is open it takes a column of its own and the flight becomes the rail beside
    // it: that is the whole point of a formation, typing to the one that orchestrates while the
    // rest stay in sight. Closed, the lead is a single line and a column would be empty space.
    const leadOpen = Boolean(lead && opened.has(lead.key));
    return el("section", { class: `cc-project formation${leadOpen ? " with-lead" : ""}` },
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
          ? el("div", { class: `rack-strips${flight.filter((x) => opened.has(x.key)).length > 1 ? " grid" : ""}` }, ...flight.map((s) => strip(s, model.byClaudeId.get(s.claudeId), false, "working")), ...starting("member").map(startingSlot))
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
    const shells = loose.filter((s) => s.isShell);
    const needs = loose.filter(is("waiting", "blocked"));
    const working = loose.filter(is("busy", "running"));
    const done = loose.filter((s) => finished(s.status));
    const idle = loose.filter((s) => !needs.includes(s) && !working.includes(s) && !done.includes(s) && !shells.includes(s));
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
      rack("Shells", shells, "shells"),
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
    // Every open pane's head carries live state (lamp, status, timing), so they follow the model.
    for (const p of panes.values()) {
      paintHead(p);
      // A session stopped at a prompt is the one moment you certainly want its controls, so an
      // open pane reaches for them itself rather than making you ask twice. Only where we own
      // the pty: resuming a session that lives in someone else's terminal would start a second
      // claude on it, which is not a thing to do behind the pilot's back.
      const wants = WANTS_YOU.test(p.session.status ?? "");
      if (p.inline && !p.stickPane && wants && ownPty(p.session)) takeTheStick(p);
      // The registry knowing it is waiting is the dependable signal; the grid holds the question.
      if (wants && p.stickTerm) catchPrompt(p);
      if (!wants && p.promptCard) clearPrompt(p);
    }
    // A repaint rebuilds the racks, so a pane whose strip is no longer drawn has nothing to
    // live in: the session keeps running, the pane does not. Its terminal is detached, not ended.
    for (const p of [...panes.values()]) if (p.inline && !p.node.isConnected) destroyPane(p);
    refitAll();
  };
  /* ---------- the session pane: one conversation, in a strip or full screen ----------
     One implementation, two hosts. A pane owns a session's transcript, its composer and, when
     you take the stick, its terminal. Full screen is a pane in an overlay; a formation expands
     a pane inside the strip it belongs to, which is how several run at once. */

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

  /** Every pane alive on the page, by session key. A strip's pane and the overlay's are the same thing. */
  const panes = new Map();
  let full = null; // the pane that is full screen, if one is

  const liveSession = (p) => model?.sessions.find((s) => s.key === p.key) ?? p.session;

  /** The two states that want the pilot; the lamp draws them as a reticle for the same reason. */
  const WANTS_YOU = /^(waiting|blocked)$/;

  /** A session we can type into: one of our own ptys, or a background agent we can attach to. */
  const ownPty = (s) => Boolean(s.terminalId) || s.kind === "background";

  const paintHead = (p) => {
    const s = (p.session = liveSession(p));
    if (s.isShell) {
      p.head.replaceChildren(
        ...(p.inline ? [] : [el("button", { type: "button", class: "ghost back", onclick: () => closeFull() }, "← all sessions")]),
        el("span", { class: "meta" }, el("span", { class: "k" }, "shell"), el("span", {}, s.cwd.replace(/^\/Users\/[^/]+\//, "~/"))),
        el("span", { class: "spacer" }),
        endButton(s, "ghost end-long", true),
        el("button", { type: "button", class: "ghost icon-btn dismiss", "aria-label": p.inline ? "collapse this shell" : "close this view", title: p.inline ? "collapse back to the strip; the shell keeps running" : "close this view; the shell keeps running", onclick: () => (p.inline ? collapse(p.key) : closeFull()) }, icon("close")),
      );
      return;
    }
    const stick = p.stickPane
      ? el("button", { type: "button", class: "ghost", title: "put the terminal away and read the conversation", onclick: () => dropTheStick(p) }, "back to the conversation")
      : el("button", { type: "button", class: p.inline ? "ghost" : "primary", title: "type into this session's own terminal", onclick: () => takeTheStick(p) }, "Take the stick");
    // Top right is where every interface puts dismiss, so that is all it may do here.
    const dismiss = el("button", { type: "button", class: "ghost icon-btn dismiss", "aria-label": p.inline ? "collapse this session back to its strip" : "close this view; the session keeps running", title: p.inline ? "collapse back to the strip; the session keeps running" : "close this view; the session keeps running", onclick: () => (p.inline ? collapse(p.key) : closeFull()) }, icon("close"));
    // Inline, the strip line directly above already names the session, its state, its timing,
    // where it lives and the three verbs. Repeating all of that would be a second header saying
    // what the first one said, so the pane keeps only what the strip has no column for.
    const parts = p.inline
      ? [el("span", { class: "spacer" }), stick, dismiss]
      : [
          el("button", { type: "button", class: "ghost back", onclick: () => closeFull() }, "← all sessions"),
          lamp(s.status),
          el("h2", { title: s.title }, p.title ?? s.title),
          el("span", { class: "meta" }, el("span", { class: "k" }, s.status), s.waitingFor ? el("span", {}, s.waitingFor) : null, el("span", {}, whereText(s)), el("span", { class: "mono" }, s.sessionId.slice(0, 8))),
          el("span", { class: "spacer" }),
          endButton(s, "ghost end-long", true),
          stick,
          dismiss,
        ];
    // replaceChildren does not drop nulls the way el() does: one would be painted as "null".
    p.head.replaceChildren(...parts.filter(Boolean));
  };

  /**
   * The transcript, pushed rather than asked for. Claude Code writes a line per message block as
   * it goes, so a reply lands here within a beat of being written instead of on the next poll.
   * If the stream cannot be opened the pane falls back to asking, because a pane that shows
   * nothing is worse than one that is a couple of seconds behind.
   */
  const openTranscriptStream = (p) => {
    const q = `cwd=${encodeURIComponent(p.session.cwd)}&session=${encodeURIComponent(p.session.sessionId)}&from=0`;
    try {
      const src = new EventSource(`/api/transcript/stream?${q}`);
      src.onmessage = (e) => {
        if (p.dead) return;
        try {
          applyPage(p, JSON.parse(e.data));
        } catch {
          /* a half-written frame: the next one carries the same events */
        }
      };
      src.onerror = () => {
        // EventSource reconnects on its own; a run of failures means falling back to polling.
        if (p.dead || p.timer) return;
        p.timer = window.setInterval(() => pullTranscript(p).catch(() => {}), 2500);
      };
      p.stream = src;
    } catch {
      p.timer = window.setInterval(() => pullTranscript(p).catch(() => {}), 2500);
      pullTranscript(p).catch(() => {});
    }
  };

  /** Fold one page of events into the pane, wherever it came from. */
  const applyPage = (p, page) => {
    if (page.title && !p.title) {
      p.title = page.title;
      paintHead(p);
    }
    p.offset = page.offset;
    if (!page.events.length) return;
    const nearBottom = p.scroller.scrollHeight - p.scroller.scrollTop - p.scroller.clientHeight < NEAR_BOTTOM;
    // Re-render from the last unfinished fold so consecutive tool turns keep merging.
    p.events.push(...page.events);
    p.list.replaceChildren(...turnNodes(p.events));
    if (p.list.childElementCount === 0) p.list.append(el("p", { class: "muted cc-empty" }, "the transcript is empty so far"));
    if (nearBottom || p.first) p.scroller.scrollTop = p.scroller.scrollHeight;
    p.first = false;
  };

  const pullTranscript = async (p) => {
    if (p.busy || p.dead) return; // one read in flight at a time, or the first (widening) read is appended twice
    p.busy = true;
    let page;
    try {
      page = await api(`/api/transcript?cwd=${encodeURIComponent(p.session.cwd)}&session=${encodeURIComponent(p.session.sessionId)}&from=${p.offset}`);
    } finally {
      p.busy = false;
    }
    if (p.dead) return;
    applyPage(p, page);
  };

  /** Typing into the session. A background session gets a real composer over a headless attach; a terminal's session is reached over its messaging socket. */
  const paintComposer = (p) => {
    const s = p.session;
    const peer = s.kind !== "background" && !s.terminalId; // lives in another terminal
    if (finished(s.status)) {
      p.composer.replaceChildren(el("div", { class: "notice" }, el("span", {}, `This background session has ${s.status}. Its conversation stays on disk.`)));
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
          // A session living in one of Maverick's ptys is typed into through it; a background one through a headless attach.
          const target = s.terminalId ?? (p.stick ??= await createTerminal({ kind: "attach", id: s.claudeId, title: s.title })).id;
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
    acceptDrops(p.composer, (paths) => {
      area.value = `${area.value}${area.value && !area.value.endsWith(" ") ? " " : ""}${paths.join(" ")} `;
      area.focus();
    });
    p.composer.replaceChildren(
      el("div", { class: "row" }, area, el("button", { type: "button", class: "primary", onclick: send }, "Send")),
      el("div", { class: "hint" },
        el("span", {}, peer
          ? `Lives in ${s.app ?? "a terminal"}${s.tty ? ` on ${s.tty}` : ""} · sent over its session socket, so Claude reads it as a peer's request under that session's permissions`
          : `Enter sends · Shift+Enter for a new line · drop a file to attach its path${s.terminalId ? " · this session lives in one of Maverick's terminals" : ""}`),
        peer && s.app && s.pid ? el("button", { type: "button", class: "ghost", onclick: async () => { try { await post(`/api/sessions/${s.pid}/focus`); setStatus(`${s.app} brought to the front: look for ${s.tty ?? "the tab"}`); } catch (err) { setStatus(err.message, true); } } }, `open in ${s.app}`) : null,
        null),
    );
  };

  /* ---------- the terminal, wearing the interface ----------
     A real emulator is not negotiable: Claude Code drives the alternate screen, addresses the
     cursor and wants raw keys, so the arrows, Ctrl+C and its own permission menus only work if
     something speaks the protocol. What is negotiable is that it look like a terminal. */

  /** Resolve a token to a real colour. Tokens are `color-mix()` as often as hex, so ask the browser. */
  const cssColor = (token, probe = el("span")) => {
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  };

  /**
   * The 16 ANSI slots, repainted in the instrument palette. Anything the session colours through
   * them adopts the project's accent rather than a stock red or green.
   */
  const termLook = () => ({
    fontFamily: "JetBrains Mono, Menlo, monospace",
    fontSize: 12.5,
    lineHeight: 1.55,
    letterSpacing: 0.2,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    scrollback: 5000,
    allowTransparency: true,
    theme: {
      background: "rgba(0,0,0,0)", // the pane's own surface shows through; no black gutter
      foreground: cssColor("--ink"),
      cursor: cssColor("--accent"),
      cursorAccent: cssColor("--panel"),
      selectionBackground: cssColor("--accent-dim"),
      black: cssColor("--carbon"),
      red: cssColor("--threat"),
      green: cssColor("--hud"),
      yellow: cssColor("--caution"),
      blue: cssColor("--accent"),
      magenta: cssColor("--accent-hot"),
      cyan: cssColor("--accent-hot"),
      white: cssColor("--ink-soft"),
      brightBlack: cssColor("--ink-ghost"),
      brightRed: cssColor("--threat"),
      brightGreen: cssColor("--hud"),
      brightYellow: cssColor("--caution"),
      brightBlue: cssColor("--accent-hot"),
      brightMagenta: cssColor("--accent-hot"),
      brightCyan: cssColor("--accent-hot"),
      brightWhite: cssColor("--ink"),
    },
  });

  const rgbTriplet = (css) => (css.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).join(";");

  /**
   * Claude Code writes its own colours as truecolor (`38;2;r;g;b`), which walks straight past the
   * palette above: measured against a live pty, its orange arrives as a hardcoded #d77757 no
   * theme can reach. So the handful it hardcodes are substituted in the stream on the way to the
   * renderer. Anything not in the table passes through untouched, which is the safe direction: a
   * colour we have not seen keeps its own value rather than turning into the wrong one.
   */
  const CLAUDE_INK = {
    "215;119;87": "--accent",    // #d77757, the one it signs everything with
    "255;193;7": "--caution",    // #ffc107
    "136;136;136": "--ink-faint", // #888888
    "153;153;153": "--ink-faint", // #999999
  };

  const skinTable = () => new Map(Object.entries(CLAUDE_INK).map(([from, token]) => [from, rgbTriplet(cssColor(token))]));

  const reskin = (chunk, table) =>
    chunk.replace(/([34]8;2;)(\d+;\d+;\d+)/g, (whole, lead, rgb) => (table.has(rgb) ? lead + table.get(rgb) : whole));

  /* ---------- answering a permission prompt without reading a terminal ----------
     Claude Code asks for permission in its TUI, and the question is painted character by
     character across cursor moves, so the raw stream cannot be searched for it: "Do you want"
     never appears contiguously in the bytes. Two things make this tractable anyway. It announces
     itself with a structured desktop notification, which *is* contiguous. And xterm has already
     done the emulation, so the finished question and its options can be read off its buffer
     rather than re-derived. */

  /** `ESC ] 99 ; …p=body;Claude needs your permission BEL`, the notification it emits when it asks. */
  const WANTS_PERMISSION = /\x1b\]99;[^\x07\x1b]*p=body;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

  /**
   * The tail of the buffer, by its own length. Three windows were wrong before this one. A range
   * around the *cursor* misses everything, because a full-screen TUI parks its cursor in the
   * input line rather than near the question. The viewport alone is not enough either. And
   * viewport arithmetic (`viewportY + rows`) is wrong outright: in a short pane `term.rows` is
   * smaller than the rows xterm still has rendered, so the window ended one line past the
   * question and cut off two of its three choices. The buffer knows how long it is; ask it.
   */
  const RECENT = 120;
  const screenLines = (term) => {
    const b = term.buffer.active;
    const lines = [];
    for (let i = Math.max(0, b.length - RECENT); i < b.length; i += 1) lines.push(b.getLine(i)?.translateToString(true) ?? "");
    return lines;
  };

  /**
   * The question and its numbered choices, off the rendered grid. Read from the bottom up,
   * because a long session has asked before and only the last one is live.
   */
  const readPrompt = (term) => {
    const lines = screenLines(term);
    const at = lines.findLastIndex((l) => /^\s*(?:[❯>]\s*)?Do you want\b.*\?\s*$/.test(l));
    if (at < 0) return null;
    const options = [];
    for (let i = at + 1; i < lines.length; i += 1) {
      const m = lines[i].match(/^\s*[❯>]?\s*(\d+)\.\s+(\S.*?)\s*$/);
      if (m) options.push({ key: m[1], label: m[2] });
      else if (options.length && lines[i].trim() && !/^\s*(Esc|Tab)\b/.test(lines[i])) break;
    }
    return options.length ? { question: lines[at].replace(/^\s*[❯>]\s*/, "").trim(), options } : null;
  };

  /**
   * The same question, as this interface asks things. The terminal stays mounted underneath and
   * keeps working, because the card is a shortcut for the keystroke rather than a replacement
   * for it: anything this cannot parse is still answerable in the terminal itself.
   */
  const showPrompt = (p, ask) => {
    p.promptCard?.remove();
    const card = el("div", { class: "cc-ask", role: "group", "aria-label": "Claude needs your permission" },
      el("p", { class: "cc-ask-q" }, ask.question),
      el("div", { class: "cc-ask-opts" }, ...ask.options.map((o, i) =>
        el("button", {
          type: "button",
          class: i === 0 ? "primary" : "ghost",
          title: o.label,
          onclick: async () => {
            card.classList.add("sent");
            try {
              await sendInput(p.stickTerm.id, `${o.key}\r`);
            } catch (err) {
              setStatus(err.message, true);
            }
            clearPrompt(p);
          },
        }, clip(o.label, 58)))),
      el("p", { class: "cc-ask-foot" }, "answered in the session's own terminal, below"));
    p.promptCard = card;
    p.body.insertBefore(card, p.body.firstChild);
    refitAll();
  };

  const clearPrompt = (p) => {
    p.promptCard?.remove();
    p.promptCard = null;
    p.asking = false;
    refitAll();
  };

  /** After it announces, the box takes a beat to finish painting, so look a moment later. */
  const catchPrompt = (p) => {
    if (!p.stickTerm || p.promptCard) return;
    window.clearTimeout(p.catchTimer);
    p.catchTimer = window.setTimeout(() => {
      if (!p.stickTerm || p.dead || p.promptCard) return;
      const ask = readPrompt(p.stickTerm.term);
      if (ask) showPrompt(p, ask);
    }, 300);
  };

  /* ---------- living in a terminal ----------
     Selection, copy, paste and find are what separate a terminal you can look at from one you
     can work in. xterm gives the primitives and none of the bindings; these are the bindings. */

  /** Every match for `q` in the buffer, newest last, as {row, col}. */
  const findAll = (term, q) => {
    if (!q) return [];
    const b = term.buffer.active;
    const needle = q.toLowerCase();
    const hits = [];
    for (let row = 0; row < b.length; row += 1) {
      const line = b.getLine(row)?.translateToString(true).toLowerCase() ?? "";
      let col = line.indexOf(needle);
      while (col >= 0) {
        hits.push({ row, col });
        col = line.indexOf(needle, col + 1);
      }
    }
    return hits;
  };

  /**
   * Find in the scrollback. xterm ships a search addon; this repo vendors its files rather than
   * taking packages, and the whole of what is needed here is an indexOf over the buffer plus
   * `select` and `scrollToLine`, which it already has.
   */
  const findBar = (p) => {
    if (p.findBar) return p.findBar.querySelector("input").focus();
    const count = el("span", { class: "n" }, "");
    let hits = [];
    let at = -1;
    const show = (i) => {
      if (!hits.length) return;
      at = (i + hits.length) % hits.length;
      const h = hits[at];
      p.stickTerm.term.select(h.col, h.row, p.findBar.querySelector("input").value.length);
      p.stickTerm.term.scrollToLine(Math.max(0, h.row - 3));
      count.textContent = `${at + 1} of ${hits.length}`;
    };
    const input = el("input", { type: "search", placeholder: "find in this terminal", "aria-label": "find in this terminal" });
    input.addEventListener("input", () => {
      hits = findAll(p.stickTerm.term, input.value);
      count.textContent = hits.length ? `${hits.length} found` : input.value ? "nothing" : "";
      if (hits.length) show(hits.length - 1); // the newest match, because the newest output is why you looked
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); show(at + (e.shiftKey ? -1 : 1)); }
      if (e.key === "Escape") { e.preventDefault(); closeFind(p); }
    });
    const bar = el("div", { class: "cc-find" }, input, count,
      el("button", { type: "button", class: "ghost", title: "previous match", onclick: () => show(at - 1) }, "prev"),
      el("button", { type: "button", class: "ghost", title: "next match", onclick: () => show(at + 1) }, "next"),
      el("button", { type: "button", class: "ghost icon-btn", "aria-label": "close find", onclick: () => closeFind(p) }, icon("close")));
    p.findBar = bar;
    p.body.insertBefore(bar, p.body.firstChild);
    input.focus();
    refitAll();
  };

  const closeFind = (p) => {
    p.findBar?.remove();
    p.findBar = null;
    p.stickTerm?.term.clearSelection();
    p.stickTerm?.term.focus();
    refitAll();
  };

  /**
   * The bindings a terminal is expected to have. Cmd+C copies a selection and otherwise falls
   * through, so Ctrl+C still interrupts; Cmd+V pastes through the pty rather than the page, so
   * the shell sees it as typing; Cmd+F finds. Everything else is the session's to handle.
   */
  const bindKeys = (p, term, id) => {
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.metaKey || (e.ctrlKey && e.shiftKey);
      if (!mod) return true;
      const key = e.key.toLowerCase();
      if (key === "c" && term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection()).catch(() => setStatus("the browser would not give up the clipboard", true));
        return false;
      }
      if (key === "v") {
        navigator.clipboard?.readText().then((t) => t && sendInput(id, t)).catch(() => setStatus("the browser would not give up the clipboard", true));
        return false;
      }
      if (key === "f") {
        findBar(p);
        return false;
      }
      return true;
    });
  };

  /**
   * The terminal, inside the pane the session already occupies. This is what the dock used to
   * be: a pane over live content was the confusing part, so it lives where the session is.
   */
  /**
   * A terminal needs room to be a terminal. Claude Code lays its permission box out for the size
   * it has been given, and in a 14-row pane it simply does not draw it: the question was not
   * merely off-screen, it was absent from the buffer. So taking the stick claims enough height
   * for the session's own UI to exist, and gives it back on the way out.
   */
  const STICK_MIN = 560;

  const takeTheStick = async (p) => {
    if (p.stickPane) return;
    const session = p.session;
    if (p.inline) {
      const was = p.node.getBoundingClientRect().height;
      if (was < STICK_MIN) {
        p.grewFrom = was;
        p.node.style.height = `${STICK_MIN}px`;
      }
    }
    const pane = el("div", { class: "cc-stick" });
    const host = el("div", { class: "term" });
    pane.append(host);
    p.body.replaceChildren(pane);
    p.stickPane = pane;
    paintHead(p);
    try {
      const info = session.terminalId
        ? (await api("/api/terminals")).find((t) => t.id === session.terminalId)
        : (p.stick ??= await createTerminal(dockFor(session)));
      if (!info) throw new Error("that terminal is gone");
      const term = new window.Terminal(termLook());
      const fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      const src = new EventSource(`/api/terminals/${info.id}/stream`);
      // Decoded as a stream, because a multi-byte character can land across two chunks.
      const decoder = new TextDecoder();
      const table = skinTable();
      src.onmessage = (e) => {
        const chunk = decoder.decode(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)), { stream: true });
        // The notification is the fast path, scanned across a rolling tail because a sequence can
        // land split over two frames, which is exactly how this failed the first time. It is only
        // ever an accelerator: the registry saying the session is waiting is the real trigger.
        const scan = (p.tail ?? "") + chunk;
        p.tail = scan.slice(-256);
        WANTS_PERMISSION.lastIndex = 0;
        for (const m of scan.matchAll(WANTS_PERMISSION)) if (/permission/i.test(m[1])) p.asking = true;
        term.write(reskin(chunk, table), () => {
          // Read the grid only once xterm has finished applying this chunk to it.
          if (!p.promptCard) catchPrompt(p);
          else if (!readPrompt(term)) clearPrompt(p);
        });
      };
      src.addEventListener("exit", () => { term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n"); src.close(); });
      term.onData((d) => fetch(`/api/terminals/${info.id}/input`, { method: "POST", body: d, keepalive: true }).catch(() => {}));
      term.onResize(({ cols, rows }) => post(`/api/terminals/${info.id}/resize`, { cols, rows }).catch(() => {}));
      acceptDrops(host, (paths) => sendInput(info.id, `${paths.join(" ")} `));
      bindKeys(p, term, info.id);
      p.stickTerm = { term, fit, src, id: info.id };
      catchPrompt(p); // it may already have been asking before this pane existed
      term.focus();
    } catch (err) {
      pane.append(el("p", { class: "muted small" }, err.message));
    }
  };

  const dropTheStick = (p) => {
    if (!p.stickPane) return;
    closeFind(p);
    if (p.grewFrom) {
      p.node.style.height = `${p.grewFrom}px`;
      p.grewFrom = null;
    }
    p.stickTerm?.src.close();
    p.stickTerm?.term.dispose();
    p.stickPane.remove();
    p.stickPane = null;
    p.stickTerm = null;
    p.body.replaceChildren(p.scroller, p.composer);
    paintHead(p);
  };

  /**
   * xterm measures its own box, so every visible terminal is refit and its pty resized whenever
   * the layout moves: a pane opening beside it, one closing, the columns changing. Inside a
   * requestAnimationFrame, or the new geometry has not landed yet and it fits to the old one.
   */
  let refitSoon = null;
  const refitAll = () => {
    // One gesture can move the layout twice: closing a pane narrows the page, and losing the
    // scrollbar it needed widens it again a beat later. Fitting to each posts the pty two
    // resizes and a full-screen TUI repaints on both, so wait for it to settle and fit once.
    if (refitSoon) window.clearTimeout(refitSoon);
    refitSoon = window.setTimeout(() => {
      refitSoon = null;
      doRefit();
    }, 90);
  };

  const doRefit = () => {
    window.requestAnimationFrame(() => {
      for (const p of panes.values()) {
        if (!p.stickTerm || !p.node.isConnected) continue;
        try {
          // Fit only when the grid it would land on actually differs. Two fits in a frame send
          // the pty two resizes, and a full-screen TUI repaints on each: measured, widening a
          // pane posted 206 columns and then 207, which is one flicker for nothing.
          const want = p.stickTerm.fit.proposeDimensions();
          const { term } = p.stickTerm;
          if (!want || (want.cols === term.cols && want.rows === term.rows)) continue;
          p.stickTerm.fit.fit();
        } catch {
          /* a pane mid-teardown has no box to measure */
        }
      }
    });
  };

  /** Heights are a per-viewer convenience, so they live in this browser rather than the URL. */
  const HEIGHTS = "mv.paneHeights";
  const readHeights = () => {
    try {
      return JSON.parse(localStorage.getItem(HEIGHTS) ?? "{}");
    } catch {
      return {}; // private window, blocked storage: the default height is a fine answer
    }
  };
  const rememberHeight = (key, px) => {
    try {
      localStorage.setItem(HEIGHTS, JSON.stringify({ ...readHeights(), [key]: Math.round(px) }));
    } catch {
      /* nothing to remember it with */
    }
  };

  const MIN_PANE = 180;

  /**
   * Drag the bottom edge to size a pane. A drawn bar rather than CSS `resize`, which brings the
   * browser's own grip and does not persist. The terminal inside refits as the edge moves, so it
   * follows the drag rather than snapping once it is let go.
   */
  const resizeHandle = (p) => {
    const bar = el("div", { class: "cc-pane-grip", role: "separator", "aria-label": "drag to resize this session", "aria-orientation": "horizontal", tabindex: "0" });
    bar.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      bar.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = p.node.getBoundingClientRect().height;
      const move = (ev) => {
        const h = Math.max(MIN_PANE, startH + (ev.clientY - startY));
        p.node.style.height = `${h}px`;
        refitAll();
      };
      const up = (ev) => {
        bar.releasePointerCapture(ev.pointerId);
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        rememberHeight(p.key, p.node.getBoundingClientRect().height);
        refitAll();
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
    // The keyboard gets the same control, because a drag is unreachable without a pointer.
    bar.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowDown" ? 40 : e.key === "ArrowUp" ? -40 : 0;
      if (!step) return;
      e.preventDefault();
      const h = Math.max(MIN_PANE, p.node.getBoundingClientRect().height + step);
      p.node.style.height = `${h}px`;
      rememberHeight(p.key, h);
      refitAll();
    });
    return bar;
  };

  /** Build a pane for a session. `inline` panes live in a strip; the other kind is full screen. */
  const makePane = (session, { inline }) => {
    const head = el("header", { class: "cc-full-head" });
    const list = el("div", { class: "cc-conv" });
    const scroller = el("div", { class: "cc-full-body" }, list);
    const composer = el("div", { class: "cc-composer" });
    const body = el("div", { class: "cc-pane-body" }, scroller, composer);
    const node = el("section", { class: `cc-pane${inline ? " inline" : " cc-full"}`, role: inline ? "group" : "dialog", "aria-label": session.title }, head, body);
    const p = { key: session.key, session, inline, head, list, scroller, composer, body, node, offset: 0, events: [], first: true };
    if (inline) {
      const saved = readHeights()[p.key];
      if (saved) node.style.height = `${Math.max(MIN_PANE, saved)}px`;
      node.append(resizeHandle(p));
    }
    panes.set(p.key, p);
    paintHead(p);
    if (session.isShell) {
      // There is no conversation behind a shell. The terminal is the whole of it.
      takeTheStick(p);
      return p;
    }
    paintComposer(p);
    list.append(el("p", { class: "muted cc-empty" }, "reading the transcript…"));
    openTranscriptStream(p);
    return p;
  };

  const destroyPane = (p) => {
    p.dead = true;
    p.stream?.close();
    window.clearInterval(p.timer);
    p.stickTerm?.src.close();
    p.stickTerm?.term.dispose();
    // A terminal this pane opened for itself is detached, never ended: the session runs on.
    if (p.stick) fetch(`/api/terminals/${p.stick.id}`, { method: "DELETE" }).catch(() => {});
    p.node.remove();
    panes.delete(p.key);
  };

  /* ---------- expanded strips: several sessions at once, in their own rack ---------- */

  /** Which strips are expanded, in the URL beside `formation`, so a layout survives a reload. */
  const readOpen = () => new Set((new URLSearchParams(location.search).get("open") ?? "").split(",").filter(Boolean));
  let opened = readOpen();

  const writeOpen = () => {
    const u = new URL(location.href);
    if (opened.size) u.searchParams.set("open", [...opened].join(","));
    else u.searchParams.delete("open");
    history.replaceState({}, "", u);
  };

  const expand = (key) => { opened.add(key); writeOpen(); paint(); };
  const collapse = (key) => {
    opened.delete(key);
    writeOpen();
    const p = panes.get(key);
    if (p?.inline) destroyPane(p);
    paint();
  };
  const toggleOpen = (key) => (opened.has(key) ? collapse(key) : expand(key));

  /* ---------- full screen ---------- */

  const openFull = (session, opts = {}) => {
    closeFull();
    full = makePane(session, { inline: false });
    document.body.append(full.node);
    document.body.classList.add("cc-full-open");
    history.pushState({ ccFull: session.key }, "", location.href);
    if (opts.stick) takeTheStick(full);
  };

  const closeFull = () => {
    if (!full) return;
    destroyPane(full);
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
