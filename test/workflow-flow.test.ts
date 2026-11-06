/**
 * The template says who runs a stage. The real `src/missions.ts` and the real sweep with a fake
 * `claude` first on PATH and real git in temp repos: every `--agent` asserted here is one a spawn
 * really carried, and the test plays each session's part between sweeps. The slot agents in the
 * project's `maverick.json` have names of their own, so nothing here can pass on an installed
 * `wingman` or `rio`.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { flightHarness, valueOf } from "./flight-harness.ts";
import { tempRepo } from "./fixtures.ts";

// config.ts reads its environment once when the module graph loads, so this runs before the imports below.
const { made, sessions, listing, spawned } = flightHarness("mv-m1-t4-flow");
const { approveMission, parsePlan, previewPlan, summarizeMission, sweepMissions, sweepSoon } = await import("../src/missions.ts");
const { preflight } = await import("../src/preflight.ts");
const { defaultWorkflow, validateWorkflow } = await import("../src/workflows.ts");
type Stage = import("../src/workflows.ts").Stage;
type Workflow = import("../src/workflows.ts").Workflow;

const allSpawns = () => spawned().map(({ id, cwd, args }) => ({ id, cwd, name: valueOf(args, "--name"), agent: valueOf(args, "--agent"), tools: valueOf(args, "--tools") }));

const RIO_FENCE = "Bash,Read,Grep,Glob";
const SLOT_WINGMAN = "m1-t4-slot-wingman";
const SLOT_RIO = "m1-t4-slot-rio";
const MISSING = "m1-t4-not-installed";

const PLAN = `# Mission: flow

An invented mission.

## Milestone 1: the widget

_done when: the widget exists_
_walk: open the widget_

- [ ] **Base the widget**
  - touches: src/widget.txt
  Write the widget to src/widget.txt.
`;

/** The default with `agent` set on the stages named, and through the real validator, so a test cannot pin what no template could be. */
const naming = (agents: Record<string, string>): Workflow => {
  const w = structuredClone(defaultWorkflow()) as Workflow;
  const walk = (stages: Stage[]): void => {
    for (const stage of stages) {
      if (agents[stage.id]) stage.agent = agents[stage.id];
      walk(stage.stages ?? []);
    }
  };
  walk(w.stages);
  return validateWorkflow(w);
};

