#!/usr/bin/env node
/**
 * The page check CI runs on every pull request: the app rendered on the invented Harbor project,
 * one real write made through the page, and the tracker read back from the commit it made. Then the
 * board at a real tracker's weight: a card past the first page found, opened and dragged. Then the
 * command center walked at the size a real project reaches: 130 ended sessions and a live mission.
 * Then that mission reached in one press from the Board, the Calendar and its crew tab, at 1280 and 390.
 * Then a question from the Strike Lead answered from the first screen, and read back from the server,
 * and a message written to it from the top of the page in one press, and read back the same way.
 * Then a plan sent back and since fixed, read as settled above the fire, and one still failing read as live.
 * Then, when a ui-audit is plugged in, its grade on the key states, which must be a complete A.
 *
 *   node tools/ui-check.mjs [--out <dir>]
 *
 * The ui-audit is a slot, not a dependency: `MAVERICK_UI_AUDIT` names a folder holding a
 * ui-audit's `scripts/scan.mjs` and `scripts/grade.mjs` (flynn-core's, or your own taking the same
 * manifest and printing the same card). Unset, the grade is skipped and said so; the render and the
 * write still run. Chrome is `$CHROME`, else the macOS app.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { startHarbor } from "../test/harbor.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = parseArgs({ options: { out: { type: "string" } } }).values.out ?? join(tmpdir(), `maverick-ui-check-${process.pid}`);
mkdirSync(out, { recursive: true });

/**
 * Polls `check` (sync or async) until it gives something truthy, and gives that, or null after `ms`.
 * A check that throws is tried again: a poll's request the server reset as a page closed is one
 * miss, not the run's end. Still throwing at the deadline, it throws. Runs in Node and, as UNTIL, in the page.
 */
