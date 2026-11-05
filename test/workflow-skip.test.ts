/**
 * The template decides whether proof and a walk happen. The real `src/missions.ts` and the real
 * sweep with a fake `claude` first on PATH and real git in temp repos, on a project whose proof
 * command writes a sentinel file, so "no proof ran" is read off the disk and not off the record.
 * The same fixture flies with the stages left out and with the default, so neither half can pass
 * on a fixture that never reaches the stage.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { tempRepo, until } from "./fixtures.ts";

const made: string[] = [];
const scratch = (name: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `mv-m1-t5-skip-${name}-`)));
  made.push(dir);
  return dir;
};

// config.ts reads these once when the module graph loads, so they are set before the imports below.
const sessions = scratch("sessions");
process.env.SESSION_CONSOLE_SESSIONS = sessions;
process.env.SESSION_CONSOLE_HOME = scratch("home");
process.env.CLAUDE_CONFIG_DIR = scratch("claude");
const { approveMission, closeMission, done, missionView, parsePlan, startable, summarizeMission, sweepMissions, sweepSoon, waitingOn } = await import("../src/missions.ts");
const { needsWalking, owesWalk, questionsOf, toWalk } = await import("../src/questions.ts");
const { defaultWorkflow, validateWorkflow } = await import("../src/workflows.ts");
type Mission = import("../src/missions.ts").Mission;
type Milestone = import("../src/missions.ts").Milestone;
type Stage = import("../src/workflows.ts").Stage;
type Workflow = import("../src/workflows.ts").Workflow;

/** Every background session is logged with its folder and arguments, fields ending in NUL and a record in 0x1e, because a brief holds anything else. */
const bin = scratch("bin");
const log = join(bin, "spawns");
const listing = join(bin, "agents.json");
writeFileSync(join(bin, "claude"), `#!/bin/sh
case "$1" in
  agents) cat "${listing}"; exit 0 ;;
  stop) exit 0 ;;
esac
n=$(( $(cat "${bin}/count" 2>/dev/null || echo 160) + 1 )); echo "$n" > "${bin}/count"
id=$(printf '%x' "$n")
printf '%s\\0' "$id" "$(pwd)" "$@" >> "${log}"; printf '\\036' >> "${log}"
echo "backgrounded · $id"
`, "utf8");
chmodSync(join(bin, "claude"), 0o755);
const realPath = process.env.PATH;
process.env.PATH = `${bin}:${realPath}`;
after(() => {
  process.env.PATH = realPath;
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const valueOf = (args: string[], flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const allSpawns = () => (existsSync(log) ? readFileSync(log, "utf8").split("\x1e").slice(0, -1) : []).map((record) => {
  const [id, cwd, ...args] = record.split("\0").slice(0, -1);
  return { id, cwd, name: valueOf(args, "--name") ?? "", text: args.join("\n") };
});

const WINGMAN = "m1-t5-wingman";
const RIO = "m1-t5-rio";

/** Two milestones, and a task in the second that needs a task in the first, so the walk is what holds both ways a task can start. */
const TWO = `# Mission: skip

An invented mission.

## Milestone 1: the first

_done when: the first exists_
_walk: open the first_

- [ ] **Base the first**
  - touches: src/m1-t1.txt
  Write the first.

## Milestone 2: the second

_done when: the second exists_
_walk: open the second_

- [ ] **Base the second**
  - touches: src/m2-t1.txt
  Write the second.

- [ ] **Build on the first**
  - touches: src/m2-t2.txt
  - needs: m1-t1
  Write the third.
`;

const ONE = TWO.slice(0, TWO.indexOf("## Milestone 2"));

/** The default without the stages named, through the real validator, so a test cannot pin what no template could be. */
const leaving = (...left: string[]): Workflow => {
  const w = JSON.parse(JSON.stringify(defaultWorkflow())) as Workflow;
  const prune = (stages: Stage[]): Stage[] => stages.filter((s) => !left.includes(s.id)).map((s) => (s.stages ? { ...s, stages: prune(s.stages) } : s));
  return validateWorkflow({ ...w, stages: prune(w.stages) });
};

const NO_STAGES = ["proof", "walkthrough", "walk"];

/** One mission on a project of its own whose proof writes a sentinel, planned and not approved, with the template pinned as `startMission` pins it. */
const flow = (id: string, opts: { template?: Workflow; plan?: string } = {}) => {
  const plan = opts.plan ?? TWO;
  const { dir: root, git } = tempRepo(`mv-m1-t5-skip-${id}`);
  made.push(root);
  const sentinel = join(scratch(`${id}-sentinel`), "proof-ran");
  const proof = `touch "${sentinel}"`;
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write("maverick.json", JSON.stringify({ missions: { wingmanAgent: WINGMAN, rioAgent: RIO, proof } }));
  for (const agent of [WINGMAN, RIO]) write(`.claude/agents/${agent}.md`, "an agent\n");
  write("deliverables/CHECKLIST.md", "# Checklist\n\n## 🔥 Priority\n\n## 📋 Backlog\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the project");
  write(`deliverables/missions/${id}.md`, plan);
  const project = { id: `p-${id}`, name: "P", path: root, trackers: [{ label: "CHECKLIST", path: join(root, "deliverables/CHECKLIST.md") }] } as never;
  const file = join(sessions, "missions", `p-${id}`, `${id}.json`);
  const seeded = {
    id, project: `p-${id}`, name: id, brief: "a line", status: "planned", created: new Date().toISOString(), plan: `deliverables/missions/${id}.md`,
    repos: [], land: "merge", trackerIndex: 0, lead: { sessionId: `lead-${id}`, started: new Date().toISOString() }, chat: [],
    milestones: parsePlan(plan, ["root"]).milestones, rev: 2,
    ...(opts.template ? { template: opts.template } : {}),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

  const finished = new Set<string>();
  const record = (): Mission => JSON.parse(readFileSync(file, "utf8")) as Mission;
  const task = (taskId: string) => record().milestones.flatMap((m) => m.tasks).find((t) => t.id === taskId)!;
  /** One real pass. `sweepSoon` drops the agent listing, and its timer is unref'd, so something here has to hold the loop open. */
  const sweep = (): Promise<void> => new Promise((resolve, reject) => {
    writeFileSync(listing, JSON.stringify(allSpawns().map((s) => ({ id: s.id, sessionId: `session-${s.id}`, cwd: s.cwd, kind: "background", state: finished.has(s.id) ? "done" : "working", ...(finished.has(s.id) ? {} : { pid: 4242 }) }))), "utf8");
    const open = setInterval(() => undefined, 1_000);
    sweepSoon(project, (p) => sweepMissions(p).then(() => { clearInterval(open); resolve(); }, (err) => { clearInterval(open); reject(err); }), 0);
  });
  /** Only this mission's: every test shares the one fake and its log. */
  const spawns = () => allSpawns().filter((s) => s.cwd.startsWith(root));
  /** The Wingman's part: a commit on the task's branch, then its agent finished. */
  const wingman = (taskId: string, text = "whole"): void => {
    const { worktree, claudeId } = task(taskId);
    mkdirSync(join(worktree!, "src"), { recursive: true });
    writeFileSync(join(worktree!, `src/${taskId}.txt`), text, "utf8");
    execFileSync("git", ["-C", worktree!, "add", "--", `src/${taskId}.txt`]);
    execFileSync("git", ["-C", worktree!, "commit", "-q", "-m", `${taskId}: ${text}`]);
    finished.add(claudeId!);
  };
  /** The RIO's part: its verdict where the record says, then its agent finished. */
  const rio = (taskId: string, findings = "verdict: pass\n"): void => {
    const { review } = task(taskId);
    writeFileSync(review!.file, findings, "utf8");
    finished.add(review!.claudeId!);
  };
  /** A task from flying to passed: its Wingman, a pass to reach the RIO, its verdict, a pass to read it. */
  const fly = async (taskId: string): Promise<void> => {
    assert.equal(task(taskId).status, "flying", taskId);
    wingman(taskId);
    await sweep();
    assert.equal(task(taskId).status, "reviewing", taskId);
    rio(taskId);
    await sweep();
  };
  return { id, project, proof, sentinel, record, task, sweep, spawns, wingman, rio, fly };
};

const brief = (f: ReturnType<typeof flow>, name: string): string[] => f.spawns().filter((s) => s.name === name).map((s) => s.text);

/** A proof that was wrongly started runs detached, so absence is only worth asserting once it has had time to land. */
const noProofRan = async (f: ReturnType<typeof flow>): Promise<void> => {
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(existsSync(f.sentinel), false, "the project's proof command ran");
};

/** The proof runs detached: the pass starts it and a later pass reads it. */
const sweepToProof = async (f: ReturnType<typeof flow>, n = 0): Promise<void> => {
  const start = performance.now();
  for (await f.sweep(); !f.record().milestones[n].proof; await f.sweep()) {
    if (performance.now() - start > 60_000) throw new Error("the proof never reached the record");
    await new Promise((r) => setTimeout(r, 25));
  }
};

const assertNoProofLine = (text: string, proof: string): void => {
  assert.equal(text.includes(proof), false, "the proof command is in the brief");
  assert.doesNotMatch(text, /the project's proof|and the project's,/);
};

test("a template with no proof, no walkthrough and no walk merges, proves nothing, builds nothing, starts the next milestone and closes without a walk", { timeout: 120_000 }, async () => {
  const f = flow("skip-all", { template: leaving(...NO_STAGES) });
  await approveMission(f.project, f.id);
  assert.equal(f.record().proofRequired, false, "the gate does not require a proof the template leaves out, with the project's command set");

  // A retry on the way, so the brief `handBack` writes is read as well as the first.
  f.wingman("m1-t1", "empty");
  await f.sweep();
  f.rio("m1-t1", "verdict: fail\n\n- BLOCKER(src/m1-t1.txt, fix): it is empty.\n");
  await f.sweep();
  assert.deepEqual([f.task("m1-t1").status, f.task("m1-t1").attempts], ["flying", 2], "handed back");
  await f.fly("m1-t1");

  const first = f.record().milestones[0];
  assert.ok(first.merged, "merged");
  assert.deepEqual([first.proof, first.hold, first.walkthrough], [undefined, undefined, undefined]);
  assert.equal(f.record().proofRequired, false, "the sweep keeps it so, with the project's command set");
  assert.ok(f.record().milestones[1].dispatched, "the next milestone is sent with no walk");
  assert.deepEqual([f.task("m2-t1").status, f.task("m2-t2").status], ["flying", "flying"], "and a task that needs the first is built on it with no walk");
  const asked = questionsOf(f.record());
  assert.deepEqual(asked.filter((q) => q.kind === "walk"), [], "nobody is asked to walk");
  assert.deepEqual(toWalk(f.record()), []);

  await f.fly("m2-t1");
  await f.fly("m2-t2");
  const end = f.record();
  assert.equal(end.status, "review", "reaches review");
  assert.ok(end.milestones[1].merged);
  assert.deepEqual(end.milestones.map((m) => [m.proof, m.walkthrough]), [[undefined, undefined], [undefined, undefined]]);
  assert.deepEqual(questionsOf(end).map((q) => q.kind), ["review"], "the only thing it asks is the close");
  const view = await missionView(f.project, f.id);
  assert.deepEqual(view.walk, { 1: { state: "none", needed: false }, 2: { state: "none", needed: false } }, "the page is told no walk is needed");
  assert.deepEqual(view.proved, [1, 2]);

  await noProofRan(f);
  assert.deepEqual(f.spawns().map((s) => s.name), [
    "skip-all · Base the first", "RIO · Base the first",
    "skip-all · Base the first (retry 2)", "RIO · Base the first",
    "skip-all · Base the second", "skip-all · Build on the first", "RIO · Base the second", "RIO · Build on the first",
  ], "no walkthrough builder");
  const wingmen = f.spawns().filter((s) => !s.name.startsWith("RIO"));
  const rios = f.spawns().filter((s) => s.name.startsWith("RIO"));
  assert.equal(wingmen.length, 4);
  assert.equal(rios.length, 4);
  for (const s of [...wingmen, ...rios]) assertNoProofLine(s.text, f.proof);

  const closed = await closeMission(f.project, f.id);
  assert.equal(closed.mission.status, "closed", "closes without a walk");
  await noProofRan(f);
});

for (const pinned of [true, false]) {
  const how = pinned ? "pinned" : "not on the record";
  test(`the same fixture with the default ${how} runs the proof, spawns the builder and holds on the walk`, { timeout: 120_000 }, async () => {
    const f = flow(pinned ? "hold-pinned" : "hold-older", pinned ? { template: defaultWorkflow() } : {});
    await approveMission(f.project, f.id);
    assert.equal(f.record().proofRequired, true);
    await f.fly("m1-t1");

    assert.ok(f.record().milestones[0].merged, "merged");
    await sweepToProof(f);
    await until(() => existsSync(f.sentinel));
    const proved = f.record().milestones[0];
    assert.equal(proved.proof?.ok, true);
    assert.equal(f.record().proofRequired, true, "the sweep keeps it so");
    assert.ok(proved.walkthrough?.claudeId, "the builder went");

    await f.sweep();
    const held = f.record();
    assert.equal(held.milestones[1].dispatched, undefined, "the next milestone waits on the walk");
    assert.deepEqual([f.task("m2-t1").status, f.task("m2-t2").status], ["pending", "pending"]);
    assert.equal(waitingOn(held).tasks["m2-t2"], "waits for m1-t1 (its milestone is not walked yet)");
    assert.deepEqual(startable(held), []);
    assert.deepEqual(questionsOf(held).filter((q) => q.kind === "walk").map((q) => q.id), ["walk:1"]);
    assert.deepEqual(toWalk(held).map((m) => m.n), [1]);
    assert.equal((await missionView(f.project, f.id)).walk[1].needed, true);

    assert.deepEqual(f.spawns().map((s) => s.name), [`${f.id} · Base the first`, "RIO · Base the first", "walkthrough · m1 the first"]);
    const [wingman] = brief(f, `${f.id} · Base the first`);
    const [rio] = brief(f, "RIO · Base the first");
    assert.ok(wingman.includes(`then the project's proof from its maverick.json, \`${f.proof}\``), "the Wingman brief has the proof line this test says is gone without the stage");
    assert.ok(rio.includes(`and the project's, \`${f.proof}\`,`), "and so does the RIO's");

    const asked = await summarizeMission(f.project, f.id);
    assert.ok(asked.summary?.claudeId, "the default has a summary");
    assert.equal("template" in f.record(), pinned, "an older record is never back-filled");
  });
}

test("the default at review refuses the close until the walk, where the same plan with no walk closes", { timeout: 120_000 }, async () => {
  const held = flow("close-default", { template: defaultWorkflow(), plan: ONE });
  await approveMission(held.project, held.id);
  await held.fly("m1-t1");
  await sweepToProof(held);
  assert.equal(held.record().status, "review");
  await assert.rejects(() => closeMission(held.project, held.id), /not walked yet: milestone 1 \(building\)/);
  assert.equal(held.record().status, "review");

  const free = flow("close-free", { template: leaving(...NO_STAGES), plan: ONE });
  await approveMission(free.project, free.id);
  await free.fly("m1-t1");
  assert.equal(free.record().status, "review");
  assert.equal((await closeMission(free.project, free.id)).mission.status, "closed");
  await noProofRan(free);
});

test("the proof and the walk are decided apart: leaving out only the proof still walks", { timeout: 120_000 }, async () => {
  const f = flow("only-proof", { template: leaving("proof") });
  await approveMission(f.project, f.id);
  await f.fly("m1-t1");
  assert.equal(f.record().proofRequired, false);
  assert.ok(f.record().milestones[0].walkthrough?.claudeId, "the builder goes straight after the merge");
  await f.sweep();
  assert.equal(f.record().milestones[1].dispatched, undefined, "and the next milestone waits on the walk");
  assert.equal(waitingOn(f.record()).tasks["m2-t2"], "waits for m1-t1 (its milestone is not walked yet)");
  await noProofRan(f);
  assertNoProofLine(brief(f, `${f.id} · Base the first`)[0], f.proof);
  assertNoProofLine(brief(f, "RIO · Base the first")[0], f.proof);
});

test("the proof and the walk are decided apart: leaving out only the walk still proves, and waits for it", { timeout: 120_000 }, async () => {
  const f = flow("only-walk", { template: leaving("walkthrough", "walk") });
  await approveMission(f.project, f.id);
  await f.fly("m1-t1");
  assert.equal(f.record().proofRequired, true);
  assert.equal(f.record().milestones[1].dispatched, undefined, "the next milestone waits for the proof");
  assert.ok(brief(f, `${f.id} · Base the first`)[0].includes(f.proof), "the brief keeps its proof line");
  await sweepToProof(f);
  await until(() => existsSync(f.sentinel));
  assert.equal(f.record().milestones[0].proof?.ok, true);
  assert.equal(f.record().milestones[0].walkthrough, undefined, "no builder");
  assert.ok(f.record().milestones[1].dispatched, "the next milestone goes once it is proved, with no walk");
  assert.ok(!f.spawns().some((s) => s.name.startsWith("walkthrough")));
});

test("a template with no summary refuses the summary by name, and starts nothing", { timeout: 120_000 }, async () => {
  const f = flow("no-summary", { template: leaving("summary", ...NO_STAGES), plan: ONE });
  await approveMission(f.project, f.id);
  await f.fly("m1-t1");
  assert.ok(f.record().milestones[0].merged, "merged, so the refusal is not the one for nothing to summarize");
  const before = f.spawns().length;
  await assert.rejects(() => summarizeMission(f.project, f.id), /no-summary runs a template with no summary stage/);
  assert.equal(f.record().summary, undefined, "no claim on the record");
  assert.equal(f.spawns().length, before, "no session started");
});

test("owesWalk reads a partial fixture as the default, and needsWalking still takes one argument", () => {
  const unwalked = { n: 1, tasks: [{ commits: ["abc"] }], merged: "x" } as unknown as Milestone;
  const quiet = { n: 2, tasks: [{}], merged: "x" } as unknown as Milestone;
  assert.equal(owesWalk({}, unwalked), true);
  assert.equal(owesWalk({}, quiet), false, "a milestone that changed nothing owes nothing");
  assert.equal(owesWalk({ template: defaultWorkflow() }, unwalked), true);
  assert.equal(owesWalk({ template: leaving("walkthrough", "walk") }, unwalked), false);
  assert.equal(owesWalk({ template: leaving("proof") }, unwalked), true, "only the walk stage answers");
  assert.deepEqual([unwalked, quiet].filter(needsWalking).map((m) => m.n), [1], "still fit to hand to filter");
  assert.deepEqual(toWalk({ milestones: [unwalked, quiet] }).map((m) => m.n), [1]);
  assert.equal(done({ proofRequired: false }, unwalked), false);
  assert.equal(done({ proofRequired: false, template: leaving("walkthrough", "walk") }, unwalked), true);
});
