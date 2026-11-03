/**
 * Every route that writes, over HTTP against a real server on the invented Harbor project. The
 * board's promise is that each change is one commit in the tracker's own repo, so each test
 * reads the commit back: its subject, the one file it touched, and the tracker as it now reads.
 * The UI audits ran against a preview that refuses writes; this is where a write is seen working.
 *
 * One server for the file, and the tests run in order on its state: undo moves back what the
 * move moved, the ship step runs on the ship started before it, and close closes what approve flew.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Mission } from "../src/missions.ts";
import type { ShipRun } from "../src/ships.ts";
import type { Item, Section } from "../src/trackers.ts";
import { startHarbor, type Harbor } from "./harbor.ts";

let harbor: Harbor;
before(async () => { harbor = await startHarbor(); });
after(async () => { await harbor.stop(); });

const post = async (path: string, body: unknown = {}): Promise<{ status: number; json: Record<string, unknown> }> => {
  const res = await fetch(`${harbor.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const board = async (): Promise<Section[]> => ((await (await fetch(`${harbor.url}/api/board?project=harbor`)).json()) as Array<{ sections: Section[] }>)[0].sections;
const find = async (title: string): Promise<Item & { heading: string; group: string }> => {
  for (const s of await board()) for (const g of s.groups) for (const i of g.items) if (i.title === title) return { ...i, heading: s.heading, group: g.name };
  throw new Error(`no item "${title}" on the board`);
};
/** What every item route takes to name the item, checked against the file so a stale board cannot act on the wrong line. */
const at = (item: Item) => ({ project: "harbor", tracker: 0, itemStart: item.start, itemFirstLine: item.firstLine });
const tracker = () => readFileSync(harbor.tracker, "utf8");
const sha = () => harbor.git("rev-parse", "--short", "HEAD").trim();

/** The write answered, its commit is the newest, it says what it did, and it touched the tracker and nothing else. */
const committed = (res: { status: number; json: Record<string, unknown> }, subject: string) => {
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(sha(), res.json.commit, "the route answers with the commit it made");
  assert.equal(harbor.head(), subject);
  assert.equal(harbor.git("show", "--name-only", "--format=", "HEAD").trim(), "deliverables/CHECKLIST.md");
  assert.equal(harbor.git("status", "--porcelain"), "", "nothing left loose");
};
/** A refused write says why and leaves the repo exactly as it was. */
const refused = async (write: () => Promise<{ status: number; json: Record<string, unknown> }>, why: RegExp): Promise<number> => {
  const head = sha();
  const res = await write();
  assert.notEqual(res.status, 200);
  assert.match(String(res.json.error), why);
  assert.equal(sha(), head, "no commit");
  assert.equal(harbor.git("status", "--porcelain"), "", "nothing left loose");
  return res.status;
};

test("POST /api/items adds the item under its group and commits it", async () => {
  const res = await post("/api/items", { project: "harbor", tracker: 0, heading: "🔥 Priority", name: "Docks", title: "Mooring fees on the receipt" });
  committed(res, 'console: add "Mooring fees on the receipt" under 🔥 Priority / Docks');
  assert.equal((await find("Mooring fees on the receipt")).group, "Docks");
});

test("POST /api/move moves the item to the lane and slot asked, and commits it", async () => {
  const res = await post("/api/move", { ...at(await find("Rotate the harbor master's key")), targetHeading: "🚧 In progress", targetGroup: "", targetIndex: 0 });
  committed(res, `console: move "Rotate the harbor master's key" to 🚧 In progress #1`);
  const lane = (await board()).find((s) => s.heading === "🚧 In progress")!.groups.flatMap((g) => g.items.map((i) => i.title));
  assert.deepEqual(lane, ["Rotate the harbor master's key", "Ferry timetable import"], "first in the lane, as asked");
});

test("undo is the move back, and it commits too", async () => {
  const res = await post("/api/move", { ...at(await find("Rotate the harbor master's key")), targetHeading: "📋 Backlog", targetGroup: "", targetIndex: 0 });
  committed(res, `console: move "Rotate the harbor master's key" to 📋 Backlog #1`);
  assert.equal((await find("Rotate the harbor master's key")).heading, "📋 Backlog");
});

test("a move from a stale board is a 409 and commits nothing", async () => {
  const status = await refused(() => post("/api/move", { project: "harbor", tracker: 0, itemStart: 3, itemFirstLine: "- [ ] **Not the line that is there**", targetHeading: "📋 Backlog", targetGroup: "", targetIndex: 0 }), /no longer/);
  assert.equal(status, 409);
});

test("POST /api/edit replaces the item's text and commits it", async () => {
  const item = await find("Tide table on the dock page");
  const res = await post("/api/edit", { ...at(item), body: item.body.replace("next two tides", "next four tides") });
  committed(res, 'console: edit "Tide table on the dock page"');
  assert.match(tracker(), /The dock page shows the next four tides\./);
  assert.doesNotMatch(tracker(), /next two tides/);
});

test("POST /api/remove takes the item off the lanes with its reason, and commits it", async () => {
  const res = await post("/api/remove", { ...at(await find("Berth numbers on the map")), reason: "the map is going away" });
  committed(res, 'console: remove "Berth numbers on the map" (the map is going away)');
  assert.equal((await find("Berth numbers on the map")).heading, "🗑️ Removed", "into the section that is not a lane");
  assert.match(tracker(), /the map is going away/, "the reason is kept in the file");
});

