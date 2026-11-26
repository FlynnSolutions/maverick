/**
 * the templates a mission may start from: the two that ship, a project's own files beside them, and
 * the one rule that calls a template unverified. every project here is invented, in a temp folder.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { builtInWorkflows, chooseTemplate, defaultWorkflow, hasStage, templatesFor, unverified, validateWorkflow, type Stage, type Workflow } from "../src/workflows.ts";

const MISSION_DESCRIPTION = "The full flight: every task reviewed by a RIO, the proof on the merged tree, and a walk before it lands.";
const LIGHT_DESCRIPTION = "Explore fast: build and merge, with no review, proof or walk.";

/** a copy to change, since the built-ins are frozen. */
const mission = (): Workflow => structuredClone(defaultWorkflow()) as Workflow;
const light = (): Workflow => structuredClone(builtInWorkflows()[1]) as Workflow;

const without = (w: Workflow, ...ids: string[]): Workflow => {
  const drop = (stages: Stage[]): Stage[] => stages.filter((s) => !ids.includes(s.id)).map((s) => (s.stages ? { ...s, stages: drop(s.stages) } : s));
  return { ...w, stages: drop(w.stages) };
};

const outline = (stages: Stage[], depth = 0): string[] =>
  stages.flatMap((s) => [`${"  ".repeat(depth)}${s.id} ${s.kind}${s.over ? ` over ${s.over}` : ""}${s.slot ? ` slot ${s.slot}` : ""}`, ...outline(s.stages ?? [], depth + 1)]);

/** an invented project, named for this task, holding `files` under `.maverick/workflows/`. */
const project = async (t: TestContext, files?: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `mv-${process.env.MAVERICK_TASK ?? "templates"}-`));
  t.after(() => rm(dir, { recursive: true }));
  if (files) {
    await mkdir(join(dir, ".maverick", "workflows"), { recursive: true });
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, ".maverick", "workflows", name), text, "utf8");
  }
  return dir;
};

const json = (w: unknown): string => JSON.stringify(w, null, 2);

test("light loads, validates, and is interview, gate, preflight, build, merge, land and close", () => {
  const [m, l] = builtInWorkflows();
  assert.equal(m, defaultWorkflow(), "mission is the one cached default");
  assert.equal(l.id, "light");
  assert.equal(l.name, "Light");
  assert.equal(l.description, LIGHT_DESCRIPTION);
  assert.deepEqual(outline(l.stages), [
    "interview interview",
    "plan-gate gate",
    "preflight preflight",
    "milestones for-each over milestones",
    "  tasks for-each over tasks",
    "    build agent slot wingmanAgent",
    "  merge merge",
    "  land land",
    "close close",
  ]);
  assert.deepEqual(validateWorkflow(light()), l);
});

test("the built-ins are frozen, and each call answers the same copies", () => {
  const [m, l] = builtInWorkflows();
  assert.equal(builtInWorkflows()[1], l);
  assert.throws(() => { l.id = "other"; }, TypeError);
  assert.throws(() => { l.stages.pop(); }, TypeError);
  assert.throws(() => { m.name = "other"; }, TypeError);
});

test("mission carries its name and description and is verified; light is unverified", () => {
  const [m, l] = builtInWorkflows();
  assert.equal(m.name, "Mission");
  assert.equal(m.description, MISSION_DESCRIPTION);
  assert.equal(unverified(m), false);
  assert.equal(unverified(l), true);
});

test("leaving out review, proof or walk each makes a template unverified, and summary alone does not", () => {
  for (const ids of [["review"], ["proof"], ["walkthrough", "walk"]]) {
    const w = validateWorkflow(without(mission(), ...ids));
    for (const id of ids) assert.equal(hasStage(w, id), false, id);
    assert.equal(unverified(w), true, ids.join(" and "));
  }
  assert.equal(unverified(validateWorkflow(without(mission(), "summary"))), false);
});

test("review may now be left out, and the stages that may not are still refused by name", () => {
  assert.equal(hasStage(validateWorkflow(without(mission(), "review")), "review"), false);
  for (const id of ["interview", "plan-gate", "preflight", "milestones", "tasks", "build", "merge", "land", "close"]) {
    assert.throws(() => validateWorkflow(without(mission(), id)), { message: `stage "${id}": may not be left out` });
  }
});

test("a name and a description are taken, and each must be a string", () => {
  const w = validateWorkflow({ ...light(), id: "quick", name: "Quick", description: "Fast." });
  assert.equal(w.name, "Quick");
  assert.equal(w.description, "Fast.");
  const bare = validateWorkflow({ id: "bare", stages: light().stages });
  assert.equal(bare.name, undefined);
  assert.throws(() => validateWorkflow({ ...light(), name: 7 }), { message: 'workflow "light": name must be a string' });
  assert.throws(() => validateWorkflow({ ...light(), description: null }), { message: 'workflow "light": description must be a string' });
});

test("an id that cannot name a file or sit in a url is refused", () => {
  for (const id of ["Light", "-light", "a b", "../x", "a/b", "a.b", "a_b", "light\n", "é"]) {
    assert.throws(() => validateWorkflow({ ...light(), id }), { message: `workflow ${JSON.stringify(id)}: an id is lowercase letters, digits and dashes` });
  }
  for (const id of ["a", "9", "light-2", "a-b-c"]) assert.equal(validateWorkflow({ ...light(), id }).id, id);
});

