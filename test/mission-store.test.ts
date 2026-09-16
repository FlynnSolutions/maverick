/**
 * The brake has to hold. The sweep reads a mission, then spends minutes in `git merge` and
 * `claude --bg` before writing it back; a person pressing stop in that window used to lose,
 * and the console would insist a mission was flying whose agents were already dead.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// config.ts reads this once when the module graph loads, so it is set before the import below.
const dir = mkdtempSync(join(tmpdir(), "mv-store-"));
process.env.SESSION_CONSOLE_SESSIONS = dir;
mkdirSync(join(dir, "missions", "p"), { recursive: true });
const { StaleMissionError, __writeMissionForTest, abandonMission, readMission } = await import("../src/missions.ts");

const file = (id: string) => join(dir, "missions", "p", `${id}.json`);
const read = async (id: string) => JSON.parse(await readFile(file(id), "utf8"));
const seed = async (id: string) => {
  const m = {
    id, project: "p", name: id, brief: "b", status: "flying", created: "2026-01-01T00:00:00Z",
    approved: "2026-01-01T00:00:00Z", plan: "p.md", trackerIndex: 0, land: "merge", repos: [], rev: 1,
    milestones: [{ n: 1, title: "m", done: "d", dispatched: "2026-01-01T00:00:00Z", tasks: [
      { id: "m1-t1", title: "t", intent: "i", repo: "root", status: "flying", attempts: 1, claudeId: "aaa", worktree: "/tmp/none" }] }],
  };
  await writeFile(file(id), JSON.stringify(m), "utf8");
  return m;
};

test("abandoning a mission wins against a sweep that read it first", async () => {
  const seeded = await seed("brake");
  // The sweep's copy, taken before the brake is pulled. It is stale from here on.
  const sweepCopy = JSON.parse(JSON.stringify(seeded));

  const stopped: string[] = [];
  await abandonMission({ id: "p", name: "P", path: "/tmp", trackers: [] } as never, "brake", async (id: string) => { stopped.push(id); });

  assert.deepEqual(stopped, ["aaa"], "the live session was stopped");
  assert.equal((await read("brake")).status, "abandoned");

  // The sweep now finishes its long pass and tries to write what it believed.
  sweepCopy.trouble = "still flying, honest";
  await assert.rejects(
    () => __writeMissionForTest(sweepCopy),
    (err: Error) => err instanceof StaleMissionError,
    "a stale write must be refused, not applied",
  );
  const after = await read("brake");
  assert.equal(after.status, "abandoned", "the brake held");
  assert.equal(after.trouble?.startsWith("abandoned"), true, "and its own words survived");
  assert.equal(after.milestones[0].tasks[0].status, "handed-back");
});

test("a write carrying the current revision is accepted, and moves the caller on with it", async () => {
  await seed("rev");
  const fresh = (await readMission("p", "rev"))!;
  assert.equal(fresh.rev, 1);
  fresh.trouble = "noted";
  await __writeMissionForTest(fresh);
  assert.equal((await read("rev")).rev, 2, "a write bumps the revision");
  assert.equal(fresh.rev, 2, "and the caller's object moves with it");
  // Without that, a second write from the same object would be refused as stale.
  await __writeMissionForTest(fresh);
  assert.equal((await read("rev")).rev, 3);
});

test("a record written before revisions existed is still writable", async () => {
  const m = await seed("legacy");
  delete (m as { rev?: number }).rev;
  await writeFile(file("legacy"), JSON.stringify(m), "utf8");
  const fresh = (await readMission("p", "legacy"))!;
  assert.equal(fresh.rev, undefined);
  await __writeMissionForTest(fresh);
  assert.equal((await read("legacy")).rev, 1, "it joins the scheme rather than being rejected by it");
});
