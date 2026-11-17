/**
 * The sweep writes the record only when something on it moved, and a person's button that loses
 * a race to a sweep's write is done again on the fresh record rather than failed to them. A
 * mission reached rev 10,159 in two days, one write every fifteen seconds while nothing moved,
 * and "send it out again" came back "changed underneath this write". The real `src/missions.ts`
 * and the real sweep with a fake `claude` first on PATH and real git in temp repos.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mock, test } from "node:test";
import { flightHarness, valueOf } from "./flight-harness.ts";
import { tempRepo } from "./fixtures.ts";

// config.ts reads its environment once when the module graph loads, so this runs before the imports below.
const { made, scratch, sessions, bin, listing, spawned } = flightHarness("mv-quiet");
const { approveMission, parsePlan, retryTask, sweepMissions, sweepSoon } = await import("../src/missions.ts");
const { planOnBranch } = await import("../src/briefs.ts");

const allSpawns = () => spawned().map(({ id, cwd, args }) => ({ id, cwd, name: valueOf(args, "--name") ?? "" }));

/** Two milestones, so the first has merged and owes its walk while the mission is still flying: the window the sweep re-merged in. */
const PLAN = `# Mission: quiet

An invented mission.

## Milestone 1: the first

_done when: the first exists_
_walk: open the first_

- [ ] **Base the first**
  - touches: src/first.txt
  Write the first.

## Milestone 2: the second

_done when: the second exists_
_walk: open the second_

- [ ] **Base the second**
  - touches: src/second.txt
  Write the second.
`;

/**
 * In front of the harness's fake: the first `claude <word>` writes the record as a sweep would,
 * moving `rev` and a field of its own, then the call goes on as usual. `word` is `stop` for the
 * write that lands before a claim and `--bg` for the one that lands while a Wingman is spawning.
 */
const race = scratch("race");
writeFileSync(join(race, "bump.mjs"), `import { readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const m = JSON.parse(readFileSync(file, "utf8"));
writeFileSync(file, JSON.stringify({ ...m, escalation: "the sweep was here", rev: (m.rev ?? 0) + 1 }, null, 2) + "\\n");
`, "utf8");
writeFileSync(join(race, "claude"), `#!/bin/sh
if [ -n "$MV_RACE_ON" ] && [ "$1" = "$MV_RACE_ON" ] && mkdir "$MV_RACE_LOCK" 2>/dev/null; then node "${join(race, "bump.mjs")}" "$MV_RACE_FILE"; fi
exec "${join(bin, "claude")}" "$@"
`, "utf8");
chmodSync(join(race, "claude"), 0o755);
process.env.PATH = `${race}:${process.env.PATH}`;