test("an unknown top-level field is still refused by name", () => {
  assert.throws(() => validateWorkflow({ ...light(), owner: "someone" }), { message: 'workflow "light": unknown field "owner"' });
  assert.throws(() => validateWorkflow({ ...light(), title: "Light" }), { message: 'workflow "light": unknown field "title"' });
});

test("a project with no templates folder has the built-ins only, mission first", async (t) => {
  const dir = await project(t);
  const choices = await templatesFor(dir);
  assert.deepEqual(choices, [
    { id: "mission", name: "Mission", description: MISSION_DESCRIPTION, source: "built-in", unverified: false, leftOut: [], template: defaultWorkflow() },
    { id: "light", name: "Light", description: LIGHT_DESCRIPTION, source: "built-in", unverified: true, leftOut: ["review", "proof", "walk"], template: builtInWorkflows()[1] },
  ]);
  const empty = await project(t, {});
  assert.deepEqual(await templatesFor(empty), choices, "an empty folder is the same");
});

test("project files follow the built-ins by id, a same id replaces in place, and other files are skipped", async (t) => {
  const quick = { ...light(), id: "quick", name: "Quick" };
  const deep = { id: "deep", stages: mission().stages };
  const deeper = { ...deep, id: "deep-2" };
  const own = { ...without(mission(), "summary"), name: "Our mission" };
  const dir = await project(t, { "quick.json": json(quick), "deep.json": json(deep), "deep-2.json": json(deeper), "mission.json": json(own), "notes.md": "not a template" });
  const choices = await templatesFor(dir);
  assert.deepEqual(choices.map((c) => [c.id, c.source]), [["mission", "project"], ["light", "built-in"], ["deep", "project"], ["deep-2", "project"], ["quick", "project"]]);
  assert.deepEqual(choices[0], { id: "mission", name: "Our mission", description: MISSION_DESCRIPTION, source: "project", unverified: false, leftOut: [], template: own });
  assert.deepEqual(choices[2], { id: "deep", name: "deep", source: "project", unverified: false, leftOut: [], template: deep }, "a file with no name is named by its id");
  assert.deepEqual(choices[4], { id: "quick", name: "Quick", description: LIGHT_DESCRIPTION, source: "project", unverified: true, leftOut: ["review", "proof", "walk"], template: quick });
});

test("a broken file and a mismatched id are listed with their messages and no template", async (t) => {
  const dir = await project(t, {
    "broken.json": "{ not json",
    "wrong.json": json({ ...light(), id: "other" }),
    "reordered.json": json({ id: "reordered", stages: [...light().stages].reverse() }),
    "light.json": json({ ...mission(), id: "light", owner: "someone" }),
  });
  const choices = await templatesFor(dir);
  assert.deepEqual(choices.map((c) => c.id), ["mission", "light", "broken", "reordered", "wrong"]);
  const broken = choices[2];
  assert.equal(broken.template, undefined);
  assert.match(broken.error ?? "", /^broken\.json: not JSON: /);
  assert.deepEqual({ ...broken, error: undefined }, { id: "broken", name: "broken", source: "project", unverified: false, leftOut: [], error: undefined });
  assert.deepEqual(choices[4], { id: "wrong", name: "wrong", source: "project", unverified: false, leftOut: [], error: 'wrong.json: its id is "other", and it must be its file name, "wrong"' });
  assert.deepEqual(choices[3], { id: "reordered", name: "reordered", source: "project", unverified: false, leftOut: [], error: 'reordered.json: stage "milestones": out of order, it comes before "close"' });
  assert.deepEqual(choices[1], { id: "light", name: "light", source: "project", unverified: false, leftOut: [], error: 'light.json: workflow "light": unknown field "owner"' }, "a broken override still takes the built-in's place");
});

test("a templates path that cannot be read as a folder throws, naming it", async (t) => {
  const dir = await project(t);
  await mkdir(join(dir, ".maverick"));
  await writeFile(join(dir, ".maverick", "workflows"), "a file, not a folder", "utf8");
  const folder = join(dir, ".maverick", "workflows");
  await assert.rejects(templatesFor(dir), (err: Error) => err.message.startsWith(`cannot read ${folder}: `) && /ENOTDIR/.test(err.message));
});

test("chooseTemplate answers with the chosen template, mission by default", async (t) => {
  const quick = { ...light(), id: "quick" };
  const dir = await project(t, { "quick.json": json(quick) });
  assert.equal(await chooseTemplate(dir), defaultWorkflow());
  assert.equal(await chooseTemplate(dir, "light"), builtInWorkflows()[1]);
  assert.deepEqual(await chooseTemplate(dir, "quick"), quick);
});

test("chooseTemplate throws the choice's error, so a broken project mission.json refuses a start", async (t) => {
  const dir = await project(t, { "mission.json": json({ ...mission(), owner: "someone" }) });
  await assert.rejects(chooseTemplate(dir), { message: 'mission.json: workflow "mission": unknown field "owner"' });
  await assert.rejects(chooseTemplate(dir, "mission"), { message: 'mission.json: workflow "mission": unknown field "owner"' });
  assert.equal(await chooseTemplate(dir, "light"), builtInWorkflows()[1], "the others still choose");
});

test("chooseTemplate throws for an id that names no template", async (t) => {
  const dir = await project(t);
  await assert.rejects(chooseTemplate(dir, "nothing"), { message: "no template nothing" });
  await assert.rejects(chooseTemplate(dir, "../mission"), { message: "no template ../mission" });
});
