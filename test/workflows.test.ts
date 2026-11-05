/**
 * the template is the flow written down, and the validator is what stops a hand-edited one from
 * meaning something the code does not do. each refusal here checks the stage it names and why.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { missionConfigFor } from "../src/project-config.ts";
import { agentFor, defaultWorkflow, hasStage, loadWorkflow, validateWorkflow, workflowOf, type Stage, type Workflow } from "../src/workflows.ts";

const MISSION_JSON = fileURLToPath(new URL("../src/workflows/mission.json", import.meta.url));

/** a copy to break, since the default is frozen. */
const template = (): Workflow => structuredClone(defaultWorkflow()) as Workflow;

const levelOf = (stages: Stage[], id: string): Stage[] | undefined => {
  if (stages.some((s) => s.id === id)) return stages;
  for (const s of stages) {
    const level = levelOf(s.stages ?? [], id);
    if (level) return level;
  }
  return undefined;
};

const stageOf = (w: Workflow, id: string): Stage => {
  const stage = levelOf(w.stages, id)?.find((s) => s.id === id);
  assert.ok(stage, `the fixture has no ${id}`);
  return stage;
};

const without = (...ids: string[]): Workflow => {
  const w = template();
  for (const id of ids) {
    const level = levelOf(w.stages, id);
    assert.ok(level, `the fixture has no ${id}`);
    level.splice(level.findIndex((s) => s.id === id), 1);
  }
  return w;
};

/** moves `id` to sit straight after `after`, which must be at the same level. */
const moved = (id: string, after: string): Workflow => {
  const w = template();
  const level = levelOf(w.stages, id)!;
  const [stage] = level.splice(level.findIndex((s) => s.id === id), 1);
  level.splice(level.findIndex((s) => s.id === after) + 1, 0, stage);
  return w;
};

const changed = (id: string, change: (s: Stage & Record<string, unknown>) => void): Workflow => {
  const w = template();
  change(stageOf(w, id) as Stage & Record<string, unknown>);
  return w;
};

const refused = (raw: unknown, message: string): void => {
  assert.throws(() => validateWorkflow(raw), { name: "Error", message });
};

/** the tree as indented lines, so the test below reads the file against the flow written by hand. */
const outline = (stages: Stage[], depth = 0): string[] =>
  stages.flatMap((s) => [
    `${"  ".repeat(depth)}${s.id} ${s.kind}${s.over ? ` over ${s.over}` : ""}${s.slot ? ` slot ${s.slot}` : ""}${s.agent ? ` agent ${s.agent}` : ""}`,
    ...outline(s.stages ?? [], depth + 1),
  ]);

test("the built-in template loads, validates, and is today's flow in the order the code runs it", async () => {
  const w = defaultWorkflow();
  assert.equal(w.id, "mission");
  assert.deepEqual(outline(w.stages), [
    "interview interview",
    "plan-gate gate",
    "preflight preflight",
    "milestones for-each over milestones",
    "  tasks for-each over tasks",
    "    build agent slot wingmanAgent",
    "    review agent slot rioAgent",
    "  merge merge",
    "  proof command slot proof",
    "  land land",
    "  walkthrough agent",
    "  walk walk",
    "close close",
    "summary agent slot rioAgent",
  ]);
  assert.deepEqual(await loadWorkflow(MISSION_JSON), w, "the file on disk is what the default answers with");
  assert.deepEqual(validateWorkflow(template()), w);
});

test("the default is one cached copy, and a caller cannot change it for everyone else", () => {
  assert.equal(defaultWorkflow(), defaultWorkflow());
  const w = defaultWorkflow();
  assert.throws(() => { w.id = "other"; }, TypeError);
  assert.throws(() => { w.stages.pop(); }, TypeError);
  assert.throws(() => { stageOf(w, "build").agent = "other"; }, TypeError);
  assert.throws(() => { stageOf(w, "milestones").stages!.pop(); }, TypeError);
  assert.equal(agentFor(defaultWorkflow(), "build", {}), undefined);
});

test("a reordered template is refused, naming the stage out of place", () => {
  refused(moved("interview", "plan-gate"), 'stage "interview": out of order, it comes before "plan-gate"');
  refused(moved("build", "review"), 'stage "build": out of order, it comes before "review"');
  refused(moved("merge", "proof"), 'stage "merge": out of order, it comes before "proof"');
  refused(moved("land", "walk"), 'stage "land": out of order, it comes before "walk"');
  refused(moved("walkthrough", "walk"), 'stage "walkthrough": out of order, it comes before "walk"');
  refused(moved("close", "summary"), 'stage "close": out of order, it comes before "summary"');
});

