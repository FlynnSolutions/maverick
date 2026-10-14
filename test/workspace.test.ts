/**
 * The workspace lists missions without opening them, so each one has to carry what it asks,
 * its word, and its merged diff as a line. The diff is read from real branches here, since a
 * stat parsed wrong reads as a plausible number rather than an error.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { tempRepo } from "./fixtures.ts";

// config.ts reads this once when the module graph loads, so it is set before the import below.
const dir = mkdtempSync(join(tmpdir(), "mv-workspace-"));
process.env.SESSION_CONSOLE_SESSIONS = dir;
mkdirSync(join(dir, "missions", "w"), { recursive: true });
const { workspaceMissions } = await import("../src/missions.ts");

const project = { id: "w", name: "W", path: "/tmp", trackers: [] } as never;
const { dir: repo, git } = tempRepo("mv-workspace-repo");
const base = git("rev-parse", "HEAD").trim();

/** A branch off the base with one commit: `lines` new lines in its own file, and `cut` lines taken out of `shared.txt`. */
git("checkout", "-q", "-b", "seed");
writeFileSync(join(repo, "shared.txt"), "a\nb\nc\nd\n");
git("add", ".");
git("commit", "-q", "-m", "seed");
const seeded = git("rev-parse", "HEAD").trim();
const branch = (name: string, lines: number, cut: number) => {
  git("checkout", "-q", "-b", name, seeded);
  writeFileSync(join(repo, `${name}.txt`), Array.from({ length: lines }, (_, i) => `${i}\n`).join(""));
  writeFileSync(join(repo, "shared.txt"), ["a", "b", "c", "d"].slice(cut).map((l) => `${l}\n`).join(""));
  git("add", ".");
  git("commit", "-q", "-m", name);
};
branch("t1", 3, 1);
branch("t2", 5, 2);
branch("t3", 7, 0);

const task = (id: string, status: string, extra: object = {}) =>
  ({ id, title: id, intent: "i", repo: "root", status, attempts: 1, branch: id, base: seeded, ...extra });

const seed = async (id: string, milestones: object[], status = "flying") =>
  writeFile(join(dir, "missions", "w", `${id}.json`), JSON.stringify({
    id, project: "w", name: id, brief: "b", status, created: "2026-01-01T00:00:00Z",
    approved: "2026-01-01T00:00:00Z", plan: "p.md", trackerIndex: 0, land: "merge", rev: 1,
    repos: [{ label: "root", path: repo, base, branch: "seed" }],
    milestones,
  }), "utf8");

test("a mission carries its word, its questions, and +N −M over the passed tasks of merged milestones only", async () => {
  await seed("merged", [
    { n: 1, title: "one", done: "d", merged: "2026-01-02T00:00:00Z", tasks: [task("t1", "passed"), task("t2", "passed")] },
    { n: 2, title: "two", done: "d", tasks: [task("t3", "handed-back", { verdict: "fail", note: "the proof did not run" })] },
  ]);
  const m = (await workspaceMissions(project)).find((x) => x.id === "merged");
  assert.ok(m, "the mission is listed");
  // t1: +3 new, -1 shared; t2: +5 new, -2 shared. t3 is unmerged, so its +7 is not counted.
  assert.equal(m.diffstat, "+8 −3");
  assert.equal(m.word, "waiting for you");
  assert.deepEqual(m.questions.map((q) => q.id), ["task:t3"]);
  assert.equal(m.questions[0].answers[0].path, "tasks/t3/retry");
});

test("a mission with nothing merged has an empty diffstat, and nothing to ask while it works", async () => {
  await seed("unmerged", [{ n: 1, title: "one", done: "d", tasks: [task("t1", "passed"), task("t2", "flying")] }]);
  const m = (await workspaceMissions(project)).find((x) => x.id === "unmerged");
  assert.ok(m);
  assert.equal(m.diffstat, "");
  assert.equal(m.word, "working");
  assert.deepEqual(m.questions, []);
});
