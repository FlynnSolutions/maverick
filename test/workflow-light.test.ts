/**
 * Light flies: a built task passes with no review, and the plan, the briefs and the interview
 * follow the template. The real `src/missions.ts` and the real sweep, with a fake `claude` first
 * on PATH and real git in temp repos, on an invented project whose proof writes a sentinel and
 * which has a RIO agent installed, so "no RIO" and "no proof" are the template's doing and not a
 * fixture that could not have run them.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test, type TestContext } from "node:test";
import { flightHarness, valueOf } from "./flight-harness.ts";
import { tempRepo } from "./fixtures.ts";

// config.ts reads its environment once when the module graph loads, so this runs before the imports below.
const { made, scratch, sessions, listing, spawned } = flightHarness("mv-m1-t4-light");
const { approveMission, closeMission, costOf, estimateOf, interviewPrompt, measuredPace, parsePlan, previewPlan, summarizeMission, sweepMissions, sweepSoon } = await import("../src/missions.ts");
const { RIO_CHECKLIST, wingmanBrief } = await import("../src/briefs.ts");
const { builtInWorkflows, defaultWorkflow } = await import("../src/workflows.ts");
type Mission = import("../src/missions.ts").Mission;
type Workflow = import("../src/workflows.ts").Workflow;

const LIGHT = builtInWorkflows().find((w) => w.id === "light")!;
const WINGMAN = "m1-t4-wingman";
const RIO = "m1-t4-rio";

/** One milestone of two tasks, the second needing the first, and no `_walk:_` line. */
const PLAN = `# Mission: light

An invented mission, flown light.

## Milestone 1: the lamp

_done when: the lamp exists and is lit_

- [ ] **Base the lamp**
  - touches: src/lamp.txt
  Write the lamp to src/lamp.txt.

- [ ] **Light the lamp**
  - touches: src/light.txt
  - needs: m1-t1
  Write its light to src/light.txt.
`;

/** One mission on a project of its own, planned and not approved, with the template pinned as `startMission` pins it. */
const flow = (t: TestContext, id: string, template?: Workflow) => {
  // Frozen, and moved a minute per step, so every stamp in the ledger is exact.
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2020, 0, 1, 9, 0).getTime() });
  const { dir: root, git } = tempRepo(`mv-m1-t4-light-${id}`);
  made.push(root);
  const sentinel = join(scratch(`${id}-sentinel`), "proof-ran");
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write("maverick.json", JSON.stringify({ missions: { wingmanAgent: WINGMAN, rioAgent: RIO, proof: `touch "${sentinel}"` } }));
  for (const agent of [WINGMAN, RIO]) write(`.claude/agents/${agent}.md`, "an agent\n");
  write("deliverables/CHECKLIST.md", "# Checklist\n\n## 🔥 Priority\n\n## 📋 Backlog\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the project");
  write(`deliverables/missions/${id}.md`, PLAN);
  const project = { id: `p-${id}`, name: "P", path: root, trackers: [{ label: "CHECKLIST", path: join(root, "deliverables/CHECKLIST.md") }] } as never;
  const file = join(sessions, "missions", `p-${id}`, `${id}.json`);
  const seeded = {
    id, project: `p-${id}`, name: id, brief: "a line", status: "planned", created: new Date().toISOString(), plan: `deliverables/missions/${id}.md`,
    repos: [], land: "merge", trackerIndex: 0, lead: { sessionId: `lead-${id}`, started: new Date().toISOString() }, chat: [],
    milestones: parsePlan(PLAN, ["root"], [], { walk: false }).milestones, rev: 2,
    ...(template ? { template } : {}),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

  const finished = new Set<string>();
  const integration = join(root, ".claude/worktrees", `${id}-integration-root`);
  const record = (): Mission => JSON.parse(readFileSync(file, "utf8")) as Mission;
  const task = (taskId: string) => record().milestones.flatMap((m) => m.tasks).find((x) => x.id === taskId)!;
  /** Only this mission's: every test shares the one fake and its log. */
  const spawns = () => spawned().filter((s) => s.cwd.startsWith(root)).map(({ id: claudeId, cwd, args }) => ({ claudeId, name: valueOf(args, "--name"), agent: valueOf(args, "--agent"), tools: valueOf(args, "--tools"), in: relative(root, cwd), prompt: args.at(-1)! }));
  /** One real pass. `sweepSoon` drops the agent listing, and its timer is unref'd, so something here has to hold the loop open. */
  const sweep = (): Promise<void> => new Promise((resolve, reject) => {
    writeFileSync(listing, JSON.stringify(spawned().map((s) => ({ id: s.id, sessionId: `session-${s.id}`, cwd: s.cwd, kind: "background", state: finished.has(s.id) ? "done" : "working", ...(finished.has(s.id) ? {} : { pid: 4242 }) }))), "utf8");
    const open = setInterval(() => undefined, 1_000);
    sweepSoon(project, (p) => sweepMissions(p).then(() => { clearInterval(open); resolve(); }, (err) => { clearInterval(open); reject(err); }), 0);
  });
  /** The Wingman's part: a commit on the task's branch, then its agent finished. */
  const wingman = (taskId: string, path: string, text: string): void => {
    const { worktree, claudeId } = task(taskId);
    mkdirSync(dirname(join(worktree!, path)), { recursive: true });
    writeFileSync(join(worktree!, path), text, "utf8");
    execFileSync("git", ["-C", worktree!, "add", "--", path]);
    execFileSync("git", ["-C", worktree!, "commit", "-q", "-m", `${taskId}: ${path}`]);
    finished.add(claudeId!);
  };
  return {
    id, project, root, git, sentinel, record, task, sweep, spawns, wingman,
    step: (): void => t.mock.timers.tick(60_000),
    ledger: () => parsePlan(readFileSync(join(integration, `deliverables/missions/${id}.md`), "utf8"), [], [], { walk: false }),
  };
};

