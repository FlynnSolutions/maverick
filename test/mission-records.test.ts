/**
 * One torn record broke every mission page in every project, for five minutes at a time: the
 * write landed in place, so two overlapping writes left the tail of the longer after the shorter;
 * the gate's estimate read every project's records, so the one bad file failed every view; and
 * the failed reading was kept for five minutes, so it outlived the repair.
 */
import assert from "node:assert/strict";
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// config.ts reads this once when the module graph loads, so it is set before the import below.
const dir = mkdtempSync(join(tmpdir(), "mv-records-"));
process.env.SESSION_CONSOLE_SESSIONS = dir;
const { config } = await import("../src/config.ts");
const { StaleMissionError, __writeMissionForTest, listMissions, measuredPace, readMission } = await import("../src/missions.ts");

const folder = (project: string) => {
  const where = join(dir, "missions", project);
  mkdirSync(where, { recursive: true });
  return where;
};
const mission = (id: string, project: string, tasks: unknown[] = []) => ({
  id, project, name: id, brief: "b", status: "flying", created: "2026-10-01T09:00:00Z",
  plan: "p.md", trackerIndex: 0, land: "merge", repos: [], rev: 1, milestones: [{ n: 1, title: "m", done: "d", tasks }],
});
const passed = (where: string) => {
  const findings = join(where, "rio.md");
  writeFileSync(findings, "verdict: pass\n", "utf8");
  utimesSync(findings, new Date("2026-10-01T10:10:00Z"), new Date("2026-10-01T10:10:00Z"));
  // Six minutes building, four reviewing.
  return { id: "m1-t1", status: "passed", attempts: 1, started: "2026-10-01T10:00:00Z", ended: "2026-10-01T10:06:00Z", review: { claudeId: "r", started: "2026-10-01T10:06:00Z", file: findings } };
};

/** What the incident left on disk: a shorter record written in place over a longer one, without truncating. */
const tear = (path: string, longer: object, shorter: object) => {
  writeFileSync(path, JSON.stringify(longer, null, 2), "utf8");
  const fd = openSync(path, "r+");
  writeSync(fd, JSON.stringify(shorter, null, 2));
  closeSync(fd);
};

test("a record is replaced whole: overlapping writes of different lengths always leave one that reads, and no temp file behind", async () => {
  const where = folder("overlap");
  const seeded = mission("race", "overlap");
  writeFileSync(join(where, "race.json"), JSON.stringify(seeded), "utf8");
  const before = statSync(join(where, "race.json")).ino;

  // Every copy carries the same rev, so each passes the check before any lands; the long and short ones interleave.
  const copies = Array.from({ length: 24 }, (_, i) => ({ ...seeded, trouble: i % 2 ? "short" : "x".repeat(4000 + i) }));
  const settled = await Promise.allSettled(copies.map((c) => __writeMissionForTest(c as never)));
  assert.ok(settled.some((s) => s.status === "fulfilled"), "a write landed");
  for (const s of settled) if (s.status === "rejected") assert.ok(s.reason instanceof StaleMissionError, `only a stale write is refused, got ${s.reason}`);

  const landed = JSON.parse(readFileSync(join(where, "race.json"), "utf8"));
  assert.equal(landed.rev, 2, "one whole record, not a mix");
  assert.ok(copies.some((c) => c.trouble === landed.trouble), "and it is one of the records written");
  assert.notEqual(statSync(join(where, "race.json")).ino, before, "the record was renamed into place, not written over");
  assert.deepEqual(readdirSync(where), ["race.json"], "no temp file is left in the folder");
});

test("a torn record is left out of every listing and named once, and the other missions still list and measure", async (t) => {
  const where = folder("torn");
  writeFileSync(join(where, "good.json"), JSON.stringify(mission("good", "torn", [passed(where)])), "utf8");
  const torn = join(where, "rental-watch.json");
  tear(torn, { ...mission("rental-watch", "torn"), trouble: "a longer line than the one written over it" }, mission("rental-watch", "torn"));
  assert.throws(() => JSON.parse(readFileSync(torn, "utf8")), SyntaxError, "the fixture really is torn");

  const said = t.mock.method(console, "error", () => {});
  assert.deepEqual((await listMissions("torn")).map((m) => m.id), ["good"], "the readable mission still lists");
  assert.deepEqual((await listMissions("torn")).map((m) => m.id), ["good"]);
  assert.deepEqual(await measuredPace(0), { minutesPerTask: 10, retryRate: 0, tasks: 1 }, "the estimate reads past the bad file");
  assert.equal(said.mock.callCount(), 1, "named once, not on every listing");
  assert.match(String(said.mock.calls[0].arguments[0]), /rental-watch\.json/, "by its path");

  await assert.rejects(() => readMission("torn", "rental-watch"), SyntaxError, "its own page still fails loud");
});

test("a failed pace reading is not kept: the next read after the repair answers", async () => {
  const was = config.sessionsDir;
  config.sessionsDir = mkdtempSync(join(tmpdir(), "mv-pace-"));
  const where = join(config.sessionsDir, "missions", "locked");
  mkdirSync(where, { recursive: true });
  writeFileSync(join(where, "m.json"), JSON.stringify(mission("m", "locked", [passed(where)])), "utf8");
  try {
    chmodSync(where, 0o000);
    await assert.rejects(() => measuredPace(), /EACCES/, "a folder that cannot be read fails the reading");
    chmodSync(where, 0o755);
    assert.deepEqual(await measuredPace(), { minutesPerTask: 10, retryRate: 0, tasks: 1 }, "within the five minutes, the repair is seen");
  } finally {
    chmodSync(where, 0o755);
    config.sessionsDir = was;
  }
});