/** One mission on a project of its own, approved and flying its first task. */
const flow = async (id: string) => {
  const { dir: root, git } = tempRepo(`mv-quiet-${id}`);
  made.push(root);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write("deliverables/CHECKLIST.md", "# Checklist\n\n## 🔥 Priority\n\n## 📋 Backlog\n");
  // The gate refuses a mission whose agents have no standing orders; the project carries its own, as mission-flight's does, so no machine's ~/.claude decides it.
  write(".claude/agents/wingman.md", "a wingman\n");
  write(".claude/agents/rio.md", "a rio\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the project");
  write(`deliverables/missions/${id}.md`, PLAN);
  const project = { id: `p-${id}`, name: "P", path: root, trackers: [{ label: "CHECKLIST", path: join(root, "deliverables/CHECKLIST.md") }] } as never;
  const file = join(sessions, "missions", `p-${id}`, `${id}.json`);
  const seeded = {
    id, project: `p-${id}`, name: id, brief: "a line", status: "planned", created: new Date().toISOString(), plan: `deliverables/missions/${id}.md`,
    repos: [], land: "merge", trackerIndex: 0, lead: { sessionId: `lead-${id}`, started: new Date().toISOString() }, chat: [],
    milestones: parsePlan(PLAN, ["root"]).milestones, rev: 2,
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");
  await approveMission(project, id);

  const finished = new Set<string>();
  const record = () => JSON.parse(readFileSync(file, "utf8"));
  const task = () => record().milestones[0].tasks[0];
  /** One real pass. `sweepSoon` drops the agent listing, and its timer is unref'd, so something here has to hold the loop open. */
  const sweep = (): Promise<void> => new Promise((resolve, reject) => {
    writeFileSync(listing, JSON.stringify(allSpawns().map((s) => ({ id: s.id, sessionId: `session-${s.id}`, cwd: s.cwd, kind: "background", state: finished.has(s.id) ? "done" : "working", ...(finished.has(s.id) ? {} : { pid: 4242 }) }))), "utf8");
    const open = setInterval(() => undefined, 1_000);
    sweepSoon(project, (p) => sweepMissions(p).then(() => { clearInterval(open); resolve(); }, (err) => { clearInterval(open); reject(err); }), 0);
  });
  /** The record's rev and the file's mtime: what a write that should not have happened moves. */
  const stamp = () => ({ rev: record().rev, mtime: statSync(file).mtimeMs });
  const spawns = () => allSpawns().filter((s) => s.cwd.startsWith(root));
  return {
    id, project, root, file, record, task, sweep, stamp, spawns,
    ledger: () => readFileSync(planOnBranch(root, `deliverables/missions/${id}.md`, record().repos), "utf8"),
    /** The Wingman's part: a commit on the task's branch, then its agent finished. */
    wingman: (): void => {
      const { worktree, claudeId } = task();
      mkdirSync(join(worktree, "src"), { recursive: true });
      writeFileSync(join(worktree, "src/first.txt"), "the first\n", "utf8");
      execFileSync("git", ["-C", worktree, "add", "--", "src/first.txt"]);
      execFileSync("git", ["-C", worktree, "commit", "-q", "-m", "the first"]);
      finished.add(claudeId);
    },
    /** The RIO's part: its verdict where the record says, then its agent finished. */
    rio: (findings: string): void => {
      const { review } = task();
      writeFileSync(review.file, findings, "utf8");
      finished.add(review.claudeId);
    },
  };
};

test("a sweep over a mission where nothing moved leaves its rev and its mtime alone, and one that moves something writes once", { timeout: 120_000 }, async () => {
  const f = await flow("quiet-still");
  assert.equal(f.task().status, "flying");
  const approved = f.stamp();
  // The listing now gives the Wingman a session id: one thing moved, so one write.
  await f.sweep();
  assert.equal(f.task().sessionId, `session-${f.task().claudeId}`);
  assert.equal(f.record().rev, approved.rev + 1, "the pass that seated the session wrote once");
  const seated = f.stamp();
  for (let i = 0; i < 3; i += 1) await f.sweep();
  assert.deepEqual(f.stamp(), seated, "three passes with nothing new wrote nothing");
});

test("a merged milestone is merged and logged once, and the passes after it while it waits on its walk write nothing", { timeout: 120_000 }, async () => {
  const f = await flow("quiet-merge");
  f.wingman();
  await f.sweep();
  assert.equal(f.task().status, "reviewing");
  f.rio("verdict: pass\n");
  await f.sweep();
  const m1 = f.record().milestones[0];
  assert.ok(m1.merged, "merged");
  assert.ok(m1.walkthrough?.claudeId, "and its builder went");
  assert.equal(f.record().status, "flying", "milestone 2 is still to come, so the sweep still flies it");
  const merged = f.stamp();
  // A pass a few minutes on: one that merged again restamped `merged`, and the ledger logged the merge again under the new minute.
  mock.timers.enable({ apis: ["Date"], now: Date.now() + 3 * 60_000 });
  try {
    await f.sweep();
    await f.sweep();
  } finally {
    mock.timers.reset();
  }
  const lines = f.ledger().split("\n").filter((l) => / merged: milestone 1 /.test(l));
  assert.equal(lines.length, 1, `the merge is in the ledger once:\n${lines.join("\n")}`);
  assert.equal(f.record().milestones[0].merged, m1.merged, "merged once, when it merged");
  assert.deepEqual(f.record().milestones[0].mergeShas, m1.mergeShas);
  assert.deepEqual(f.stamp(), merged, "nothing moved, so nothing was written");
});

/** A task the RIO failed for good, back with the person, and the race armed to fire on `word`. */
const handedBack = async (id: string, word: string) => {
  const f = await flow(id);
  const m = f.record();
  Object.assign(m.milestones[0].tasks[0], { status: "handed-back", attempts: 2, note: "the RIO said fail after 2 attempts" });
  writeFileSync(f.file, `${JSON.stringify(m, null, 2)}\n`, "utf8");
  Object.assign(process.env, { MV_RACE_ON: word, MV_RACE_LOCK: join(scratch(`${id}-lock`), "fired"), MV_RACE_FILE: f.file });
  return f;
};

const disarm = (): void => { delete process.env.MV_RACE_ON; };

test("send it out again, refused at its claim by a sweep's write, is done again on the fresh record and sends one Wingman", { timeout: 120_000 }, async () => {
  const f = await handedBack("quiet-claim", "stop");
  const before = f.spawns().length;
  try {
    const out = await retryTask(f.project, f.id, "m1-t1");
    assert.equal(out.milestones[0].tasks[0].status, "flying");
  } finally {
    disarm();
  }
  assert.ok(existsSync(process.env.MV_RACE_LOCK!), "the sweep's write really landed in the window");
  const after = f.record();
  const task = after.milestones[0].tasks[0];
  assert.deepEqual([task.status, task.attempts], ["flying", 2]);
  assert.equal(after.escalation, "the sweep was here", "the sweep's write was built on, not undone");
  const sent = f.spawns().slice(before);
  assert.deepEqual(sent.map((s) => s.name), [`${f.id} · Base the first (retry 2)`], "one Wingman, not one per attempt");
  assert.equal(task.claudeId, sent[0].id, "and the record names it");
  assert.equal(after.status, "flying");
});

test("send it out again, refused after its Wingman went out, keeps that Wingman on the record and still succeeds", { timeout: 120_000 }, async () => {
  const f = await handedBack("quiet-spawn", "--bg");
  const before = f.spawns().length;
  try {
    await retryTask(f.project, f.id, "m1-t1");
  } finally {
    disarm();
  }
  assert.ok(existsSync(process.env.MV_RACE_LOCK!), "the sweep's write really landed in the window");
  const after = f.record();
  const task = after.milestones[0].tasks[0];
  const sent = f.spawns().slice(before);
  assert.equal(sent.length, 1, "one Wingman");
  assert.deepEqual([task.status, task.claudeId, task.attempts], ["flying", sent[0].id, 2]);
  assert.equal(after.escalation, "the sweep was here");
  assert.equal(after.status, "flying", "settled on the fresh record");
  assert.ok(existsSync(join(sessions, `bg-${sent[0].id}.json`)), "and its session record was written, so it shows in the rack");
});
