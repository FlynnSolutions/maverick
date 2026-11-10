// The Strike Lead as a chat: you write, it writes back, in one thread from the interview to the
// flight. A round of questions it is waiting on is asked at the top of the page, not in the thread:
// the question, what it needs and the answer in one card, with the message that led to it one press
// away. When the plan it wrote can fly, the button that fires the mission is under its message.
//
// Not a section module: the shell mounts it in Plan before approval and Progress mounts it after,
// so the same thread is there the whole way through. Every class is `lead-`.

import { render as renderMarkdown } from "../markdown.js";
import { foldable } from "../card.js";
import { showMe } from "../show-me.js";
import { atReview, isEnded } from "./state.js";

/**
 * leadThread(ctx) → { node, update(view), land() }
 *   ctx is the shell's (web/mission.js), mountTerminal included. `update` appends what is new
 *   and never rebuilds a round being answered, so a half-picked round survives every stream event.
 *   `land` brings the box into view when the page opened on `#lead`, once the box is placed.
 */
export const leadThread = (ctx) => {
  const { el, btn, post, act, actionUrl, fmtTime, plural, armed, approveWhy, failingNote, projectId } = ctx;
  let view = null;

  const log = el("ol", { class: "lead-log", "aria-live": "polite" });
  const thinking = el("p", { class: "lead-thinking", role: "status", hidden: true }, ctx.lamp("busy", "work"), "the Strike Lead is reading and writing back");
  const fire = el("div", { class: "lead-fire" });
  /*
   * What waits on you in this thread goes in the page's top slot. A round of questions is asked and
   * answered there, in `askBox`. A plan ready to fly is only pointed to, since firing stays under
   * what it costs, so the pointer is dressed as the link it is.
   */
  const askBox = el("section", { class: "lead-card", id: "round", hidden: true, "aria-label": "The Strike Lead is asking" });
  ctx.now.append(askBox);
  // The gate's own verb takes the focus there (mission.js toGate), so the pointer lands on what fires it.
  const gateButton = btn("read the terms and fire", () => {
    if (location.hash === "#gate") window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = "gate";
  }, "ghost lead-link");
  const nowBox = el("section", { class: "lead-now", hidden: true, "aria-label": "Waiting on you" },
    el("h2", {}, "The plan is ready to fly"),
    el("p", { class: "lead-hint" }, "What it writes, spawns and costs is in the gate below, with the button that fires it."),
    gateButton);
  ctx.now.append(nowBox);
  const heard = el("p", { class: "lead-heard", role: "status" });

  /* Headed by name, so it is never taken for a Wingman's screen, which is headed as that Wingman's (mission.js). */
  const box = el("textarea", { id: "lead-box", rows: "2", placeholder: "a change, a reason, a word about a task" });
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
  const composer = el("form", { class: "lead-compose", id: "lead", onsubmit: async (e) => {
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
  } }, el("label", { class: "lead-to", for: "lead-box" }, "To the Strike Lead"), el("div", { class: "lead-compose-row" }, box, send));
  // Enter sends, as in every chat; Shift+Enter is a new line.
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); } });

  const well = el("div", { class: "mv-session", hidden: true });
  const raw = btn("open its session in a terminal", async () => {
    try {
      const term = await post(actionUrl("interview"), {});
      const screen = el("div", { class: "term" });
      well.replaceChildren(el("div", { class: "mv-session-head" }, el("span", { class: "muted small" }, "The Strike Lead's own session")), screen);
      well.hidden = false;
      requestAnimationFrame(() => ctx.mountTerminal(screen, term.id));
    } catch (err) {
      fail(err);
    }
  }, "ghost lead-raw");

  /*
   * The conversation is history once it has run long: the last few entries show, the rest fold
   * behind one line above them. Once the work is done (review, closed, stopped) all of it is
   * history, so all of it folds, and the page reads as what is left to do.
   */
  const KEEP = 6;
  const quiet = () => over() || atReview(view?.status);
  let unfolded = false;
  const earlier = btn("", () => { unfolded = !unfolded; foldLog(); }, "ghost lead-earlier");
  const foldLog = () => {
    const items = [...log.children];
    const folded = unfolded ? 0 : Math.max(0, items.length - (quiet() ? 0 : KEEP));
    items.forEach((li, i) => {
      li.hidden = i < folded;
      if (li.hidden) li.dataset.folded = "";
    });
    earlier.hidden = items.length <= (quiet() ? 0 : KEEP);
    const what = quiet() ? "the conversation" : "the earlier conversation";
    earlier.textContent = unfolded ? `fold ${what}` : `${what}, ${folded} ${folded === 1 ? "entry" : "entries"}`;
    earlier.setAttribute("aria-expanded", String(unfolded));
  };
  /** An ended mission's Strike Lead is stood down and the server refuses anything said to it, so nothing here offers to. */
  const ended = el("p", { class: "lead-hint", hidden: true }, "This mission has ended, so its Strike Lead takes nothing more. Start a new mission from the workspace for anything still to do.");

  const node = el("section", { class: "lead" },
    el("h3", { class: "lead-head" }, "The Strike Lead"),
    earlier, log, thinking, fire, composer, ended, heard,
    el("div", { class: "lead-foot" }, raw), well);

  /* ---------- one round of questions, answered with clicks ---------- */
  /** The message a round came with, in the thread: the conversation opens to show it, however folded it was. */
  const showInThread = (i, from, back) => {
    unfolded = true;
    foldLog();
    const node = placed.get(`c${i}`)?.node;
    // Sent to read it, so all of it shows.
    node?.querySelector(".fold-cut.folded + .fold-toggle")?.click();
    return showMe(node, { from, home: askBox, back });
  };
  /** All of what a question needs to say shows, up to what still leaves its send button on a first screen. */
  const contextOf = (q, many) => {
    if (!q.context) return null;
    const tight = many || matchMedia("(max-width: 600px)").matches;
    const body = el("div", { class: "lead-context" }, renderMarkdown(q.context, { project: projectId }));
    return q.context.length <= (tight ? 240 : 720) ? body : foldable(ctx, body, { more: "the rest of the context", height: tight ? "6.2em" : "9.5em" });
  };
  const round = (entry, at) => {
    const single = entry.questions.length === 1;
    const picked = new Map(entry.questions.map((q) => [q.id, { options: [], other: "" }]));
    /* A refused round says so under its own button, where the eye is, not under the composer below. */
    const roundSaid = el("p", { class: "lead-heard error", role: "status" });
    const sendRound = btn(single ? "send answer" : "send answers", async () => {
      const empty = entry.questions.findIndex((q) => { const mine = picked.get(q.id); return !mine.options.length && !mine.other.trim(); });
      if (empty >= 0) {
        const said = cards[empty].querySelector(".lead-heard");
        said.textContent = "Pick an option or write your own answer first.";
        cards[empty].querySelector(".lead-opt, .mv-note").focus();
        return;
      }
      sendRound.disabled = true;
      roundSaid.textContent = "";
      // Set first: the stream can bring the round's end before this post comes back.
      answered = entry.at;
      try {
        await say({ answers: Object.fromEntries(picked) });
        paintAsk();
        askBox.querySelector(".lead-sent")?.focus({ preventScroll: true });
      } catch (err) {
        answered = "";
        roundSaid.textContent = `Could not send: ${err.message}. Your answer is still here; send it again.`;
        sendRound.disabled = false;
        sendRound.focus();
      }
    }, "primary");
    const led = btn("the message that led to this", (e) => {
      if (!showInThread(at, e.currentTarget, "back to the question")) roundSaid.textContent = "That message could not be shown; it is in the conversation below.";
    }, "ghost lead-link");
    const cards = entry.questions.map((q, i) => {
      const mine = picked.get(q.id);
      /* The empty-send line stands under the question it is about, next to where the focus goes. */
      const missing = el("p", { class: "lead-heard error", role: "status" });
      const opts = q.options.map((o) => {
        const b = btn(o, () => {
          missing.textContent = "";
          mine.options = q.multi ? (mine.options.includes(o) ? mine.options.filter((x) => x !== o) : [...mine.options, o]) : (mine.options[0] === o ? [] : [o]);
          for (const x of opts) x.setAttribute("aria-pressed", String(mine.options.includes(x.textContent)));
        }, "lead-opt");
        b.setAttribute("aria-pressed", "false");
        return b;
      });
      const other = el("input", { type: "text", class: "mv-note", placeholder: q.options.length ? "your own words, alone or with an option" : "your answer", "aria-label": `Your own answer to: ${q.question}` });
      other.addEventListener("input", () => { mine.other = other.value; missing.textContent = ""; });
      return el("li", { class: "lead-q" },
        el("h2", { class: "lead-ask" }, single ? null : el("span", { class: "lead-n" }, String(i + 1)), q.question),
        contextOf(q, !single),
        q.options.length ? el("div", { class: "lead-opts", role: "group", "aria-label": q.question }, ...opts) : null,
        q.multi ? el("p", { class: "lead-hint" }, "pick any that apply") : null,
        other,
        missing);
    });
    return el("div", { class: "lead-round" },
      el("p", { class: "lead-who" }, "The Strike Lead asks", el("span", { class: "lead-at" }, fmtTime(entry.at))),
      el("ol", { class: "lead-qs" }, ...cards),
      el("div", { class: "lead-round-foot" }, sendRound, led, roundSaid));
  };

  /**
   * The round waiting on you, in the top slot. Built once per round, so a half-picked one survives
   * every stream event. Once answered, the card says where that went until the page is left.
   */
  let askAt = "";
  let answered = "";
  const sentLine = el("p", { class: "lead-sent", tabindex: "-1" });
  const toThread = btn("show me in the conversation", (e) => { showInThread((view.chat?.length ?? 1) - 1, e.currentTarget, "back"); }, "ghost lead-link");
  const sentBox = el("div", { class: "lead-round" }, sentLine, toThread);
  const paintAsk = () => {
    const chat = view?.chat ?? [];
    const open = openRound() && chat.at(-1).at !== answered ? chat.at(-1) : null;
    if (open) {
      if (askAt !== open.at) {
        askAt = open.at;
        answered = "";
        askBox.replaceChildren(round(open, chat.length - 1));
      }
    } else if (askAt || answered) {
      askAt = "";
      // What has come back since the round was asked, as the answer itself and a turn that failed both land in the thread.
      const last = chat.findLast((entry) => entry.who !== "you");
      const reply = last?.at > answered ? last : null;
      const said = reply?.error ? "The Strike Lead did not answer. The conversation says why."
        : reply?.who === "Strike Lead" ? "The Strike Lead wrote back."
          : "Answer sent. The Strike Lead is reading it and will write back in the conversation.";
      if (sentLine.textContent !== said) sentLine.textContent = said;
      if (!sentBox.isConnected) askBox.replaceChildren(sentBox);
    }
    askBox.hidden = !open && !answered;
    // Nothing is being asked once it is answered, so it stops wearing what says something is.
    askBox.classList.toggle("sent", !open);
    askBox.setAttribute("aria-label", open ? "The Strike Lead is asking" : "Your answer");
  };

  /** A round already answered: its questions folded, so the thread reads as the conversation it was. */
  const asked = (entry) => el("details", { class: "lead-asked" },
    el("summary", {}, `${plural(entry.questions.length, "question")} asked`),
    el("ol", {}, ...entry.questions.map((q) => el("li", {}, q.question))));

  /** A message past a few paragraphs (a pasted brief, a long plan note) folds to its opening, with the way to the rest under it. */
  const LONG = 600;
  const textOf = (entry) => {
    const body = el("div", { class: "lead-text" }, renderMarkdown(entry.text, { project: projectId }));
    return entry.text.length <= LONG ? body : foldable(ctx, body, { more: "the whole message", height: "9.5em" });
  };
  const bubble = (entry, open) => el("li", { class: `lead-msg ${entry.who === "you" ? "you" : entry.who === "Maverick" ? "sys" : "sl"}${entry.error ? " error" : ""}` },
    el("p", { class: "lead-who" }, entry.who === "you" ? "you" : entry.who, el("span", { class: "lead-at" }, fmtTime(entry.at))),
    textOf(entry),
    entry.questions?.length ? (open ? el("p", { class: "lead-hint" }, "Its question is at the top of this page, waiting on you.") : asked(entry)) : null);

  /** Whether this entry's round is still open, as the server says it (`openRound`): it is the one the mission's questions name. */
  const isOpen = (chat, i) => Boolean(view?.questions?.some((q) => q.id === `round:${chat[i].at}`));
  const over = () => isEnded(view?.status);

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
      // Keyed by what it says and when, since the server folds a run of the same line into its latest.
      ...updates.map((update) => ({ key: `u${update.at}${update.text}`, at: Date.parse(update.at), update })),
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
    // A line the server folded into a later one has left the list, so it leaves the thread too.
    const keys = new Set(items.map((item) => item.key));
    for (const [key, held] of placed) {
      if (keys.has(key)) continue;
      held.node.remove();
      placed.delete(key);
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
    const key = JSON.stringify([ready, refusing.map((c) => c.name), failing.map((c) => c.name), doc.cost, doc.estimate?.minutes]);
    if (key === fireKey) return;
    fireKey = key;
    if (!ready) return fire.replaceChildren();
    if (refusing.length) return fire.replaceChildren(el("p", { class: "mv-warn" }, `The plan is ready, but the mission cannot run without ${refusing.map((c) => c.name).join(", ")}. The gate below says what each one needs.`));
    // Firing is a decision, not a click: asked twice, as the gate's approve is.
    // replaceChildren would print a null as the word "null"; only what is there goes in.
    fire.replaceChildren(...[
      // The gate's approve is the primary way to fire, under what it costs; this is the second way, so it is not filled.
      armed({ label: "Fire mission", cls: "lead-fire-btn", quiet: true, why: approveWhy(doc), yes: `yes, fire "${view.name}"`, onYes: () => act("approve", {}, "fired; the first milestone is out") }),
      failingNote(doc.preflight, "in the gate below", "fire"),
      el("p", { class: "lead-hint" }, "It asks once more before it fires. The briefing, the plan, its checks and what it costs are in the gate below."),
    ].filter(Boolean));
  };

  /* ---------- where links land ---------- */
  /** The inbox's answer and the lamp name `#round`: the open round comes into view with its first control focused, on a load as on a jump. */
  let scrolledTo = "";
  // As long as the flare in lead.css: reduced motion has no animation to end, so a timer clears it.
  const LANDED_MS = 480;
  const toRound = () => {
    const first = location.hash === "#round" ? askBox.querySelector(".lead-opt, .mv-note, .lead-sent") : null;
    if (!first || scrolledTo === location.hash) return;
    scrolledTo = location.hash;
    requestAnimationFrame(() => {
      askBox.scrollIntoView({ block: "nearest" });
      first.focus({ preventScroll: true });
      // Already in view, the landing would show nothing, so the card says "here" once, on every press.
      askBox.classList.remove("landed");
      void askBox.offsetWidth;
      askBox.classList.add("landed");
      setTimeout(() => askBox.classList.remove("landed"), LANDED_MS);
    });
  };
  window.addEventListener("hashchange", () => { scrolledTo = ""; toRound(); });

  /**
   * `#lead` (the rail's "write to the Strike Lead") and `#lead-<task id>` (a blocked task's "ask the
   * Strike Lead") bring the box into view with the focus in it, the task named in an empty one. A
   * press is a trip, marked with the way back; a load (the inbox's link) only lands.
   */
  let ledTo = "";
  const toLead = (jumped) => {
    const hit = location.hash.match(/^#lead(?:-(.+))?$/);
    if (!hit || !composer.isConnected || composer.hidden || ledTo === location.hash) return;
    ledTo = location.hash;
    const taskId = hit[1] ? decodeURIComponent(hit[1]) : "";
    if (taskId && !box.value.trim()) box.value = `About ${taskId}: `;
    requestAnimationFrame(() => {
      if (!jumped || !showMe(composer, { back: taskId ? "back to the question" : "back" })) composer.scrollIntoView({ block: "center" });
      box.focus({ preventScroll: true });
      box.setSelectionRange(box.value.length, box.value.length);
    });
  };
  window.addEventListener("hashchange", () => { ledTo = ""; toLead(true); });
  /** The open round's size, as the server says it is open. */
  const openRound = () => {
    const chat = view?.chat ?? [];
    return chat.length && isOpen(chat, chat.length - 1) ? chat.at(-1).questions.length : 0;
  };
  const paintNow = () => {
    const roundOpen = openRound();
    const fireReady = Boolean(fire.querySelector(".lead-fire-btn, .mv-confirm"));
    nowBox.hidden = roundOpen || !fireReady;
    paintAsk();
    // One primary at a time: while a round or a plan waits, the composer's send steps back too.
    send.classList.toggle("primary", !roundOpen && !fireReady);
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
    paintNow();
    toRound();
    toLead(false);
  };

  return { node, update, land: () => toLead(false) };
};
