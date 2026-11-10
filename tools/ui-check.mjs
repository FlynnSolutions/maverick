#!/usr/bin/env node
/**
 * The page check CI runs on every pull request: the app rendered on the invented Harbor project,
 * one real write made through the page, and the tracker read back from the commit it made. Then the
 * command center walked at the size a real project reaches: 130 ended sessions and a live mission.
 * Then that mission reached in one press from the Board, the Calendar and its crew tab, at 1280 and 390.
 * Then a question from the Strike Lead answered from the first screen, and read back from the server.
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

const WORKSPACE = "/?project=harbor&view=workspace";
const ENDED = 130;
const MISSION = "Dredge the channel";

/**
 * What a person comes to the command center for, from a cold open at 1280x800: the way back to the
 * mission on the first screen, the finished sessions out of the way but findable, labelled columns,
 * controls a pointer's size. Answers "ok" or the first thing in the way.
 */
const walk = join(out, "walk.js");
writeFileSync(walk, `(async () => {
  ${UNTIL}
  const tab = await until(() => document.querySelector(".archive-tab"), 15000);
  if (!tab) return "error: no Archive tab";
  const link = document.querySelector(".cc-mission");
  if (!link || !link.textContent.includes(${JSON.stringify(MISSION)})) return "error: no link to the mission";
  if (link.getBoundingClientRect().bottom > innerHeight) return "error: the mission link is below the first screen";
  if (tab.getBoundingClientRect().bottom > innerHeight) return "error: the Archive tab is below the first screen";
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
  const at = await until(() => document.querySelector(crew ? ".rack.crew-mission .strip" : ".boards > .cc-missions .cc-mission"), 15000);
  if (!at) return "error: no mission on " + location.search;
  if (!at.textContent.includes(${JSON.stringify(MISSION)})) return "error: the mission shown is not the live one: " + at.textContent;
  if (at.getBoundingClientRect().bottom > innerHeight) return "error: the mission is below the first screen on " + location.search;
  // The row is one line however many fly, so it never pushes the page under it down.
  const row = at.closest(".cc-missions");
  if (row && row.getBoundingClientRect().height > at.getBoundingClientRect().height + 4) return "error: the Missions row takes more than one line on " + location.search;
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

const harbor = await startHarbor({ ended: ENDED });
/**
 * A page walked in headless Chrome: its script's answer. Run without blocking this loop, so the
 * server's kept-alive sockets are seen to close while it walks, and the next request opens a fresh one.
 */
const cdp = async (path, script, w, h) =>
  (await promisify(execFile)(process.execPath, [join(root, "tools", "cdp.mjs"), `${harbor.url}${path}`, "--eval", script, "--w", String(w), "--h", String(h), "--wait", "500"], { encoding: "utf8" })).stdout.trim();
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
    const walked = await cdp(WORKSPACE, walk, 1280, 800);
    console.log(`the command center walked: ${walked}`);
    if (!walked.endsWith("ok")) failed = `the command center walk: ${walked}`;
  }
  if (!failed) {
    seedRound(harbor, missionId);
    const walking = cdp(missionPage(), ask, 1280, 800);
    // The answer reaches the server through the page; then the Strike Lead's reply reaches the page through the stream.
    const answered = await until(async () => (await (await fetch(`${harbor.url}/api/missions/${missionId}?project=harbor`)).json()).chat.some((entry) => entry.who === "you" && entry.text.includes(ANSWER)), 20000);
    // A retry that worked: a reply once the failed turn has landed and the page has had time to show it.
    if (answered && await until(async () => (await (await fetch(`${harbor.url}/api/missions/${missionId}?project=harbor`)).json()).chat.at(-1).error, 15000)) {
      await new Promise((r) => setTimeout(r, 2500));
      addToChat(harbor, missionId, { text: "Slack tide it is." });
    }
    const asked = await walking;
    console.log(`the Strike Lead's question answered: ${asked}`);
    if (!answered) failed = "the server has no answer from the card";
    else if (!asked.includes("ok: ")) failed = `the question walk: ${asked}`;
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
    // The key states, after the write: the board with the new card, an item's drawer, the picker,
    // the command center under its real weight, folded and open, and a question being asked.
    const manifest = { base: harbor.url, routes: [
      { id: "board", path: BOARD, states: [
        { id: "default", steps: [{ waitFor: ".lane .card", timeout: 15000 }], expect: ".lane .card" },
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
        { id: "default", steps: [{ waitFor: ".boards > .cc-missions", timeout: 15000 }, { wait: 700 }], expect: ".boards > .cc-missions" },
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
