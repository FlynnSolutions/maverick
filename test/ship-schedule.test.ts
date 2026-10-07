/**
 * The cadence is derived, not stored, so the cases that matter are the ones where a day has been
 * said something about (moved, cancelled, shipped) and the cadence underneath it then changes.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.SESSION_CONSOLE_HOME = await mkdtemp(join(tmpdir(), "mv-ship-"));
const { markDay, occurrences, readSchedule, setCadence } = await import("../src/ship-schedule.ts");

const dates = (occ: Array<{ date: string }>) => occ.map((o) => o.date);

test("a weekly cadence generates its day and nothing before the anchor", async () => {
  const s = await setCadence("p1", { everyWeeks: 1, anchor: "2026-09-24" });
  assert.deepEqual(dates(occurrences(s, "2026-09-01", "2026-10-20")), [
    "2026-09-24", "2026-10-01", "2026-10-08", "2026-10-15",
  ]);
});

test("every other week skips the week between", async () => {
  const s = await setCadence("p2", { everyWeeks: 2, anchor: "2026-09-24" });
  assert.deepEqual(dates(occurrences(s, "2026-09-24", "2026-11-05")), ["2026-09-24", "2026-10-08", "2026-10-22", "2026-11-05"]);
});

test("a cadence that is not a whole number of weeks from 1 to 12 is refused, not rounded", async () => {
  for (const bad of [0, 1.5, 13, -1, "weekly"]) {
    await assert.rejects(() => setCadence("p3", { everyWeeks: bad as number, anchor: "2026-09-24" }), /everyWeeks/);
  }
  await assert.rejects(() => setCadence("p3", { everyWeeks: 1, anchor: "next thursday" }), /ISO date/);
});

test("pushing a ship day back moves it without losing where it was meant to be", async () => {
  await setCadence("p4", { everyWeeks: 1, anchor: "2026-09-24" });
  const s = await markDay("p4", "move", "2026-10-01", { to: "2026-10-03" });
  const occ = occurrences(s, "2026-09-24", "2026-10-08");
  assert.deepEqual(dates(occ), ["2026-09-24", "2026-10-03", "2026-10-08"]);
  assert.equal(occ[1].movedFrom, "2026-10-01", "the origin is what the record is keyed to");
});

test("a day moved into the window from outside it still shows", async () => {
  await setCadence("p5", { everyWeeks: 1, anchor: "2026-09-24" });
  const s = await markDay("p5", "move", "2026-10-15", { to: "2026-09-30" });
  assert.ok(dates(occurrences(s, "2026-09-01", "2026-09-30")).includes("2026-09-30"));
});

test("cancelling takes the day off; adding it back brings it back rather than duplicating it", async () => {
  await setCadence("p6", { everyWeeks: 1, anchor: "2026-09-24" });
  let s = await markDay("p6", "remove", "2026-10-01");
  assert.deepEqual(dates(occurrences(s, "2026-09-24", "2026-10-08")), ["2026-09-24", "2026-10-08"]);
  s = await markDay("p6", "add", "2026-10-01");
  assert.deepEqual(dates(occurrences(s, "2026-09-24", "2026-10-08")), ["2026-09-24", "2026-10-01", "2026-10-08"]);
  assert.deepEqual(s.extra, [], "it came back as the cadence day it always was, not as a one-off on top of it");
});

test("a one-off ship day needs no cadence at all", async () => {
  const s = await markDay("p7", "add", "2026-09-30");
  assert.equal(s.cadence, null);
  assert.deepEqual(dates(occurrences(s, "2026-09-01", "2026-10-31")), ["2026-09-30"]);
});

test("a day that shipped survives the cadence changing under it", async () => {
  await setCadence("p8", { everyWeeks: 1, anchor: "2026-09-24" });
  await markDay("p8", "ship", "2026-10-01", { version: "1.4.0" });
  const s = await setCadence("p8", { everyWeeks: 2, anchor: "2026-11-05" });
  const shipped = occurrences(s, "2026-09-01", "2026-12-01").find((o) => o.date === "2026-10-01");
  assert.equal(shipped?.shipped?.version, "1.4.0", "what actually shipped is the part not to lose");
});

test("the file round-trips, and rubbish in it does not take the console down", async () => {
  await setCadence("p9", { everyWeeks: 2, anchor: "2026-09-24" });
  await markDay("p9", "ship", "2026-09-24", { version: "1.0.0" });
  const again = await readSchedule("p9");
  assert.equal(again.cadence?.everyWeeks, 2);
  assert.equal(again.shipped["2026-09-24"].version, "1.0.0");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(process.env.SESSION_CONSOLE_HOME!, "ship-schedule.json"), JSON.stringify({ p9: { cadence: { everyWeeks: 99, anchor: "nope" }, extra: ["x", "2026-10-01"], moved: { bad: "2026-10-02" } } }), "utf8");
  const salvaged = await readSchedule("p9");
  assert.equal(salvaged.cadence, null);
  assert.deepEqual(salvaged.extra, ["2026-10-01"]);
  assert.deepEqual(salvaged.moved, {});
});
