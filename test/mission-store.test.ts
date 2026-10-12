/**
 * The brake has to hold. The sweep reads a mission, then spends minutes in `git merge` and
 * `claude --bg` before writing it back; a person pressing stop in that window used to lose,
 * and the console would insist a mission was flying whose agents were already dead.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tempRepo } from "./fixtures.ts";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// config.ts reads this once when the module graph loads, so it is set before the import below.
const dir = mkdtempSync(join(tmpdir(), "mv-store-"));
process.env.SESSION_CONSOLE_SESSIONS = dir;
mkdirSync(join(dir, "missions", "p"), { recursive: true });
const { StaleMissionError, __writeMissionForTest, abandonMission, acceptTask, claimed, closeMission, needsWalking, parsePlan, pauseMission, readMission, recordWalkthrough, releaseMilestone, resumeMission, retryTask, walkthroughState } = await import("../src/missions.ts");

const file = (id: string) => join(dir, "missions", "p", `${id}.json`);
const project = { id: "p", name: "P", path: "/tmp", trackers: [] } as never;
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
  await abandonMission(project, "brake", async (id: string) => { stopped.push(id); });

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

test("a mission does not close until every milestone that changed something has been walked or waived", async () => {
  const m = await seed("walk");
  m.status = "review";
  m.milestones[0].merged = "2026-01-02T00:00:00Z";
  m.milestones[0].tasks[0].status = "passed";
  (m.milestones[0].tasks[0] as { commits?: string[] }).commits = ["abc one commit"];
  await writeFile(file("walk"), JSON.stringify(m), "utf8");

  await assert.rejects(() => closeMission(project, "walk"), /not walked yet: milestone 1 \(none\)/, "the gate names the milestone and why");
  assert.equal((await read("walk")).status, "review", "and nothing was ticked or landed");

  await assert.rejects(() => recordWalkthrough(project, "walk", 1, { progress: { total: 3, answered: 1, verdicts: {}, updatedAt: "2026-01-02T00:00:00Z" } }), /no walkthrough document/, "progress needs a document to be progress in");
  await assert.rejects(() => recordWalkthrough(project, "walk", 1, { waive: { note: "   " } }), /say why/, "a waiver without a reason is refused");

  await recordWalkthrough(project, "walk", 1, { waive: { note: "walked it by hand on the branch" } });
  assert.equal(walkthroughState((await readMission("p", "walk"))!.milestones[0]), "waived");
  // Past the gate; the close then fails on the tracker this fixture does not have, not on the walkthrough.
  await assert.rejects(() => closeMission(project, "walk"), /no tracker at index 0/);
});

test("a milestone that changed nothing has nothing to walk, and progress through a document counts the cases", async () => {
  const m = await seed("nothing");
  m.milestones[0].merged = "2026-01-02T00:00:00Z";
  m.milestones[0].tasks[0].status = "passed";
  await writeFile(file("nothing"), JSON.stringify(m), "utf8");
  assert.equal(needsWalking((await readMission("p", "nothing"))!.milestones[0]), false);

  const w = await seed("counted");
  (w.milestones[0] as { walkthrough?: unknown }).walkthrough = { started: "2026-01-02T00:00:00Z", doc: "deliverables/testing/counted-m1-walkthrough.html" };
  await writeFile(file("counted"), JSON.stringify(w), "utf8");
  assert.equal(walkthroughState((await readMission("p", "counted"))!.milestones[0]), "walking");
  await recordWalkthrough(project, "counted", 1, { progress: { total: 2, answered: 2, verdicts: { a: "pass", b: "fail" }, updatedAt: "2026-01-02T00:20:00Z" } });
  assert.equal(walkthroughState((await readMission("p", "counted"))!.milestones[0]), "walked", "every case answered is walked, whatever the verdicts were; the verdicts are for the person");
});

test("a person's decision is written into the plan on the mission branch and committed there", async () => {
  // A real repo standing in for the project, with its integration worktree being the repo itself.
  const { dir: repoDir, git } = tempRepo("mv-ledger");
  mkdirSync(join(repoDir, "deliverables", "missions"), { recursive: true });
  await writeFile(join(repoDir, "deliverables", "missions", "ledger.md"), "# Mission: ledger\n\nIntro.\n\n## Milestone 1 — m\n\n_done when: d._\n\n- [ ] **t**\n  Build it.\n", "utf8");
  git("add", "-A"); git("commit", "-q", "-m", "the plan");
  const integration = join(repoDir, ".claude", "worktrees", "ledger-integration-root");
  git("worktree", "add", "-q", "-b", "mission/ledger", integration, "HEAD");
  const m = await seed("ledger");
  m.plan = "deliverables/missions/ledger.md";
  m.repos = [{ label: "root", path: repoDir, base: "main", branch: "mission/ledger", integration, land: "merge" }];
  m.milestones[0].tasks[0].status = "handed-back";
  await writeFile(file("ledger"), JSON.stringify(m), "utf8");

  await acceptTask({ id: "p", name: "P", path: repoDir, trackers: [] } as never, "ledger", "m1-t1", "read the diff myself");
  const text = await readFile(join(integration, "deliverables", "missions", "ledger.md"), "utf8");
  const plan = parsePlan(text, ["root"]);
  assert.equal(plan.milestones[0].tasks[0].status, "passed", text);
  assert.match(plan.log[0], /m1-t1 t: pending to passed/, "the transition is logged");
  assert.match(plan.log[1], /accepted by Cory over the RIO: read the diff myself/, "and so is the decision");
  const wt = (...args: string[]) => execFileSync("git", ["-C", integration, ...args], { encoding: "utf8" });
  assert.match(wt("log", "--format=%s", "-1"), /^mission ledger: m1-t1 t: pending to passed: accepted by Cory over the RIO: read the diff myself \(\+1\)/, "committed on the mission branch's worktree, with the reason");
  assert.equal(wt("status", "--porcelain").trim(), "", "nothing left uncommitted");
  assert.equal(git("log", "--format=%s", "-1").trim(), "the plan", "the main checkout got nothing");

  // The worktree gone while the mission is open: nothing is committed anywhere, and the record says so.
  git("worktree", "remove", "--force", integration);
  await acceptTask({ id: "p", name: "P", path: repoDir, trackers: [] } as never, "ledger", "m1-t1", "again");
  assert.equal(git("log", "--format=%s", "-1").trim(), "the plan", "still nothing on main");
  assert.match((await readMission("p", "ledger"))!.trouble ?? "", /the ledger .*could not be written/);
});

test("a plan no mission repo holds lands on the first repo's mission branch, and the main checkout is never committed to", async () => {
  // The project root is a repo on main holding the plan; the mission names only the child repo "svc".
  const { dir: root, git: rootGit } = tempRepo("mv-ledger-root");
  const g = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  mkdirSync(join(root, "deliverables", "missions"), { recursive: true });
  const planText = "# Mission: held\n\nIntro.\n\n## Milestone 1 — m\n\n_done when: d._\n\n- [ ] **t**\n  - repo: svc\n  Build it.\n";
  await writeFile(join(root, "deliverables", "missions", "held.md"), planText, "utf8");
  rootGit("add", "-A"); rootGit("commit", "-q", "-m", "the plan, on main");
  const svc = join(root, "svc");
  mkdirSync(svc);
  g(svc, "init", "-q", "-b", "main"); g(svc, "config", "user.name", "t"); g(svc, "config", "user.email", "t@example.com"); g(svc, "commit", "-q", "--allow-empty", "-m", "base");
  const integration = join(root, ".claude", "worktrees", "held-integration-svc");
  g(svc, "worktree", "add", "-q", "-b", "mission/held", integration, "main");

  const m = await seed("held");
  m.plan = "deliverables/missions/held.md";
  m.milestones[0].tasks[0].repo = "svc";
  m.milestones[0].tasks[0].status = "handed-back";
  m.repos = [{ label: "svc", path: svc, base: "main", branch: "mission/held", integration, land: "merge" }];
  await writeFile(file("held"), JSON.stringify(m), "utf8");
  await acceptTask({ id: "p", name: "P", path: root, trackers: [] } as never, "held", "m1-t1", "fine");

  const ledger = await readFile(join(integration, "deliverables", "missions", "held.md"), "utf8");
  assert.equal(parsePlan(ledger, ["svc"]).milestones[0].tasks[0].status, "passed", "the ledger is on svc's mission branch");
  assert.match(g(integration, "log", "--format=%s", "-1"), /^mission held:/);
  assert.equal(g(root, "log", "--format=%s", "-1").trim(), "the plan, on main", "main got no commit");
  assert.equal(await readFile(join(root, "deliverables", "missions", "held.md"), "utf8"), planText, "and the Lead's copy is untouched");
});

test("pause keeps its reason, refuses a retry, and resume comes back blocked when a person is still needed", async () => {
  const m = await seed("pause");
  (m.milestones[0] as { hold?: unknown }).hold = { kind: "collision", reason: "milestone 1 collided in root and the Strike Lead could not reconcile it", at: "2026-10-09T00:00:00Z" };
  m.status = "blocked";
  await writeFile(file("pause"), JSON.stringify(m), "utf8");
  await assert.rejects(() => pauseMission(project, "pause", "  "), /say why/);
  const paused = await pauseMission(project, "pause", "token expired");
  assert.equal(paused.status, "paused");
  assert.match(paused.trouble ?? "", /^paused: token expired/);
  await assert.rejects(() => retryTask(project, "pause", "m1-t1"), /is paused; resume it first/);
  await acceptTask(project, "pause", "m1-t1", "looked");
  assert.equal((await readMission("p", "pause"))!.status, "paused", "accepting a task does not end a pause");
  const resumed = await resumeMission(project, "pause");
  assert.equal(resumed.status, "blocked", "the collision is still a person's to answer");
  assert.match(resumed.trouble ?? "", /milestone 1 collided/);
  await assert.rejects(() => resumeMission(project, "pause"), /not paused/);
});

test("a held milestone is released by a person with a reason, and the mission is flying again if nothing else needs them", async () => {
  const m = await seed("held");
  (m.milestones[0] as { hold?: unknown; conflicts?: string[] }).hold = { kind: "collision", reason: "milestone 1 collided", at: "2026-10-09T00:00:00Z" };
  (m.milestones[0] as { hold?: unknown; conflicts?: string[] }).conflicts = ["root/a.ts"];
  m.status = "blocked";
  await writeFile(file("held"), JSON.stringify(m), "utf8");
  await assert.rejects(() => releaseMilestone(project, "held", 1, ""), /say what you did/);
  await assert.rejects(() => releaseMilestone(project, "held", 2, "x"), /no milestone 2/);
  const released = await releaseMilestone(project, "held", 1, "merged it by hand in the integration worktree");
  assert.equal(released.status, "flying");
  assert.equal(released.milestones[0].hold, undefined);
  assert.equal(released.milestones[0].conflicts, undefined);
  await assert.rejects(() => releaseMilestone(project, "held", 1, "again"), /is not held/);
  // A proof hold releases into a fresh proof; a landing hold is land-again's.
  const p = await seed("proofheld");
  (p as { proofRequired?: boolean }).proofRequired = true;
  p.milestones[0].merged = "x";
  p.milestones[0].tasks[0].status = "passed";
  (p.milestones[0] as { hold?: unknown; proof?: unknown }).hold = { kind: "proof", reason: "the proof failed", at: "x" };
  (p.milestones[0] as { hold?: unknown; proof?: unknown }).proof = { ok: false, at: "x", output: "boom" };
  await writeFile(file("proofheld"), JSON.stringify(p), "utf8");
  const reproved = await releaseMilestone(project, "proofheld", 1, "fixed the test");
  assert.equal(reproved.milestones[0].proof, undefined, "the proof runs again before anything lands");
  assert.equal(reproved.status, "flying", "merged, but not done until the proof passes again");
  const l = await seed("landheld");
  (l.milestones[0] as { hold?: unknown }).hold = { kind: "landing", reason: "could not land", at: "x" };
  await writeFile(file("landheld"), JSON.stringify(l), "utf8");
  await assert.rejects(() => releaseMilestone(project, "landheld", 1, "pushed it"), /"land again" is the release for that/);
});

test("a spawned agent's id is never lost: a write the record refuses puts the id on the fresh record and ends the pass", async () => {
  const m = await seed("claim");
  const task = m.milestones[0].tasks[0];
  task.status = "pending";
  await writeFile(file("claim"), JSON.stringify(m), "utf8");
  const mission = (await readMission("p", "claim"))!;
  await assert.rejects(() => claimed(mission,
    () => { const t = mission.milestones[0].tasks[0]; t.status = "flying"; t.claudeId = undefined; },
    async () => {
      // A person acts while the spawn is in flight: the record moves under the pass.
      const theirs = (await readMission("p", "claim"))!;
      theirs.trouble = "a person was here";
      await __writeMissionForTest(theirs);
      return "agent-123";
    },
    (on, id) => { on.milestones[0].tasks[0].claudeId = id; }), StaleMissionError);
  const fresh = (await readMission("p", "claim"))!;
  assert.equal(fresh.milestones[0].tasks[0].claudeId, "agent-123", "the id landed on the record that is true");
  assert.equal(fresh.milestones[0].tasks[0].status, "flying", "the claim written before the spawn stands");
  assert.equal(fresh.trouble, "a person was here", "and the person's write was not undone");
});