test("a stage in the wrong place in the tree is refused, which covers landing after the milestone", () => {
  const after = without("land");
  after.stages.splice(after.stages.findIndex((s) => s.id === "close"), 0, { id: "land", kind: "land" });
  refused(after, 'stage "land": may not be left out');
  const before = without("land");
  before.stages.unshift({ id: "land", kind: "land" });
  refused(before, 'stage "land": does not belong in workflow "mission"');
  const merge = template();
  stageOf(merge, "tasks").stages!.push({ id: "merge", kind: "merge" });
  refused(merge, 'stage "merge": does not belong in stage "tasks"');
});

test("an unknown stage is refused by name at every level", () => {
  const top = template();
  top.stages.push({ id: "deploy", kind: "command" });
  refused(top, 'stage "deploy": unknown stage');
  const inside = template();
  stageOf(inside, "tasks").stages!.push({ id: "lint", kind: "command" });
  refused(inside, 'stage "lint": unknown stage');
});

test("a stage appearing twice is refused by name", () => {
  const w = template();
  stageOf(w, "tasks").stages!.push({ id: "review", kind: "agent", slot: "rioAgent" });
  refused(w, 'stage "review": appears twice');
});

test("an unknown kind is refused by name, and so is a real kind on the wrong stage", () => {
  refused(changed("build", (s) => { s.kind = "shell" as Stage["kind"]; }), 'stage "build": unknown kind "shell"');
  refused(changed("merge", (s) => { delete (s as Partial<Stage>).kind; }), 'stage "merge": unknown kind undefined');
  refused(changed("merge", (s) => { s.kind = "land"; }), 'stage "merge": must be kind "merge", not "land"');
});

test("each stage that may not be left out is refused by name", () => {
  for (const id of ["interview", "plan-gate", "preflight", "milestones", "tasks", "build", "review", "merge", "land", "close"]) {
    refused(without(id), `stage "${id}": may not be left out`);
  }
});

test("each permitted leaving-out validates, and the stage is gone", () => {
  for (const ids of [["proof"], ["walkthrough", "walk"], ["summary"], ["proof", "walkthrough", "walk", "summary"]]) {
    const w = validateWorkflow(without(...ids));
    for (const id of ids) assert.equal(hasStage(w, id), false, id);
    assert.equal(hasStage(w, "merge"), true);
  }
});

test("walkthrough and walk are left out only together", () => {
  refused(without("walk"), 'stage "walkthrough": needs "walk", the two are left out only together');
  refused(without("walkthrough"), 'stage "walk": needs "walkthrough", the two are left out only together');
});

test("an agent is allowed on build, review, walkthrough and summary", () => {
  for (const id of ["build", "review", "walkthrough", "summary"]) {
    const w = validateWorkflow(changed(id, (s) => { s.agent = "someone_else-2"; }));
    assert.equal(stageOf(w, id).agent, "someone_else-2");
  }
});

test("an agent on any other stage is refused by name", () => {
  for (const id of ["interview", "plan-gate", "preflight", "milestones", "tasks", "merge", "proof", "land", "walk", "close"]) {
    refused(changed(id, (s) => { s.agent = "someone"; }), `stage "${id}": may not name an agent`);
  }
});

test("an agent name that is not a name is refused, and project-config's rule says the same of it", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mv-workflows-"));
  t.after(() => rm(dir, { recursive: true }));
  const projectConfigTakes = async (name: unknown): Promise<boolean> => {
    await writeFile(join(dir, "maverick.json"), JSON.stringify({ missions: { wingmanAgent: name } }), "utf8");
    return (await missionConfigFor(dir)).wingmanAgent === name;
  };
  for (const name of ["--dangerously-skip-permissions", "-x", "", "a b", "../a", "a/b", "a.b", "a\n", "_a", 7, null, ["a"]]) {
    refused(changed("build", (s) => { (s as Record<string, unknown>).agent = name; }), `stage "build": agent ${JSON.stringify(name)} is not an agent name`);
    assert.equal(await projectConfigTakes(name), false, `project-config takes ${JSON.stringify(name)}`);
  }
  for (const name of ["a", "A9", "9a", "a-b_c"]) {
    assert.equal(validateWorkflow(changed("build", (s) => { s.agent = name; })).id, "mission");
    assert.equal(await projectConfigTakes(name), true, `project-config refuses ${name}`);
  }
});