const stamp = (minute: number): string => `2020-01-01 09:${String(minute).padStart(2, "0")}`;

// First, while the records folder holds only what it seeds: every later flight writes records there.
test("the pace with no review is the Wingman's alone, from every passed task", async () => {
  const at = (minute: number): string => new Date(2020, 0, 1, 9, minute).toISOString();
  const reviewed = join(scratch("pace"), "findings.md");
  writeFileSync(reviewed, "verdict: pass\n", "utf8");
  utimesSync(reviewed, new Date(2020, 0, 1, 9, 15), new Date(2020, 0, 1, 9, 15));
  const tasks = [
    { id: "m1-t1", title: "a", intent: "a", repo: "root", status: "passed", attempts: 2, started: at(0), ended: at(10), review: { claudeId: "r", file: reviewed, started: at(10) } },
    { id: "m1-t2", title: "b", intent: "b", repo: "root", status: "passed", attempts: 1, started: at(20), ended: at(50), note: "no review in this template" },
  ];
  const file = join(sessions, "missions", "p-pace", "pace.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ id: "pace", project: "p-pace", name: "pace", brief: "a line", status: "closed", created: at(0), plan: "plan.md", repos: [], land: "merge", trackerIndex: 0, chat: [], rev: 1, milestones: [{ n: 1, title: "m", done: "d", walk: [], tasks }] }), "utf8");
  assert.deepEqual(await measuredPace(0), { minutesPerTask: 15, retryRate: 1, tasks: 1 }, "build plus review, from the reviewed task only");
  assert.deepEqual(await measuredPace(0, false), { minutesPerTask: 20, retryRate: 0.5, tasks: 2 }, "the Wingman alone, from both");
  rmSync(dirname(file), { recursive: true });
});

test("a Light mission flies from the blessing to closed with two Wingmen and nothing else: no RIO, proof, walkthrough or summary", { timeout: 120_000 }, async (t) => {
  const f = flow(t, "light-fly", LIGHT);

  // The gate: the plan with no walk line parses under Light, and costs one session a task.
  const preview = await previewPlan(f.project, f.id);
  assert.deepEqual(preview.parsed!.problems, []);
  assert.equal(preview.cost!.sessions, 2, "a Wingman per task and no RIO");
  assert.deepEqual(preview.preflight!.filter((c) => c.status === "fail").map((c) => c.name), [], "nothing the gate refuses");

  const approved = await approveMission(f.project, f.id);
  assert.equal(approved.status, "flying");
  assert.deepEqual(f.record().milestones[0].tasks.map((x) => x.status), ["flying", "pending"]);

  // The first Wingman finishes: its task passes in the same pass, with no RIO, and the one that needs it goes.
  f.step();
  f.wingman("m1-t1", "src/lamp.txt", "a lamp\n");
  await f.sweep();
  assert.deepEqual([f.task("m1-t1").status, f.task("m1-t1").note, f.task("m1-t1").review, f.task("m1-t1").verdict, f.task("m1-t1").reviews], ["passed", "no review in this template", undefined, undefined, undefined]);
  assert.equal(f.task("m1-t2").status, "flying");

  // The second: it passes, the milestone merges, there is no proof to wait on and no walk owed, so the mission is at review.
  f.step();
  f.wingman("m1-t2", "src/light.txt", "lit\n");
  await f.sweep();
  const atReview = f.record();
  assert.deepEqual(atReview.milestones[0].tasks.map((x) => [x.id, x.status, x.note, x.review, x.verdict]), [
    ["m1-t1", "passed", "no review in this template", undefined, undefined],
    ["m1-t2", "passed", "no review in this template", undefined, undefined],
  ]);
  const [m] = atReview.milestones;
  assert.ok(m.merged, "merged");
  assert.deepEqual([m.proof, m.hold, m.walkthrough, atReview.proofRequired], [undefined, undefined, undefined, false]);
  assert.equal(atReview.status, "review");
  assert.equal(f.git("show", `mission/${f.id}:src/lamp.txt`), "a lamp\n");
  assert.equal(f.git("show", `mission/${f.id}:src/light.txt`), "lit\n");

  // Another pass at review starts nothing, and the close is one call.
  f.step();
  await f.sweep();
  f.step();
  const closed = await closeMission(f.project, f.id);
  assert.equal(closed.mission.status, "closed");
  assert.deepEqual(closed.pullRequests, []);
  assert.deepEqual(closed.ticked.sort(), ["Base the lamp", "Light the lamp", "Mission: light-fly"]);
  await assert.rejects(() => summarizeMission(f.project, f.id), /no summary stage/);
  assert.equal(existsSync(f.sentinel), false, "the project's proof never ran");

  // Every session the flight started, in order: two Wingmen and nothing else.
  const wingmen = (taskId: string, title: string) => ({ name: `light-fly · ${title}`, agent: WINGMAN, tools: undefined, in: `.claude/worktrees/light-fly-${taskId}-root` });
  assert.deepEqual(f.spawns().map(({ name, agent, tools, in: where }) => ({ name, agent, tools, in: where })), [wingmen("m1-t1", "Base the lamp"), wingmen("m1-t2", "Light the lamp")]);

  // The briefs as they were sent: no RIO promised, and the needed task not said to be reviewed.
  for (const { prompt } of f.spawns()) {
    assert.ok(prompt.includes("No RIO reviews this mission: its template leaves review out, so what you commit is merged as you leave it. Check the list yourself."));
    assert.equal(/A RIO that is not you|the RIO reads the commit|The RIO judges|passed its review/.test(prompt), false);
  }
  assert.ok(f.spawns()[1].prompt.includes("It builds on m1-t1 (Base the lamp), which has passed and sits on branch mission/light-fly-m1-t1"));

  // The ledger: no line claims a review.
  // Built and settled in the one pass, as a default task goes from flying to reviewing in one.
  assert.deepEqual(f.ledger().log, [
    `${stamp(0)} m1-t1 Base the lamp: pending to flying`,
    `${stamp(1)} m1-t1 Base the lamp: flying to passed: no review in this template`,
    `${stamp(1)} m1-t2 Light the lamp: pending to flying`,
    `${stamp(2)} m1-t2 Light the lamp: flying to passed: no review in this template`,
    `${stamp(2)} merged: milestone 1 (the lamp) is on the mission branch`,
    `${stamp(4)} decision: closed by Cory: 3 item(s) ticked`,
  ]);
  assert.equal(f.ledger().log.some((l) => /RIO/.test(l)), false);
  assert.equal(f.record().status, "closed");
});

test("a plan with no walk line parses under Light and is refused under mission, at the parser and at the gate", async (t) => {
  assert.deepEqual(parsePlan(PLAN, ["root"], [], { walk: false }).problems, []);
  assert.deepEqual(parsePlan(PLAN, ["root"]).problems, ['milestone 1 has no "_walk: <case>; <case>_" line: the cases walked at its end'], "the default keeps today's rule");
  assert.deepEqual(parsePlan(PLAN, ["root"], [], { walk: true }).problems, parsePlan(PLAN, ["root"]).problems);

  const full = flow(t, "light-refused", defaultWorkflow());
  assert.match((await previewPlan(full.project, full.id)).parsed!.problems.join(), /milestone 1 has no "_walk/);
  await assert.rejects(() => approveMission(full.project, full.id), /the plan cannot be flown as written: milestone 1 has no "_walk/);
  assert.deepEqual(full.spawns(), [], "nothing was sent");
});

test("cost and estimate count a RIO per task only when the template reviews", () => {
  const { milestones } = parsePlan(PLAN, ["root"], [], { walk: false });
  assert.equal(costOf(milestones).sessions, 4, "the default: a Wingman and a RIO per task");
  assert.equal(costOf(milestones, { review: true }).sessions, 4);
  assert.equal(costOf(milestones, { review: false }).sessions, 2);
  const pace = { minutesPerTask: 10, retryRate: 0.5, tasks: 4 };
  assert.deepEqual([estimateOf(milestones, pace).minutes, estimateOf(milestones, pace).basis], [25, { measured: true, tasks: 4, minutesPerTask: 10, retryRate: 0.5 }], "two links plus half a retry");
  assert.deepEqual([estimateOf(milestones, pace, { review: false }).minutes, estimateOf(milestones, pace, { review: false }).basis], [20, { measured: true, tasks: 4, minutesPerTask: 10, retryRate: 0 }], "no RIO, so no retry");
});

const briefCtx = (review?: boolean) => {
  const task = { id: "m1-t1", title: "Base the lamp", intent: "Write the lamp.", status: "flying", attempts: 1, repo: "root", worktree: "/p/.claude/worktrees/light-m1-t1-root", branch: "mission/light-m1-t1", touches: ["src/lamp.txt"] };
  const repo = { label: "root", path: "/p", base: "main", branch: "mission/light", integration: "/p/.claude/worktrees/light-integration-root", land: "merge" };
  const milestone = { n: 1, title: "the lamp", done: "the lamp exists", tasks: [task] };
  return { projectPath: "/p", proof: "npm test", ...(review === undefined ? {} : { review }), mission: { id: "light", name: "light", plan: "plan.md", repos: [repo], milestones: [milestone] }, milestone, task, repo } as never;
};

test("the Light Wingman brief promises no RIO and keeps the checklist and the proof; the default brief is unchanged", () => {
  const light = wingmanBrief(briefCtx(false));
  const full = wingmanBrief(briefCtx());
  assert.equal(wingmanBrief(briefCtx(true)), full, "a template that reviews gets the default brief, byte for byte");
  assert.ok(full.includes("A RIO that is not you will check the work against this list; check it yourself first, so its review confirms rather than discovers:"));
  assert.ok(full.includes("; the RIO reads the commit. Report it; do not grade it. The RIO judges."));
  assert.equal(light.includes("A RIO that is not you"), false);
  assert.equal(light.includes("the RIO reads the commit"), false);
  assert.equal(light.includes("The RIO judges"), false);
  assert.ok(light.includes("No RIO reviews this mission: its template leaves review out, so what you commit is merged as you leave it. Check the list yourself.\n"));
  for (const line of RIO_CHECKLIST) assert.ok(light.includes(`- ${line}`), line);
  assert.ok(light.includes("Then run this task's own proof in your worktree, before your last commit: every command the task above names to prove it, then the project's proof from its maverick.json, `npm test`. Put each command with its result (whether it passed, and the lines of output that say so) in that commit's message and in your final message. Report it; do not grade it.\n"));
  assert.equal(light.split("\n").length, full.split("\n").length, "the same brief, with the RIO's lines said differently");
});

test("the interview under Light names the template, its stages and the branch, and the gate's refusal; under mission it is unchanged", () => {
  const project = { id: "p", name: "P", path: "/p", trackers: [] } as never;
  const merge = [{ label: "root", base: "main", land: "merge" as const }];
  const older = interviewPrompt(project, { id: "m", brief: "a lamp" } as never, "/p/plan.md", merge, "merge");
  const mission = interviewPrompt(project, { id: "m", brief: "a lamp", template: defaultWorkflow() } as never, "/p/plan.md", merge, "merge", "mission/m");
  assert.equal(mission, older, "the full template says nothing new, branch or no branch");
  assert.equal(/template/.test(mission), false);

  const light = interviewPrompt(project, { id: "m", brief: "a lamp", template: LIGHT } as never, "/p/plan.md", merge, "merge", "mission/m");
  assert.ok(light.startsWith(older.slice(0, older.indexOf("You may read anything"))), "everything before is as it was");
  assert.ok(light.includes('This mission runs the template "Light" (light), whose stages are, in order: Interview, Plan gate, Preflight, Build, Merge, Land, Close. Nothing else runs.'));
  assert.ok(light.includes("It is unverified: it has no review, proof or walk, so no RIO reads a task and a task passes when its Wingman finishes. Its work stays on the mission branch mission/m, and Cory takes it from there by hand."));
  assert.ok(light.includes("So the plan promises no review, proof or walk, and no milestone has a `_walk:_` line: leave it out, though the format above shows it."));
  assert.ok(light.includes("a repo set to land by `pr` or `push` is refused at the plan gate, because unverified work never leaves its mission branch. Tell Cory that in your first round of questions"));

  const pr = interviewPrompt(project, { id: "m", brief: "a lamp", template: LIGHT } as never, "/p/plan.md", [{ label: "root", base: "main", land: "merge" }, { label: "api", base: "develop", land: "pr" }], "merge", "mission/m");
  assert.ok(pr.includes("Here that is api (pr): tell Cory in your first round of questions, so he can set its land to merge in maverick.json or choose a template that verifies."));
});