/** One mission on a project of its own, planned and not approved, with the template pinned as `startMission` pins it and only the named agents installed. */
const flow = (id: string, opts: { template?: Workflow; slots?: object; installed: string[] }) => {
  const { dir: root, git } = tempRepo(`mv-m1-t4-flow-${id}`);
  made.push(root);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write("maverick.json", JSON.stringify({ missions: opts.slots ?? { wingmanAgent: SLOT_WINGMAN, rioAgent: SLOT_RIO } }));
  for (const agent of opts.installed) write(`.claude/agents/${agent}.md`, "an agent\n");
  write("deliverables/CHECKLIST.md", "# Checklist\n\n## 🔥 Priority\n\n## 📋 Backlog\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the project");
  write(`deliverables/missions/${id}.md`, PLAN);
  const project = { id: `p-${id}`, name: "P", path: root, trackers: [{ label: "CHECKLIST", path: join(root, "deliverables/CHECKLIST.md") }] } as never;
  const file = join(sessions, "missions", `p-${id}`, `${id}.json`);
  const seeded = {
    id, project: `p-${id}`, name: id, brief: "a line", status: "planned", created: new Date().toISOString(), plan: `deliverables/missions/${id}.md`,
    repos: [], land: "merge", trackerIndex: 0, lead: { sessionId: `lead-${id}`, started: new Date().toISOString() }, chat: [],
    milestones: parsePlan(PLAN, ["root"]).milestones, rev: 2,
    ...(opts.template ? { template: opts.template } : {}),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

  const finished = new Set<string>();
  const record = () => JSON.parse(readFileSync(file, "utf8"));
  const task = () => record().milestones[0].tasks[0];
  /** One real pass. `sweepSoon` drops the agent listing, and its timer is unref'd, so something here has to hold the loop open. */
  const sweep = (): Promise<void> => new Promise((resolve, reject) => {
    writeFileSync(listing, JSON.stringify(allSpawns().map((s) => ({ id: s.id, sessionId: `session-${s.id}`, cwd: s.cwd, kind: "background", state: finished.has(s.id) ? "done" : "working", ...(finished.has(s.id) ? {} : { pid: 4242 }) }))), "utf8");
    const open = setInterval(() => undefined, 1_000);
    sweepSoon(project, (p) => sweepMissions(p).then(() => { clearInterval(open); resolve(); }, (err) => { clearInterval(open); reject(err); }), 0);
  });
  /** Only this mission's: every test shares the one fake and its log. */
  const spawns = () => allSpawns().filter((s) => s.cwd.startsWith(root));
  const agentChecks = async (): Promise<string[]> => ((await previewPlan(project, id)).preflight ?? []).filter((c) => c.kind === "agent").map((c) => c.name);
  return {
    id, project, root, record, task, sweep, spawns, agentChecks,
    /** The Wingman's part: a commit on the task's branch, then its agent finished. */
    wingman: (text: string): void => {
      const { worktree, claudeId } = task();
      mkdirSync(join(worktree, "src"), { recursive: true });
      writeFileSync(join(worktree, "src/widget.txt"), text, "utf8");
      execFileSync("git", ["-C", worktree, "add", "--", "src/widget.txt"]);
      execFileSync("git", ["-C", worktree, "commit", "-q", "-m", `the widget: ${text}`]);
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

/** The whole list of who a mission launches: first launch, RIO, a failing verdict and the retry through `handBack`, a second RIO, the merge and its builder, then the summary. */
const fly = async (f: ReturnType<typeof flow>) => {
  await approveMission(f.project, f.id);
  assert.equal(f.task().status, "flying");
  f.wingman("empty");
  await f.sweep();
  assert.equal(f.task().status, "reviewing");
  f.rio("verdict: fail\n\n- BLOCKER(src/widget.txt, fix): the widget is empty.\n");
  await f.sweep();
  assert.deepEqual([f.task().status, f.task().attempts], ["flying", 2], "handed back");
  f.wingman("whole");
  await f.sweep();
  assert.equal(f.task().status, "reviewing");
  f.rio("verdict: pass\n");
  await f.sweep();
  assert.ok(f.record().milestones[0].merged, "merged");
  assert.ok(f.record().milestones[0].walkthrough?.claudeId, "and the builder went");
  const asked = await summarizeMission(f.project, f.id);
  assert.ok(asked.summary?.claudeId, "and the summarizer");
  return f.spawns().map(({ name, agent, tools }) => ({ name, agent, tools }));
};

/** The literal list, the same for every test but for who runs each stage. */
const launched = (id: string, who: { build?: string; review?: string; walkthrough?: string; summary?: string }) => [
  { name: `${id} · Base the widget`, agent: who.build, tools: undefined },
  { name: "RIO · Base the widget", agent: who.review, tools: RIO_FENCE },
  { name: `${id} · Base the widget (retry 2)`, agent: who.build, tools: undefined },
  { name: "RIO · Base the widget", agent: who.review, tools: RIO_FENCE },
  { name: "walkthrough · m1 the widget", agent: who.walkthrough, tools: undefined },
  { name: `summary · ${id}`, agent: who.summary, tools: RIO_FENCE },
];

test("a pinned template that names an agent for each stage launches it there, on the retry too, and a named RIO keeps its fence", { timeout: 120_000 }, async () => {
  const who = { build: "m1-t4-named-build", review: "m1-t4-named-review", walkthrough: "m1-t4-named-walkthrough", summary: "m1-t4-named-summary" };
  // The project's two slots are set and not installed: nothing launches them, so nothing may ask for them.
  const f = flow("flow-named", { template: naming(who), installed: Object.values(who) });
  assert.deepEqual(await f.agentChecks(), [who.review, who.build, who.walkthrough, who.summary].map((a) => `agent ${a}`));
  assert.equal((await previewPlan(f.project, f.id)).wingmanAgent, who.build, "the gate says who really runs the build");
  assert.deepEqual(await fly(f), launched(f.id, who));
  assert.deepEqual(f.record().template, naming(who), "the pinned copy is untouched by the flight");
});

test("with the default pinned, the agents in the project's maverick.json are the ones launched, and a walkthrough builder still gets none", { timeout: 120_000 }, async () => {
  const f = flow("flow-default", { template: naming({}), installed: [SLOT_WINGMAN, SLOT_RIO] });
  assert.deepEqual(await f.agentChecks(), [`agent ${SLOT_RIO}`, `agent ${SLOT_WINGMAN}`]);
  assert.equal((await previewPlan(f.project, f.id)).wingmanAgent, SLOT_WINGMAN);
  assert.deepEqual(await fly(f), launched(f.id, { build: SLOT_WINGMAN, review: SLOT_RIO, summary: SLOT_RIO }));
});

test("a stage the template does not name still follows the project's slot, and a slot nobody launches is not asked for", { timeout: 120_000 }, async () => {
  const f = flow("flow-partial", { template: naming({ review: "m1-t4-named-review" }), installed: ["m1-t4-named-review", SLOT_WINGMAN, SLOT_RIO] });
  assert.deepEqual(await f.agentChecks(), ["agent m1-t4-named-review", `agent ${SLOT_WINGMAN}`, `agent ${SLOT_RIO}`], "the summary still runs as the project's RIO");
  assert.deepEqual(await fly(f), launched(f.id, { build: SLOT_WINGMAN, review: "m1-t4-named-review", summary: SLOT_RIO }));

  const both = flow("flow-partial-both", { template: naming({ review: "m1-t4-named-review", summary: "m1-t4-named-review" }), installed: ["m1-t4-named-review", SLOT_WINGMAN] });
  assert.deepEqual(await both.agentChecks(), ["agent m1-t4-named-review", `agent ${SLOT_WINGMAN}`], "named for both, the RIO slot is launched by nothing, and one name is one line");
  assert.equal((await approveMission(both.project, both.id)).status, "flying");
});

for (const stage of ["build", "review", "walkthrough", "summary"]) {
  test(`preflight refuses a template that names an agent for ${stage} that is not installed, and nothing starts`, async () => {
    const f = flow(`flow-missing-${stage}`, { template: naming({ [stage]: MISSING }), installed: [SLOT_WINGMAN, SLOT_RIO] });
    const check = (await previewPlan(f.project, f.id)).preflight!.find((c) => c.name === `agent ${MISSING}`);
    assert.deepEqual([check?.status, check?.refuses], ["fail", true]);
    await assert.rejects(() => approveMission(f.project, f.id), new RegExp(`preflight: agent ${MISSING}: no ${MISSING}\\.md`));
    assert.equal(f.record().status, "planned");
    assert.equal(f.record().approved, undefined);
    assert.deepEqual(f.spawns(), [], "no session started");
  });
}

test("the default's agent checks are the same names in the same order as the two slots gave", async () => {
  /** The list as it stood before any template: the RIO, then the Wingman if there is one, and a name set twice is checked twice. */
  const slotsOnly = async (f: ReturnType<typeof flow>, slots: { wingmanAgent?: string; rioAgent: string }): Promise<string[]> =>
    (await preflight({ projectPath: f.root, repoPaths: [f.root], requirements: [], remote: [], ...slots })).filter((c) => c.kind === "agent").map((c) => c.name);

  const cases: Array<{ id: string; slots: { wingmanAgent?: string; rioAgent: string }; want: string[] }> = [
    { id: "flow-checks-both", slots: { wingmanAgent: SLOT_WINGMAN, rioAgent: SLOT_RIO }, want: [`agent ${SLOT_RIO}`, `agent ${SLOT_WINGMAN}`] },
    { id: "flow-checks-rio", slots: { rioAgent: SLOT_RIO }, want: [`agent ${SLOT_RIO}`] },
    { id: "flow-checks-same", slots: { wingmanAgent: SLOT_RIO, rioAgent: SLOT_RIO }, want: [`agent ${SLOT_RIO}`, `agent ${SLOT_RIO}`] },
  ];
  for (const { id, slots, want } of cases) {
    // Pinned and not pinned: an older record reads as the default, so it asks for the same.
    const pinned = flow(id, { template: naming({}), slots, installed: [SLOT_WINGMAN, SLOT_RIO] });
    const older = flow(`${id}-older`, { slots, installed: [SLOT_WINGMAN, SLOT_RIO] });
    assert.deepEqual(await slotsOnly(pinned, slots), want, "the list with no agents input, as before");
    assert.deepEqual(await pinned.agentChecks(), want, id);
    assert.deepEqual(await older.agentChecks(), want, `${id}, no template on the record`);
  }
});

test("a project with no wingman agent launches its Wingman with none under the default, as today", { timeout: 120_000 }, async () => {
  const f = flow("flow-no-wingman", { template: naming({}), slots: { rioAgent: SLOT_RIO }, installed: [SLOT_RIO] });
  assert.equal((await previewPlan(f.project, f.id)).wingmanAgent, undefined);
  assert.deepEqual(await fly(f), launched(f.id, { review: SLOT_RIO, summary: SLOT_RIO }));
});