test("a slot, an over or a nest that is not today's is refused by name", () => {
  refused(changed("build", (s) => { s.slot = "rioAgent"; }), 'stage "build": must take slot "wingmanAgent"');
  refused(changed("review", (s) => { delete s.slot; }), 'stage "review": must take slot "rioAgent"');
  refused(changed("proof", (s) => { delete s.slot; }), 'stage "proof": must take slot "proof"');
  refused(changed("walkthrough", (s) => { s.slot = "wingmanAgent"; }), 'stage "walkthrough": takes no slot');
  refused(changed("tasks", (s) => { s.over = "milestones"; }), 'stage "tasks": must run over "tasks"');
  refused(changed("merge", (s) => { s.over = "tasks"; }), 'stage "merge": takes no over');
  refused(changed("merge", (s) => { s.stages = []; }), 'stage "merge": holds no stages');
  refused(changed("tasks", (s) => { delete s.stages; }), 'stage "tasks": stages must be a list');
});

test("a misspelt field is refused by name, so it cannot quietly mean nothing", () => {
  refused(changed("build", (s) => { s.agnet = "someone"; }), 'stage "build": unknown field "agnet"');
  refused({ ...template(), owner: "someone" }, 'workflow "mission": unknown field "owner"');
});

test("what is not a workflow at all is refused", () => {
  refused(null, "a workflow must be an object");
  refused([], "a workflow must be an object");
  refused({ stages: [] }, "a workflow needs an id");
  refused({ id: "x" }, 'workflow "x": stages must be a list');
  refused({ id: "x", stages: [{ kind: "merge" }] }, 'workflow "x": every stage inside it needs an id');
});

test("loadWorkflow reads and validates one file, and says which", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mv-workflows-"));
  t.after(() => rm(dir, { recursive: true }));
  const file = join(dir, "t.json");
  await writeFile(file, JSON.stringify(without("proof")), "utf8");
  assert.equal(hasStage(await loadWorkflow(file), "proof"), false);
  await writeFile(file, JSON.stringify(without("merge")), "utf8");
  await assert.rejects(loadWorkflow(file), { message: `${file}: stage "merge": may not be left out` });
  await writeFile(file, "{ not json", "utf8");
  await assert.rejects(loadWorkflow(file), (err: Error) => err.message.startsWith(`${file}: `) && err.cause instanceof SyntaxError);
  await assert.rejects(loadWorkflow(join(dir, "absent.json")), { code: "ENOENT" });
});

test("hasStage finds a stage at any depth and nothing else", () => {
  const w = defaultWorkflow();
  for (const id of ["interview", "plan-gate", "preflight", "milestones", "tasks", "build", "review", "merge", "proof", "land", "walkthrough", "walk", "close", "summary"]) {
    assert.equal(hasStage(w, id), true, id);
  }
  assert.equal(hasStage(w, "deploy"), false);
  assert.equal(hasStage(without("proof"), "proof"), false);
  assert.equal(hasStage(without("walkthrough", "walk"), "walk"), false);
});

test("agentFor answers with the stage's own agent, else its slot's value, else undefined", () => {
  const slots = { wingmanAgent: "wingman", rioAgent: "rio" };
  const w = defaultWorkflow();
  assert.equal(agentFor(w, "build", slots), "wingman");
  assert.equal(agentFor(w, "review", slots), "rio");
  assert.equal(agentFor(w, "summary", slots), "rio");
  for (const id of ["build", "review", "walkthrough", "summary"]) {
    assert.equal(agentFor(changed(id, (s) => { s.agent = "someone"; }), id, slots), "someone", id);
  }
  assert.equal(agentFor(w, "walkthrough", slots), undefined, "a walkthrough launches with no --agent, as today");
  assert.equal(agentFor(w, "build", { rioAgent: "rio" }), undefined, "an empty slot is no agent");
  assert.equal(agentFor(w, "merge", slots), undefined);
  assert.equal(agentFor(w, "deploy", slots), undefined);
  assert.equal(agentFor(without("summary"), "summary", slots), undefined);
});

test("agentFor never hands back the proof command as an agent, given a whole mission config", () => {
  const cfg = { wingmanAgent: "wingman", rioAgent: "rio", proof: "npm test" };
  assert.equal(agentFor(defaultWorkflow(), "proof", cfg), undefined);
});

test("workflowOf answers with a pinned copy when there is one and the default when there is none", () => {
  const pinned = without("proof");
  assert.equal(workflowOf({ template: pinned }), pinned);
  assert.equal(workflowOf({}), defaultWorkflow());
  assert.equal(workflowOf({ template: undefined }), defaultWorkflow());
});