const until = async (check, ms) => {
  const end = Date.now() + ms;
  let failed = null;
  while (Date.now() < end) {
    try {
      const hit = await check();
      if (hit) return hit;
      failed = null;
    } catch (err) {
      failed = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (failed) throw failed;
  return null;
};
const UNTIL = `const until = ${until};`;

const TITLE = "Survey the breakwater";
const BOARD = "/?project=harbor&view=board";
const CALENDAR = "/?project=harbor&view=calendar";

/** Submit the first lane's quick-add as a person would, and report the toast the board answers with. */
const write = join(out, "write.js");
writeFileSync(write, `(async () => {
  ${UNTIL}
  const form = await until(() => document.querySelector(".quick-add"), 15000);
  if (!form) return "error: no quick-add on the board";
  form.querySelector("input").value = ${JSON.stringify(TITLE)};
  form.requestSubmit();
  const toast = await until(() => document.querySelector(".toast"), 10000);
  return toast ? toast.className + ": " + toast.textContent.trim() : "error: no toast after the add";
})()`, "utf8");

const CARDS = 320;
const DEEP = "Sound berth 287 and log its depth";
const AIMED = "Sound berth 4 and log its depth";
const AIMED_AT = "Sound berth 45 and log its depth";

/**
 * The board at a real tracker's weight, from a cold open at 1280x900, every write made through the
 * page. Each long lane draws one page with the way to the rest. A card past the page is found and
 * opened; the find clears from its field. A card moved out of what the find shows clears the find,
 * says so, and is on show; its undo puts it back. A card pushed past the page by "move down" stays on
 * show. Under a find, one card dropped on another lands just before it. An empty add says so and
 * takes it back at the next key. Answers "ok" and what the toasts said, or the first thing in the
 * way; where the cards landed is read back from the commits.
 */
const board = join(out, "board.js");
writeFileSync(board, `(async () => {
  ${UNTIL}
  const lanes = () => document.querySelectorAll(".lane");
  const backlog = () => lanes()[0];
  const cards = (lane) => [...lane.querySelectorAll(".card")];
  const titled = (lane, words) => cards(lane).find((c) => c.querySelector(".title").textContent === words);
  const box = () => document.querySelector(".board-find input");
  const find = (words) => { box().value = words; box().dispatchEvent(new Event("input", { bubbles: true })); };
  const drop = (card, list, y) => {
    const drag = new DataTransfer();
    card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: drag }));
    list.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: drag }));
    list.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: drag, clientY: y }));
  };
  const toasted = (words) => until(() => [...document.querySelectorAll(".toast:not(.leaving)")].find((t) => t.textContent.includes(words)), 10000);
  /** Opens a card's drawer and gives the drawer. */
  const open = async (card) => { card.querySelector(".title").click(); return until(() => document.querySelector(".drawer:not(.leaving)"), 5000); };
  /** Waits for the board drawn after a write. */
  const repainted = (before) => until(() => backlog() !== before && backlog(), 10000);
  const said = [];

  if (!(await until(() => document.querySelector(".lane .card"), 15000))) return "error: no cards on the board";
  if (document.documentElement.scrollHeight > 8000) return "error: the board is " + document.documentElement.scrollHeight + "px tall";
  if (cards(backlog()).length !== 20) return "error: the backlog drew " + cards(backlog()).length + " cards for a page of 20";
  if (backlog().querySelector(".lane-foot [role=status]").textContent !== "20 shown") return "error: the backlog does not say how much is on show: " + backlog().querySelector(".lane-foot").textContent;
  backlog().querySelector(".lane-foot .rack-verb").click();
  if (cards(backlog()).length !== 40) return "error: show more drew " + cards(backlog()).length + " cards";

  // Find a card past the page, open it, and clear the find from its field.
  find("berth 287");
  if (!(await until(() => cards(backlog()).length === 1, 3000))) return "error: find did not narrow the backlog to one card";
  const total = backlog().querySelector(".lane-title .count").textContent;
  if (!/^1 of \\d+$/.test(total)) return "error: under the find the backlog's head says " + total;
  if (!backlog().querySelector(".lane-foot").hidden) return "error: a lane with everything on show still has a foot";
  if (!(await open(cards(backlog())[0]))?.textContent.includes(${JSON.stringify(DEEP)})) return "error: the found card did not open";
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  if (!(await until(() => !document.querySelector(".drawer:not(.leaving)"), 3000))) return "error: Escape did not close the drawer";
  if (lanes()[2].querySelector(".lane-empty button")?.textContent !== "clear the find") return "error: a lane the find matched nothing in offers no way out";
  box().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  if (box().value || cards(backlog()).length !== 20) return "error: Escape in the field did not clear the find";

  // Move a found card out of what the find shows: the find is cleared, said in the move's toast, and the card is on show; undo puts it back.
  find("survey run 12");
  const deep = await until(() => titled(backlog(), ${JSON.stringify(DEEP)}), 3000);
  if (!deep) return "error: the find on a group's name did not show its cards";
  const drawer = await open(deep);
  const lane = drawer.querySelector("#drawer-move");
  lane.value = [...lane.options].find((o) => o.textContent.startsWith("Roadmap")).value;
  lane.dispatchEvent(new Event("change"));
  let before = backlog();
  [...drawer.querySelectorAll("button")].find((b) => b.textContent === "move").click();
  const moved = await toasted("The find is cleared");
  if (!moved) return "error: moving a card out of the find did not say the find was cleared";
  said.push(moved.querySelector("p").textContent);
  if (!(await repainted(before))) return "error: the board did not repaint after the move";
  if (box().value) return "error: the find was not cleared";
  if (!titled(lanes()[1], ${JSON.stringify(DEEP)})) return "error: the moved card is not on show on the roadmap";
  before = backlog();
  [...moved.querySelectorAll("button")].find((b) => b.textContent === "undo").click();
  const back = await toasted("back");
  if (!back) return "error: undo said nothing";
  said.push(back.querySelector("p").textContent);
  if (!(await repainted(before))) return "error: the board did not repaint after the undo";

  // Push the page's last card past the page: the lane draws on to keep it on show.
  if (cards(backlog()).length !== 20) return "error: after the undo the backlog drew " + cards(backlog()).length + " cards";
  const last = cards(backlog()).at(-1);
  const pushedTitle = last.querySelector(".title").textContent;
  const pushing = await open(last);
  before = backlog();
  [...pushing.querySelectorAll("button")].find((b) => b.textContent === "move down").click();
  const pushed = await toasted("Moved " + JSON.stringify(pushedTitle));
  if (!pushed) return "error: move down said nothing";
  said.push(pushed.querySelector("p").textContent);
  if (!(await repainted(before))) return "error: the board did not repaint after move down";
  if (cards(backlog()).slice(0, 20).some((c) => c.querySelector(".title").textContent === pushedTitle)) return "error: move down did not push the card past the page";
  if (!titled(backlog(), pushedTitle)) return "error: the card pushed past the page is not on show";

  // Under a find, drop one card on another, with unfound cards between them.
  find("berth 4");
  const aimed = await until(() => { const a = titled(backlog(), ${JSON.stringify(AIMED)}); const b = titled(backlog(), ${JSON.stringify(AIMED_AT)}); return a && b && cards(backlog()).length < 20 ? [a, b] : null; }, 3000);
  if (!aimed) return "error: the find did not narrow the backlog to the berths with a 4";
  drop(aimed[0], aimed[1].closest(".items"), aimed[1].getBoundingClientRect().top + 2);
  const landed = await toasted(${JSON.stringify(AIMED.slice(0, 20))});
  if (!landed) return "error: no toast after the drop under the find";
  said.push(landed.querySelector("p").textContent);

  // An empty add says what it wants, and the next key takes it back.
  const add = document.querySelector(".quick-add");
  add.requestSubmit();
  const input = add.querySelector("input");
  if (input.getAttribute("aria-invalid") !== "true" || !add.querySelector(".add-said").textContent) return "error: an empty add said nothing";
  input.value = "x";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (input.hasAttribute("aria-invalid") || add.querySelector(".add-said").textContent) return "error: typing did not take the empty add's words back";
  return "ok: " + said.join(" | ");
})()`, "utf8");

const WORKSPACE = "/?project=harbor&view=workspace";
const ENDED = 130;
const MISSION = "Dredge the channel";
const CREW = "Sound the channel";

/**
 * What a person comes to the command center for, from a cold open at 1280x800: the way back to the
 * mission on the first screen, the mission's own session under its row and nowhere else, the
 * finished sessions out of the way but findable, labelled columns, controls a pointer's size.
 * Answers "ok" or the first thing in the way.
 */
const walk = join(out, "walk.js");
writeFileSync(walk, `(async () => {
  ${UNTIL}
  const tab = await until(() => document.querySelector(".archive-tab"), 15000);
  if (!tab) return "error: no Archive tab";
  // The Rack draws every live mission as a strip, so the Missions row does not link it a second time.
  if (document.querySelector(".cc-mission")) return "error: the Missions row repeats a mission the Rack draws: " + document.querySelector(".cc-mission").textContent;
  const link = [...document.querySelectorAll(".rack .strip")].find((s) => s.querySelector(".strip-name")?.textContent === ${JSON.stringify(MISSION)});
  if (!link) return "error: no strip for the mission on the Rack";
  if (link.getBoundingClientRect().top > innerHeight) return "error: the mission's strip is below the first screen";
  if (tab.getBoundingClientRect().bottom > innerHeight) return "error: the Archive tab is below the first screen";
  const crew = await until(() => document.querySelector(".cc-crew"), 5000);
  if (!crew) return "error: the mission's own session is not drawn under its row";
  if (!crew.firstElementChild.textContent.includes(${JSON.stringify(MISSION)})) return "error: the crew is not under the mission's row: " + crew.firstElementChild.textContent;
  if (!crew.querySelector(".strip.crew")?.textContent.includes(${JSON.stringify(CREW)})) return "error: the mission's session is not in its crew";
  if ([...document.querySelectorAll("#project .strip:not(.crew)")].some((s) => s.textContent.includes(${JSON.stringify(CREW)}))) return "error: the mission's session is also loose in a rack";
  if (!tab.textContent.includes(${JSON.stringify(String(ENDED))})) return "error: the archive does not count the ended sessions: " + tab.textContent;
  if (document.querySelector(".rack.archive")) return "error: the archive is open on arrival";
  if (document.documentElement.scrollHeight > 1600) return "error: the page is " + document.documentElement.scrollHeight + "px tall with the archive shut";
  const missing = (scope) => ["State", "When", "Where / progress"].find((want) => ![...document.querySelectorAll(scope + " .rack-col")].some((c) => c.textContent === want && getComputedStyle(c).display !== "none"));
  if (document.querySelector(".rack-col") && missing("#project")) return "error: no column label " + missing("#project");
  const tall = [...document.querySelectorAll("#project button, .bar button")].find((b) => b.getClientRects().length && !b.closest(".strip-say") && b.getBoundingClientRect().height > 36);
  if (tall) return "error: a control is " + tall.getBoundingClientRect().height + "px tall: " + tall.textContent;
  tab.click();
  const rows = () => document.querySelectorAll(".rack.archive .strip");
  if (!(await until(() => rows().length, 5000))) return "error: the opened archive shows no session";
  if (missing(".rack.archive")) return "error: the archive has no column label " + missing(".rack.archive");
  const find = document.querySelector(".rack-find");
  const type = (words) => { find.value = words; find.dispatchEvent(new Event("input", { bubbles: true })); };
  type("berth 42");
  if (rows().length !== 1) return "error: find showed " + rows().length + " rows for one berth";
  type("no such thing");
  if (!document.querySelector(".archive-none").textContent.includes("Nothing")) return "error: a find with no match says nothing";
  type("");
  document.querySelector(".archive-tools [aria-pressed]").click();
  const shown = await until(() => (rows().length >= 30 ? rows().length : 0), 3000);
  if (shown !== 30) return "error: the archive drew " + shown + " rows for one page of 30";
  document.querySelector(".rack.archive > .rack-verb").click();
  return rows().length === 60 ? "ok" : "error: show more drew " + rows().length + " rows";
})()`, "utf8");

/**
 * A live mission reached in one press from wherever the app reopens: the Board, the Calendar and the
 * mission's own crew tab each show it on the first screen, and one press goes to its page (held at
 * the door, so the walk can read where it was going).
 */
const reach = join(out, "reach.js");
const writeReach = (want) => writeFileSync(reach, `(async () => {
  ${UNTIL}
  const crew = new URLSearchParams(location.search).has("formation");
  const at = await until(() => document.querySelector(crew ? ".rack.crew-mission .strip" : ".boards .cc-missions .cc-mission"), 15000);
  if (!at) return "error: no mission on " + location.search;
  if (!at.textContent.includes(${JSON.stringify(MISSION)})) return "error: the mission shown is not the live one: " + at.textContent;
  if (at.getBoundingClientRect().bottom > innerHeight) return "error: the mission is below the first screen on " + location.search;
  // Every mission is shown or counted: the label says how many the row holds, however many it scrolls past.
  const row = at.closest(".cc-missions");
  if (row && !row.firstChild.textContent.includes("· " + row.querySelectorAll(".cc-mission").length)) return "error: the Missions label does not count its links: " + row.firstChild.textContent;
  // The missions never cost the calendar its week: today's whole row is on the first screen.
  const todayCell = document.querySelector(".cal-cell.today");
  if (todayCell && innerWidth >= 840 && todayCell.getBoundingClientRect().bottom > innerHeight) return "error: today's week runs below the first screen, its cell ending at " + todayCell.getBoundingClientRect().bottom;
  let went = null;
  navigation.addEventListener("navigate", (e) => { went = e.destination.url; e.preventDefault(); });
  (crew ? at.querySelector(".primary-act") : at).click();
  const to = await until(() => went, 3000);
  return to && new URL(to).pathname + new URL(to).search === ${JSON.stringify(want)} ? "ok" : "error: the press went to " + to;
})()`, "utf8");

const ANSWER = "At slack tide";

/**
 * With a round open, a cold open at 1280x800: the question, its context and every control that
 * answers it on the first screen, one place to answer, and the card saying where the answer went.
 */
const ask = join(out, "ask.js");
writeFileSync(ask, `(async () => {
  ${UNTIL}
  const send = await until(() => document.querySelector("#round .lead-round-foot .primary"), 15000);
  if (!send) return "error: no question card on the page";
  if (send.getBoundingClientRect().bottom > innerHeight) return "error: the send button is below the first screen";
  if (!document.querySelector("#round h2").textContent.includes("slack tide")) return "error: the card's heading is not the question";
  if (!document.querySelector("#round .lead-context")) return "error: the question's context is not on the card";
  if ([...document.querySelectorAll("button")].some((b) => /answer (it|them|in the chat)/.test(b.textContent))) return "error: something still points at the answer instead of being it";
  [...document.querySelectorAll("#round .lead-opt")].find((b) => b.textContent === ${JSON.stringify(ANSWER)}).click();
  send.click();
  const sent = await until(() => document.querySelector("#round .lead-sent"), 10000);
  if (!sent) return "error: the card did not say the answer went";
  // Harbor's stand-in for claude prints nothing a turn can read, so the turn fails first, and says so.
  if (!(await until(() => sent.textContent.includes("did not answer"), 15000))) return "error: the card did not say the turn failed: " + sent.textContent;
  const wrote = await until(() => sent.textContent.includes("wrote back"), 15000);
  return wrote ? "ok: " + sent.textContent : "error: the card did not say the Strike Lead wrote back: " + sent.textContent;
})()`, "utf8");

const WORD = "Use the long barge.";

/**
 * Something to tell the Strike Lead, from a cold open at 1280x800: the way to it on the first
 * screen, one press to its box, headed as its own, focused and marked with the way back; a second
 * press lands again, and the message sent from there reaches the server.
 */
const talk = join(out, "talk.js");
writeFileSync(talk, `(async () => {
  ${UNTIL}
  const link = await until(() => document.querySelector("#to-lead:not([hidden])"), 15000);
  if (!link) return "error: no way to the Strike Lead in the rail";
  if (link.getBoundingClientRect().bottom > innerHeight) return "error: the way to the Strike Lead is below the first screen";
  const box = document.querySelector("#lead-box");
  for (const press of ["first", "second"]) {
    if (press === "second") { document.querySelector(".show-me-back").click(); await until(() => document.activeElement === link, 3000); }
    link.click();
    if (!(await until(() => document.activeElement === box, 3000))) return "error: the " + press + " press did not put the focus in the Strike Lead's box";
    const r = box.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) return "error: the box is not in view after the " + press + " press";
    if (!document.querySelector("#lead.show-me-target")) return "error: the box is not marked after the " + press + " press";
    if (!document.querySelector(".show-me-back")) return "error: no way back after the " + press + " press";
  }
  if (document.querySelector("label[for=lead-box]")?.textContent !== "To the Strike Lead") return "error: the box is not headed as the Strike Lead's";
  box.value = ${JSON.stringify(WORD)};
  box.form.requestSubmit();
  return (await until(() => box.value === "", 10000)) ? "ok" : "error: the message did not go: " + document.querySelector(".lead-heard").textContent;
})()`, "utf8");

/** Changes a mission's record where the server reads it: `change` gives the fields to replace. */
const setMission = (harbor, id, change) => {
  const file = join(harbor.sessions, "missions", "harbor", `${id}.json`);
  const mission = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, `${JSON.stringify({ ...mission, ...change(mission) }, null, 2)}\n`, "utf8");
};
/** Adds to a mission's chat as its record holds it: what the Strike Lead says. */
const addToChat = (harbor, id, entry) =>
  setMission(harbor, id, (mission) => ({ chat: [...(mission.chat ?? []), { at: new Date().toISOString(), who: "Strike Lead", ...entry }] }));
/** A round the Strike Lead is waiting on. */
const seedRound = (harbor, id) => addToChat(harbor, id, { text: "The survey is back, and the tide decides the plan.", questions: [
  { id: "tide", question: "Dredge at slack tide or at night?", options: [ANSWER, "At night"], context: "Slack tide is safer for the barge. Night keeps the channel open by day." },
] });

const SURVEY = "Chart the breakwater";
/** A plan Harbor's Strike Lead could write: it parses clean, and its one person-only step is a long line. */
const SURVEY_PLAN = (done) => `# Mission: ${SURVEY}

Sound the breakwater and chart it.

## Milestone 1: the breakwater is charted
${done ? "\n_done when: every stretch of the breakwater has a depth on the chart._" : ""}
_walk: open the chart and read the depth at the lighthouse._

- [ ] **Sound the breakwater**
  Sound each stretch and write its depth into the chart file.

## Preflight

- human: walk the breakwater with the harbor master at low water and sign the survey sheet before anything is charted
`;
/** Maverick's own send-back, worded as the server words it. */
const sendBack = (problems) => ({ who: "Maverick", sentBack: true, text: `The plan cannot be flown as written. Fix these in the plan, then say it is ready again:\n${problems.map((p) => `- ${p}`).join("\n")}` });

/** Still failing: the send-back the Strike Lead is on reads as live, its problems in sight; the one before it as checked again; no fire. */
const sentBackLive = join(out, "sent-back-live.js");
writeFileSync(sentBackLive, `(async () => {
  ${UNTIL}
  const live = await until(() => document.querySelector(".lead-msg.sent-back.live"), 15000);
  if (!live) return "error: the failing plan's send-back does not read as live";
  if (!live.querySelector(".lead-text li")?.checkVisibility()) return "error: the live send-back hides its problems";
  if (document.querySelectorAll(".lead-msg.sent-back.live").length !== 1) return "error: more than one send-back reads as live";
  if (!document.querySelector(".lead-msg.sent-back.replaced")) return "error: the earlier send-back does not say it was checked again";
  return document.querySelector(".lead-fire-btn") ? "error: Fire is offered on a plan that cannot fly" : "ok";
})()`, "utf8");

/** Fixed: every send-back reads as settled, folded, above a Fire that is there; a long check name leaves no gap in the list. */
const sentBackFixed = join(out, "sent-back-fixed.js");
writeFileSync(sentBackFixed, `(async () => {
  ${UNTIL}
  const fire = await until(() => document.querySelector(".lead-fire-btn"), 15000);
  if (!fire) return "error: no Fire under the ready message";
  const backs = [...document.querySelectorAll(".lead-msg.sent-back")];
  if (backs.length !== 2) return "error: " + backs.length + " send-backs in the thread, not 2";
  const unsettled = backs.find((li) => !li.classList.contains("fixed"));
  if (unsettled) return "error: a send-back still reads as " + unsettled.className;
  if (backs.some((li) => [...li.querySelectorAll(".lead-text li")].some((p) => p.checkVisibility()))) return "error: a fixed send-back still shows its problems";
  if (!(backs.at(-1).compareDocumentPosition(fire) & Node.DOCUMENT_POSITION_FOLLOWING)) return "error: the fire is not under the send-back";
  const list = document.querySelector(".mv-preflight ul");
  const rows = [...list.children].map((li) => ({ name: li.children[1].getBoundingClientRect(), detail: li.children[2].getBoundingClientRect() }));
  const long = rows.reduce((a, b) => (b.name.height > a.name.height ? b : a));
  if (long.name.height < 30) return "error: the long check name did not wrap: " + long.name.width + "px wide";
  const column = rows[0].detail.left - rows[0].name.left;
  return column > list.getBoundingClientRect().width / 3 ? "error: the names take " + Math.round(column) + "px before every detail" : "ok";
})()`, "utf8");

const harbor = await startHarbor({ ended: ENDED, cards: CARDS });
/**
 * A page walked in headless Chrome: its script's answer. Run without blocking this loop, so the
 * server's kept-alive sockets are seen to close while it walks, and the next request opens a fresh one.
 */
const cdp = async (path, script, w, h) =>
  (await promisify(execFile)(process.execPath, [join(root, "tools", "cdp.mjs"), `${harbor.url}${path}`, "--eval", script, "--w", String(w), "--h", String(h), "--wait", "500"], { encoding: "utf8" })).stdout.trim();
/**
 * The mission as the server has it, or null for a poll that missed: the first fetch after a page
 * walk reuses a keep-alive socket the server closed while it idled, and is reset. Only that is
 * passed over; anything else the server says fails loud.
 */
const viewOf = (id) => fetch(`${harbor.url}/api/missions/${id}?project=harbor`).then((r) => r.json(), (err) => {
  if (/ECONNRESET|UND_ERR_SOCKET|other side closed/.test(`${err.cause?.code ?? ""} ${err.cause?.message ?? ""} ${err.message}`)) return null;
  throw err;
});
let failed = "";
let missionId = "";
let crewId = "";
const missionPage = () => `/mission.html?project=harbor&mission=${missionId}`;
try {
  const said = await cdp(BOARD, write, 1280, 900);
  console.log(`write through the page: ${said}`);
  // What the board promises is the line in the file, committed: read the tracker as HEAD has it.
  const tracker = relative(harbor.repo, harbor.tracker);
  if (/error/.test(said)) failed = `the page did not say the add landed: ${said}`;
  else if (!harbor.git("show", `HEAD:${tracker}`).includes(`**${TITLE}**`)) failed = `the newest commit's tracker has no "${TITLE}": ${harbor.head()}`;
  else if (harbor.git("show", "--name-only", "--format=", "HEAD").trim() !== tracker) failed = "the add's commit touched more than the tracker";
  else if (harbor.git("status", "--porcelain")) failed = "the add left the tracker uncommitted";
  else console.log(`committed: ${harbor.git("log", "-1", "--format=%h %s").trim()}`);

  if (!failed) {
    const walked = execFileSync(process.execPath, [join(root, "tools", "cdp.mjs"), `${harbor.url}${BOARD}`, "--eval", board, "--w", "1280", "--h", "900", "--wait", "500"], { encoding: "utf8" }).trim();
    console.log(`the board walked: ${walked}`);
    // The card moved to the roadmap is back in its group after the undo, and the card dropped under
    // the find landed just before the one it was dropped on, so the next item after it is that card.
    const file = harbor.git("show", `HEAD:${tracker}`);
    const at = file.indexOf(`**${DEEP}**`);
    const after = file.slice(file.indexOf(`**${AIMED}**`)).split("\n").slice(1).find((line) => line.startsWith("- ["));
    if (!walked.includes("ok: ")) failed = `the board walk: ${walked}`;
    else if (!(at > file.indexOf("### Survey run 12") && at < file.indexOf("### Survey run 13"))) failed = `the undo did not put the moved card back in its group: ${harbor.head()}`;
    else if (!after?.includes(`**${AIMED_AT}**`)) failed = `the card dropped under the find did not land where it was aimed; the next item is: ${after}`;
  }

  if (!failed) {
    const started = await fetch(`${harbor.url}/api/missions?project=harbor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: MISSION, brief: "Dredge the channel to six metres." }) });
    if (!started.ok) failed = `the mission did not start: ${started.status} ${await started.text()}`;
    else missionId = (await started.json()).mission.id;
  }
  if (!failed) {
    // Its crew: a formation, as the approval makes one, named in the record.
    const made = await fetch(`${harbor.url}/api/formations?project=harbor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: MISSION }) });
    if (!made.ok) failed = `the crew formation was not made: ${made.status} ${await made.text()}`;
    else {
      crewId = (await made.json()).id;
      setMission(harbor, missionId, () => ({ formation: crewId }));
    }
  }
  if (!failed) {
    // One of the mission's Wingmen, still running in the mission's worktree, beside the ended sessions.
    // A listed agent with no live pid reads as down, so it borrows this check's own.
    const agents = join(harbor.claudeDir, "agents.json");
    writeFileSync(agents, JSON.stringify([...JSON.parse(readFileSync(agents, "utf8")), {
      id: "crew0", sessionId: "crew-session-0", kind: "background", cwd: join(harbor.repo, "worktrees", `${missionId}-m1-t1-root`), state: "running", pid: process.pid,
      name: `${MISSION} · ${CREW}`, startedAt: Date.now() - 600_000,
    }]), "utf8");
  }
  if (!failed) {
    const walked = await cdp(WORKSPACE, walk, 1280, 800);
    console.log(`the command center walked: ${walked}`);
    if (!walked.endsWith("ok")) failed = `the command center walk: ${walked}`;
  }
  if (!failed) {
    seedRound(harbor, missionId);
    const walking = cdp(missionPage(), ask, 1280, 800);
    // The answer reaches the server through the page; then the Strike Lead's reply reaches the page through the stream.
    const answered = await until(async () => (await viewOf(missionId))?.chat.some((entry) => entry.who === "you" && entry.text.includes(ANSWER)), 20000);
    // A retry that worked: a reply once the failed turn has landed and the page has had time to show it.
    if (answered && await until(async () => (await viewOf(missionId))?.chat.at(-1).error, 15000)) {
      await new Promise((r) => setTimeout(r, 2500));
      addToChat(harbor, missionId, { text: "Slack tide it is." });
    }
    const asked = await walking;
    console.log(`the Strike Lead's question answered: ${asked}`);
    if (!answered) failed = "the server has no answer from the card";
    else if (!asked.includes("ok: ")) failed = `the question walk: ${asked}`;
  }
  if (!failed) {
    const talked = execFileSync(process.execPath, [join(root, "tools", "cdp.mjs"), `${harbor.url}/mission.html?project=harbor&mission=${missionId}`, "--eval", talk, "--w", "1280", "--h", "800", "--wait", "500"], { encoding: "utf8" }).trim();
    console.log(`told the Strike Lead from the top of the page: ${talked}`);
    const heard = await until(async () => (await viewOf(missionId))?.chat.some((entry) => entry.who === "you" && entry.text === WORD), 10000);
    if (talked !== "ok") failed = `the walk to the Strike Lead: ${talked}`;
    else if (!heard) failed = "the server has no message from the Strike Lead's box";
    // The turn the message started ends in the thread first, so it cannot land after the round seeded below and close it.
    else if (!(await until(async () => { const v = await viewOf(missionId); return v && !v.leadBusy && v.chat.at(-1).who !== "you"; }, 20000))) failed = "the Strike Lead's turn on the message never ended";
    else seedRound(harbor, missionId);
  }
  if (!failed) {
    writeReach(missionPage());
    for (const [w, h] of [[1280, 800], [390, 844]]) for (const path of [BOARD, CALENDAR, `${WORKSPACE}&formation=${crewId}`]) {
      if (failed) break;
      const reached = await cdp(path, reach, w, h);
      console.log(`the mission reached from ${path} at ${w}: ${reached}`);
      if (reached !== "ok") failed = `reaching the mission from ${path} at ${w}: ${reached}`;
    }
  }

  let surveyId = "";
  if (!failed) {
    const started = await fetch(`${harbor.url}/api/missions?project=harbor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: SURVEY, brief: "Sound the breakwater and chart it." }) });
    if (!started.ok) failed = `the survey mission did not start: ${started.status} ${await started.text()}`;
    else surveyId = (await started.json()).mission.id;
  }
  if (!failed) {
    const view = async () => (await fetch(`${harbor.url}/api/missions/${surveyId}?project=harbor`)).json();
    // The Strike Lead's first turn writes the record too; the chat is added to once it has.
    await until(async () => !(await view()).leadBusy, 15000);
    const { plan } = await view();
    const writePlan = (done) => { mkdirSync(dirname(join(harbor.repo, plan)), { recursive: true }); writeFileSync(join(harbor.repo, plan), SURVEY_PLAN(done), "utf8"); };
    const look = (script) => execFileSync(process.execPath, [join(root, "tools", "cdp.mjs"), `${harbor.url}/mission.html?project=harbor&mission=${surveyId}`, "--eval", script, "--w", "1280", "--h", "800", "--wait", "500"], { encoding: "utf8" }).trim();
    writePlan(false);
    addToChat(harbor, surveyId, sendBack(["milestone 1 has no done criterion", "\"Sound the breakwater\" names no chart file"]));
    addToChat(harbor, surveyId, { text: "I named the chart file; the plan is ready again." });
    addToChat(harbor, surveyId, sendBack(["milestone 1 has no done criterion"]));
    const live = look(sentBackLive);
    console.log(`a plan still sent back: ${live}`);
    if (live !== "ok") failed = `the live send-back: ${live}`;
    else {
      writePlan(true);
      addToChat(harbor, surveyId, { text: "Milestone 1 has its done line; the plan is ready.", planReady: true });
      const fixed = look(sentBackFixed);
      console.log(`a plan sent back and since fixed: ${fixed}`);
      if (fixed !== "ok") failed = `the fixed send-back: ${fixed}`;
    }
  }

  // A board that cannot save is not graded; the failure above is the result.
  const audit = process.env.MAVERICK_UI_AUDIT;
  if (!failed && !audit) console.log("ui-audit: no MAVERICK_UI_AUDIT set, grade skipped");
  else if (!failed) {
    // The key states, after the write: the board under its real weight with the new card, a find,
    // an item's drawer, the picker, the command center under its real weight, folded and open, and
    // a question being asked.
    const manifest = { base: harbor.url, routes: [
      { id: "board", path: BOARD, states: [
        { id: "default", steps: [{ waitFor: ".lane .card", timeout: 15000 }], expect: ".lane .card" },
        { id: "found", steps: [{ waitFor: ".lane .card", timeout: 15000 }, { eval: "const f = document.querySelector('.board-find input'); f.value = 'berth 2'; f.dispatchEvent(new Event('input', { bubbles: true }))" }, { wait: 500 }], expect: ".lane-foot [role=status]:not(:empty)" },
        { id: "item-drawer", steps: [{ waitFor: ".lane .card", timeout: 15000 }, { click: ".lane .card .title" }, { waitFor: ".drawer", timeout: 12000 }, { wait: 700 }], expect: ".drawer" },
      ] },
      { id: "workspace", path: WORKSPACE, states: [
        { id: "heavy", steps: [{ waitFor: ".archive-tab", timeout: 15000 }, { wait: 700 }], expect: ".archive-tab" },
        { id: "archive", steps: [{ waitFor: ".archive-tab", timeout: 15000 }, { click: ".archive-tab" }, { waitFor: ".rack.archive .strip", timeout: 5000 }], expect: ".rack.archive .strip" },
      ] },
      { id: "crew", path: `${WORKSPACE}&formation=${crewId}`, states: [
        { id: "default", steps: [{ waitFor: ".rack.crew-mission .strip", timeout: 15000 }, { wait: 700 }], expect: ".rack.crew-mission .strip" },
      ] },
      { id: "calendar", path: CALENDAR, states: [
        { id: "default", steps: [{ waitFor: ".calendar .cc-missions", timeout: 15000 }, { wait: 700 }], expect: ".calendar .cc-missions" },
      ] },
      { id: "mission", path: missionPage(), states: [
        { id: "asked", steps: [{ waitFor: "#round .lead-opt", timeout: 15000 }], expect: "#round .lead-opt",
          moments: [{ id: "answer-the-strike-lead", ask: "#round h2", context: "#round .lead-context", answer: "#round .lead-round-foot .primary" }] },
      ] },
      { id: "mission-ready", path: `/mission.html?project=harbor&mission=${surveyId}`, states: [
        { id: "sent-back-fixed", steps: [{ waitFor: ".lead-fire-btn", timeout: 15000 }], expect: ".lead-msg.sent-back.fixed" },
      ] },
      { id: "picker", path: "/?pick=1", states: [
        { id: "default", steps: [{ waitFor: "#picker:not([hidden]) .project-list li", timeout: 15000 }], expect: "#picker:not([hidden]) .project-list li" },
      ] },
    ] };
    writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    execFileSync(process.execPath, [join(audit, "scripts", "scan.mjs"), "--manifest", join(out, "manifest.json"), "--out", out], { stdio: "inherit" });
    const card = execFileSync(process.execPath, [join(audit, "scripts", "grade.mjs"), join(out, "scan.json")], { encoding: "utf8" });
    console.log(card);
    // An A with rows that never rendered is "A (incomplete)", which is not a pass.
    if (!/^Overall: \*\*A\*\*\s*$/m.test(card)) failed = `ui-audit did not grade every key state A (card and scan in ${out})`;
  }
} finally {
  await harbor.stop();
}
if (failed) {
  console.error(`ui-check: ${failed}`);
  process.exit(1);
}
