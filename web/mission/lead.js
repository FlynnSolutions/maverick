// The Strike Lead as a chat: you write, it writes back, in one thread from the interview to the
// flight. Its questions arrive as cards whose answers are buttons; the reason behind a question
// is folded under it, so the question is the first thing read, not the last. When the plan it
// wrote can fly, the button that fires the mission is under its message.
//
// Not a section module: the shell mounts it in Plan before approval and Progress mounts it after,
// so the same thread is there the whole way through. Every class is `lead-`.

import { render as renderMarkdown } from "../markdown.js";

/**
 * leadThread(ctx) → { node, update(view) }
 *   ctx is the shell's (web/mission.js), mountTerminal included. `update` appends what is new
 *   and never rebuilds a round being answered, so a half-picked round survives every stream event.
 */
export const leadThread = (ctx) => {
  const { el, btn, post, act, actionUrl, fmtTime, plural, armed, approveWhy, projectId } = ctx;
  let view = null;

  const log = el("ol", { class: "lead-log", "aria-live": "polite" });
  const thinking = el("p", { class: "lead-thinking", role: "status", hidden: true }, ctx.lamp("busy", "work"), "the Strike Lead is reading and writing back");
  const fire = el("div", { class: "lead-fire" });
  const heard = el("p", { class: "lead-heard", role: "status" });

  const box = el("textarea", { rows: "2", placeholder: "write to the Strike Lead", "aria-label": "Message to the Strike Lead" });
  const send = el("button", { type: "submit", class: "primary" }, "send");
  const fail = (err) => {
    heard.textContent = err.message;
    heard.classList.add("error");
  };
  const say = async (body) => {
    heard.textContent = "";
    heard.classList.remove("error");
    await post(actionUrl("say"), body);
  };
  const composer = el("form", { class: "lead-compose", onsubmit: async (e) => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text) return box.focus();
    send.disabled = true;
    send.textContent = "sending";
    try {
      await say({ text });
      box.value = "";
    } catch (err) {
      fail(err);
    } finally {
      send.disabled = false;
      send.textContent = "send";
    }
  } }, box, send);
  // Enter sends, as in every chat; Shift+Enter is a new line.
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); } });

  const well = el("div", { class: "mv-session", hidden: true });
  const raw = btn("open its session in a terminal", async () => {
    try {
      const term = await post(actionUrl("interview"), {});
      well.replaceChildren(el("div", { class: "term" }));
      well.hidden = false;
      requestAnimationFrame(() => ctx.mountTerminal(well.firstChild, term.id));
    } catch (err) {
      fail(err);
    }
  }, "ghost lead-raw");

  /* The conversation is history once it has run long: the last few entries show, the rest fold behind one line above them. */
  const KEEP = 6;
  let unfolded = false;
  const earlier = btn("", () => { unfolded = !unfolded; foldLog(); }, "ghost lead-earlier");
  const foldLog = () => {
    const items = [...log.children];
    const folded = unfolded ? 0 : Math.max(0, items.length - KEEP);
    items.forEach((li, i) => {
      li.hidden = i < folded;
      if (li.hidden) li.dataset.folded = "";
    });
    earlier.hidden = items.length <= KEEP;
    earlier.textContent = unfolded ? "fold the earlier conversation" : `the earlier conversation, ${folded} ${folded === 1 ? "entry" : "entries"}`;
    earlier.setAttribute("aria-expanded", String(unfolded));
  };
  /** An ended mission's Strike Lead is stood down and the server refuses anything said to it, so nothing here offers to. */
  const ended = el("p", { class: "lead-hint", hidden: true }, "This mission has ended, so its Strike Lead takes nothing more. Start a new mission from the workspace for anything still to do.");

  const node = el("section", { class: "lead" },
    el("h3", { class: "lead-head" }, "The Strike Lead"),
    earlier, log, thinking, fire, composer, ended, heard,
    el("div", { class: "lead-foot" }, raw), well);

  /* ---------- one round of questions, answered with clicks ---------- */
  const round = (entry) => {
    const picked = new Map(entry.questions.map((q) => [q.id, { options: [], other: "" }]));
    const sendRound = btn("send answers", async () => {
      sendRound.disabled = true;
      try {
        await say({ answers: Object.fromEntries(picked) });
      } catch (err) {
        fail(err);
        sendRound.disabled = false;
      }
    }, "primary");
    const cards = entry.questions.map((q, i) => {
      const mine = picked.get(q.id);
      const opts = q.options.map((o) => {
        const b = btn(o, () => {
          mine.options = q.multi ? (mine.options.includes(o) ? mine.options.filter((x) => x !== o) : [...mine.options, o]) : (mine.options[0] === o ? [] : [o]);
          for (const x of opts) x.setAttribute("aria-pressed", String(mine.options.includes(x.textContent)));
        }, "lead-opt");
        b.setAttribute("aria-pressed", "false");
        return b;
      });
      const other = el("input", { type: "text", class: "mv-note", placeholder: "or in your own words", "aria-label": `Your own answer to: ${q.question}` });
      other.addEventListener("input", () => { mine.other = other.value; });
      return el("li", { class: "lead-q" },
        el("p", { class: "lead-ask" }, el("span", { class: "lead-n" }, String(i + 1)), q.question),
        el("div", { class: "lead-opts", role: "group", "aria-label": q.question }, ...opts),
        q.multi ? el("p", { class: "lead-hint" }, "pick any that apply") : null,
        other,
        q.context ? el("details", { class: "lead-why" }, el("summary", {}, "more context"), el("p", {}, q.context)) : null);
    });
    return el("div", { class: "lead-round" }, el("ol", { class: "lead-qs" }, ...cards), el("div", { class: "lead-round-foot" }, sendRound));
  };

  /** A round already answered: its questions folded, so the thread reads as the conversation it was. */
  const asked = (entry) => el("details", { class: "lead-asked" },
    el("summary", {}, `${plural(entry.questions.length, "question")} asked`),
    el("ol", {}, ...entry.questions.map((q) => el("li", {}, q.question))));

  const bubble = (entry, open) => el("li", { class: `lead-msg ${entry.who === "you" ? "you" : entry.who === "Maverick" ? "sys" : "sl"}${entry.error ? " error" : ""}` },
    el("p", { class: "lead-who" }, entry.who === "you" ? "you" : entry.who, el("span", { class: "lead-at" }, fmtTime(entry.at))),
    entry.who === "you" ? el("p", { class: "lead-text" }, entry.text) : el("div", { class: "lead-text" }, renderMarkdown(entry.text, { project: projectId })),
    entry.questions?.length ? (open ? round(entry) : asked(entry)) : null);

  /** The last entry is the only one whose round is still open, and only while nothing has been said after it. */
  const isOpen = (chat, i) => !over() && i === chat.length - 1 && chat[i].who === "Strike Lead" && Boolean(chat[i].questions?.length);
  const over = () => ["closed", "abandoned"].includes(view?.status);

  /** Maverick's own line about the flight: a task out, passed or back, a milestone merged. One quiet line each. */
  const note = (u) => el("li", { class: `lead-note ${u.kind}` }, el("span", { class: "lead-at" }, fmtTime(u.at)), el("span", {}, u.text));

  /**
   * The conversation and the flight's updates in one thread, in time order. Each item keeps its
   * node: a new one is placed where its time puts it, a round that has just been answered folds,
   * and nothing else on the page is rebuilt, so a half-picked round survives every event.
   */
  const placed = new Map();
  const paintLog = (chat, updates) => {
    const items = [
      ...chat.map((entry, i) => ({ key: `c${i}`, at: Date.parse(entry.at), entry, open: isOpen(chat, i) })),
      ...updates.map((update, i) => ({ key: `u${i}`, at: Date.parse(update.at), update })),
    ].sort((a, b) => a.at - b.at);
    let prev = null;
    for (const item of items) {
      let held = placed.get(item.key);
      if (!held || (item.entry && held.open !== item.open)) {
        const node = item.entry ? bubble(item.entry, item.open) : note(item.update);
        held?.node.replaceWith(node);
        held = { node, open: item.open };
        placed.set(item.key, held);
      }
      const want = prev ? prev.nextSibling : log.firstChild;
      if (held.node !== want) log.insertBefore(held.node, want);
      prev = held.node;
    }
  };

  /** The one button that sends the mission out, under the message that said the plan is ready. */
  let fireKey = "";
  const paintFire = () => {
    const doc = view.planDoc ?? {};
    const last = view.chat?.findLast((e) => e.who === "Strike Lead");
    const ready = !view.approved && last?.planReady && doc.found && !doc.parsed?.problems?.length;
    const refusing = doc.preflight?.filter((c) => c.refuses) ?? [];
    const failing = doc.preflight?.filter((c) => c.status === "fail" && !c.refuses) ?? [];
    const key = JSON.stringify([ready, refusing.map((c) => c.name), failing.map((c) => c.name), doc.cost]);
    if (key === fireKey) return;
    fireKey = key;
    if (!ready) return fire.replaceChildren();
    if (refusing.length) return fire.replaceChildren(el("p", { class: "mv-warn" }, `The plan is ready, but the mission cannot run without ${refusing.map((c) => c.name).join(", ")}. The gate below says what each one needs.`));
    // Firing is a decision, not a click: asked twice, as the gate's approve is.
    // replaceChildren would print a null as the word "null"; only what is there goes in.
    fire.replaceChildren(...[
      armed({ label: "Fire mission", cls: "lead-fire-btn", why: approveWhy(doc), yes: `yes, fire "${view.name}"`, onYes: () => act("approve", {}, "fired; the first milestone is out") }),
      failing.length ? el("p", { class: "mv-warn" }, `${plural(failing.length, "check")} failed in the gate below (${failing.map((c) => c.name).join(", ")}); read ${failing.length === 1 ? "it" : "them"} before you fire.`) : null,
      el("p", { class: "lead-hint" }, "It asks once more before it fires. The plan, its checks and what it costs are in the gate below."),
    ].filter(Boolean));
  };

  const update = (next) => {
    view = next;
    paintLog(next.chat ?? [], next.updates ?? []);
    foldLog();
    composer.hidden = over();
    ended.hidden = !over();
    thinking.hidden = !next.leadBusy;
    raw.hidden = !next.lead || next.leadBusy || over();
    paintFire();
  };

  return { node, update };
};