test("a remove without a reason is refused and commits nothing", async () => {
  const item = await find("Ferry timetable import");
  await refused(() => post("/api/remove", { ...at(item), reason: " " }), /a reason is required/);
});

/* ---------- the ship ---------- */

const shipRecord = () => JSON.parse(readFileSync(join(harbor.sessions, "ships", "harbor", "1.2.0.json"), "utf8")) as ShipRun;

test("POST /api/ships starts a run on disk and commits nothing in the project", async () => {
  const head = sha();
  const { status, json } = await post("/api/ships", { project: "harbor", version: "1.2.0" });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(shipRecord().version, "1.2.0", "the run is kept where a restart can pick it up");
  assert.equal(sha(), head, "a ship run is a record, not a commit");
  await refused(() => post("/api/ships", { project: "harbor", version: "next" }), /version must look like 1\.9\.0/);
});

test("running a ship step spawns its session and records it, still without a commit", async () => {
  const head = sha();
  const { status, json } = await post("/api/ships/1.2.0/steps/walkthrough/run?project=harbor");
  assert.equal(status, 200, JSON.stringify(json));
  const ran = shipRecord().steps.find((s) => s.id === "walkthrough")!;
  assert.equal(ran.status, "running");
  assert.equal(ran.claudeId, "a7b0c", "the session the fake claude backgrounded");
  assert.ok(existsSync(join(harbor.claudeDir, "spawns")), "a session was spawned");
  assert.equal(sha(), head);
});

/* ---------- a mission ---------- */

const PLAN = `# Mission: lighthouse

Put the lighthouse on the dock page.

## Milestone 1: the lighthouse

_done when: the dock page shows the lighthouse._
_walk: the lighthouse shows on the dock page_

- [ ] **Draw the lighthouse**
  - touches: web/dock.html
  Draw it.
`;
const missionFile = () => join(harbor.sessions, "missions", "harbor", "lighthouse.json");
const missionRecord = () => JSON.parse(readFileSync(missionFile(), "utf8")) as Mission;

test("approving a mission writes its plan into the tracker as one commit, then flies its first task", async () => {
  // The state the Strike Lead leaves at the gate: the plan written, the record waiting on a person.
  mkdirSync(join(harbor.repo, "deliverables", "missions"), { recursive: true });
  writeFileSync(join(harbor.repo, "deliverables", "missions", "lighthouse.md"), PLAN, "utf8");
  harbor.git("add", ".");
  harbor.git("commit", "-q", "-m", "harbor: the lighthouse plan");
  mkdirSync(join(harbor.sessions, "missions", "harbor"), { recursive: true });
  const planned: Partial<Mission> = { id: "lighthouse", project: "harbor", name: "lighthouse", brief: "b", status: "planned", created: "2026-11-01T09:00:00Z", plan: "deliverables/missions/lighthouse.md", repos: [], land: "merge", trackerIndex: 0, milestones: [], rev: 1 };
  writeFileSync(missionFile(), JSON.stringify(planned), "utf8");

  const { status, json } = await post("/api/missions/lighthouse/approve?project=harbor");
  assert.equal(status, 200, JSON.stringify(json));
  const plan = harbor.git("log", "-1", "--format=%h", "--fixed-strings", '--grep=console: plan mission "lighthouse"', "main").trim();
  assert.ok(plan, `the plan commit is on the base branch:\n${harbor.git("log", "--format=%s", "-5", "main")}`);
  assert.equal(harbor.git("show", "--name-only", "--format=", plan).trim(), "deliverables/CHECKLIST.md");
  assert.match(tracker(), /\*\*Draw the lighthouse\*\*[\s\S]*mission: lighthouse/, "the task is on the board, tied to its mission");
  const record = missionRecord();
  assert.equal(record.planCommit, plan, "the record names the commit");
  assert.equal(record.status, "flying");
  assert.equal(record.milestones[0].tasks[0].status, "flying", "its Wingman was spawned");
  await refused(() => post("/api/missions/lighthouse/approve?project=harbor"), /already approved/);
});

test("closing a mission at review ticks its items in one commit", async () => {
  // Merged and passed is what a RIO and the sweep would have written; no route makes it by hand.
  const record = missionRecord();
  record.status = "review";
  for (const m of record.milestones) {
    m.merged = "2026-11-01T11:00:00Z";
    for (const t of m.tasks) t.status = "passed";
  }
  writeFileSync(missionFile(), JSON.stringify(record), "utf8");
  const waived = await post("/api/missions/lighthouse/milestones/1/walkthrough?project=harbor", { waive: { note: "walked by hand on the harbor" } });
  assert.equal(waived.status, 200, JSON.stringify(waived.json));

  const { status, json } = await post("/api/missions/lighthouse/close?project=harbor");
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(harbor.git("log", "-1", "--format=%s", "main").trim(), 'console: mission "lighthouse" done (2 items)');
  assert.equal(harbor.git("rev-parse", "--short", "main").trim(), json.commit);
  assert.match(tracker(), /- \[x\] .*\*\*Draw the lighthouse\*\*/, "the task is ticked");
  assert.equal(missionRecord().status, "closed");
});
