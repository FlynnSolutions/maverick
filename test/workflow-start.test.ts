/**
 * A mission starts from the template chosen for it, and its view says which and where it is. The
 * real `startMission` with a fake `claude` first on PATH and real git in temp repos, then the same
 * door over HTTP on the invented Harbor project, where the pinned copy is read back through the
 * `mission=` route after the project's own file was edited and then deleted.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { flightHarness } from "./flight-harness.ts";
import { tempRepo, until } from "./fixtures.ts";
import { startHarbor, type Harbor } from "./harbor.ts";

// config.ts reads its environment once when the module graph loads, so this runs before the imports below.
const { made, listing } = flightHarness("mv-m1-t3-start", `-p) echo '{"is_error":false,"result":"","structured_output":{"message":"Tell me more.","questions":[],"planReady":false}}'; exit 0 ;;`);
const { flightOf, leadBusy, missionView, readMission, startMission } = await import("../src/missions.ts");
const { builtInWorkflows, chooseTemplate, defaultWorkflow } = await import("../src/workflows.ts");
type Mission = import("../src/missions.ts").Mission;
type MissionTask = import("../src/missions.ts").MissionTask;
type Milestone = import("../src/missions.ts").Milestone;
type TemplateChoice = import("../src/workflows.ts").TemplateChoice;
type Workflow = import("../src/workflows.ts").Workflow;

writeFileSync(listing, "[]", "utf8");

const LIGHT = builtInWorkflows()[1];

/** A template of the project's own: Light's stages under another id, so a copy of it is told apart from either built-in. */
const dockside = (description: string): Workflow => ({ ...structuredClone(LIGHT), id: "dockside", name: "Dockside", description });

/** A project of its own: a git repo with a tracker, and whatever templates the test writes under `.maverick/workflows/`. */
const projectFor = (id: string) => {
  const { dir: root, git } = tempRepo(`mv-m1-t3-start-${id}`);
  made.push(root);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write("deliverables/CHECKLIST.md", "# Checklist\n\n## 🔥 Priority\n\n## 📋 Backlog\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the project");
  const project = { id: `p-${id}`, name: "P", path: root, trackers: [{ label: "CHECKLIST", path: join(root, "deliverables/CHECKLIST.md") }] } as never;
  return { project, root, write, record: () => readMission(`p-${id}`, id) };
};

/** Through the real door, and past the Strike Lead's first turn, whose write would race anything after it. */
const started = async (id: string, template?: string) => {
  const p = projectFor(id);
  await startMission(p.project, id, "a line", 0, undefined, template);
  await until(() => !leadBusy({ project: `p-${id}`, id }));
  return p;
};

test("a start with no template pins the same template a mission pinned before there was a choice", async () => {
  const p = await started("start-none");
  const on = await p.record();
  assert.deepEqual(on?.template, structuredClone(defaultWorkflow()));
  assert.equal(on?.template?.id, "mission");
});

test("a start choosing light pins light", async () => {
  const p = await started("start-light", "light");
  const on = await p.record();
  assert.deepEqual(on?.template, structuredClone(LIGHT));
  assert.equal(on?.template?.id, "light");
});

test("a start on a broken project mission.json is refused with the validator's message, and leaves no record", async () => {
  const p = projectFor("start-broken");
  p.write(".maverick/workflows/mission.json", JSON.stringify({ ...structuredClone(defaultWorkflow()), stages: [{ id: "interveiw", kind: "interview" }] }));
  const why = await chooseTemplate(p.root).then(() => "", (err: Error) => err.message);
  assert.equal(why, 'mission.json: stage "interveiw": unknown stage', "the validator's own words");
  await assert.rejects(startMission(p.project, "start-broken", "a line"), (err: Error) => err.message === why);
  assert.equal(await p.record(), null, "nothing was written for a start that was refused");
});

test("a start naming a template the project does not offer is refused", async () => {
  const p = projectFor("start-unknown");
  await assert.rejects(startMission(p.project, "start-unknown", "a line", 0, undefined, "heavy"), /^Error: no template heavy$/);
  assert.equal(await p.record(), null);
});

test("an edit to the project's file after the start leaves the pinned copy unchanged", async () => {
  const p = projectFor("start-edit");
  p.write(".maverick/workflows/dockside.json", JSON.stringify(dockside("as it was")));
  await startMission(p.project, "start-edit", "a line", 0, undefined, "dockside");
  await until(() => !leadBusy({ project: "p-start-edit", id: "start-edit" }));
  p.write(".maverick/workflows/dockside.json", JSON.stringify(dockside("as it is now")));
  assert.equal((await chooseTemplate(p.root, "dockside")).description, "as it is now", "the project's file did change");
  assert.deepEqual((await p.record())?.template, dockside("as it was"));
});

test("missionView carries the workflow it flies, and never the template", async () => {
  const light = await missionView((await started("view-light", "light")).project, "view-light");
  assert.equal("template" in light, false);
  assert.deepEqual({ ...light.workflow, flight: light.workflow.flight.map((s) => s.id) }, {
    id: "light", name: "Light", unverified: true,
    flight: ["interview", "plan-gate", "preflight", "build", "merge", "land", "close"],
  });
  assert.equal(light.workflow.flight[0].state, "now");
  const full = await missionView((await started("view-full")).project, "view-full");
  assert.equal("template" in full, false);
  assert.deepEqual({ ...full.workflow, flight: full.workflow.flight.map((s) => s.label) }, {
    id: "mission", name: "Mission", unverified: false,
    flight: ["Interview", "Plan gate", "Preflight", "Build", "Review", "Merge", "Proof", "Land", "Walk", "Close"],
  });
  assert.deepEqual(full.workflow.flight, flightOf((await readMission("p-view-full", "view-full"))!));
});

/* ---------- flightOf, across every status, for both templates ---------- */

const task = (id: string, status: MissionTask["status"]): MissionTask => ({ id, title: id, intent: "", status, attempts: 1, repo: "root", commits: ["a change"] });
const milestone = (n: number, statuses: MissionTask["status"][], more: Partial<Milestone> = {}): Milestone =>
  ({ n, title: `m${n}`, done: "it is done", tasks: statuses.map((s, i) => task(`m${n}-t${i + 1}`, s)), dispatched: "2026-11-09T09:00:00Z", ...more });
const walked = { doc: "walk.html", progress: { total: 1, answered: 1, verdicts: { a: "pass" }, updatedAt: "2026-11-09T10:00:00Z" } } as unknown as Milestone["walkthrough"];
const merged = { merged: "2026-11-09T09:30:00Z" };
const repo = (land: Mission["land"], landed?: string): Mission["repos"][number] =>
  ({ label: "root", path: "/p", base: "main", branch: "mission/x", integration: "/p/.claude/worktrees/x", land, ...(landed ? { landed } : {}) });

const mission = (template: Workflow, status: Mission["status"], milestones: Milestone[] = [], more: Partial<Mission> = {}): Mission => ({
  id: "x", project: "p", name: "x", brief: "b", status, created: "2026-11-09T08:00:00Z", plan: "deliverables/missions/x.md",
  repos: [repo("merge")], land: "merge", trackerIndex: 0, milestones, template,
  ...(status === "interviewing" || status === "planned" ? {} : { approved: "2026-11-09T08:30:00Z" }),
  proofRequired: template.id === "mission", ...more,
});

/** The strip in one line: each stage's id, `*` for now and `+` for done, then its count. */
const strip = (m: Mission): string => flightOf(m).map((s) => `${s.id}${s.state === "now" ? "*" : s.state === "done" ? "+" : ""}${s.count ? `(${s.count})` : ""}`).join(" ");

const FULL = defaultWorkflow();
const two = (first: Milestone) => [first, milestone(2, ["pending", "pending"], { dispatched: undefined })];

/**
 * Each case once per template: what the record says, and the strip each template draws for it.
 * Light has no review, proof or walk to stand at, so a milestone merged under it is done, and its
 * strip stands at the next milestone's build.
 */
const CASES: Array<{ name: string; at: (w: Workflow) => Mission; full: string; light: string }> = [
  { name: "interviewing", at: (w) => mission(w, "interviewing"),
    full: "interview* plan-gate preflight build review merge proof land walk close",
    light: "interview* plan-gate preflight build merge land close" },
  { name: "planned", at: (w) => mission(w, "planned"),
    full: "interview+ plan-gate* preflight build review merge proof land walk close",
    light: "interview+ plan-gate* preflight build merge land close" },
  { name: "flying, a task flying and one pending", at: (w) => mission(w, "flying", two(milestone(1, ["flying", "pending", "passed"]))),
    full: "interview+ plan-gate+ preflight+ build*(1 of 3) review(1 of 3) merge proof land walk close",
    light: "interview+ plan-gate+ preflight+ build*(1 of 3) merge land close" },
  { name: "flying, tasks with the RIO", at: (w) => mission(w, "flying", two(milestone(1, ["reviewing", "built", "passed"]))),
    full: "interview+ plan-gate+ preflight+ build+(3 of 3) review*(1 of 3) merge proof land walk close",
    light: "interview+ plan-gate+ preflight+ build*(3 of 3) merge land close" },
  { name: "flying, every task passed and not merged", at: (w) => mission(w, "flying", two(milestone(1, ["passed", "passed"]))),
    full: "interview+ plan-gate+ preflight+ build+(2 of 2) review+(2 of 2) merge* proof land walk close",
    light: "interview+ plan-gate+ preflight+ build+(2 of 2) merge* land close" },
  { name: "flying, merged and not proved", at: (w) => mission(w, "flying", two(milestone(1, ["passed"], merged))),
    full: "interview+ plan-gate+ preflight+ build+(1 of 1) review+(1 of 1) merge+ proof* land walk close",
    light: "interview+ plan-gate+ preflight+ build*(0 of 2) merge land close" },
  { name: "flying, proved and a pull request not opened", at: (w) => mission(w, "flying", two(milestone(1, ["passed"], { ...merged, proof: { ok: true, at: "t", output: "" } })), { repos: [repo("pr")] }),
    full: "interview+ plan-gate+ preflight+ build+(1 of 1) review+(1 of 1) merge+ proof+ land* walk close",
    light: "interview+ plan-gate+ preflight+ build*(0 of 2) merge land close" },
  { name: "flying, a landing held", at: (w) => mission(w, "flying", two(milestone(1, ["passed"], { ...merged, proof: { ok: true, at: "t", output: "" }, hold: { kind: "landing", reason: "no remote", at: "t" } })), { repos: [repo("pr")] }),
    full: "interview+ plan-gate+ preflight+ build+(1 of 1) review+(1 of 1) merge+ proof+ land* walk close",
    light: "interview+ plan-gate+ preflight+ build+(1 of 1) merge+ land* close" },
  { name: "flying, landed and owing a walk", at: (w) => mission(w, "flying", two(milestone(1, ["passed"], { ...merged, proof: { ok: true, at: "t", output: "" } })), { repos: [repo("pr", "https://example.com/pr/1")] }),
    full: "interview+ plan-gate+ preflight+ build+(1 of 1) review+(1 of 1) merge+ proof+ land+ walk* close",
    light: "interview+ plan-gate+ preflight+ build*(0 of 2) merge land close" },
  { name: "flying, the last milestone done and its pull request not opened", at: (w) => mission(w, "flying", [milestone(1, ["passed"], { ...merged, proof: { ok: true, at: "t", output: "" }, walkthrough: walked })], { repos: [repo("pr")] }),
    full: "interview+ plan-gate+ preflight+ build+(1 of 1) review+(1 of 1) merge+ proof+ land* walk close",
    light: "interview+ plan-gate+ preflight+ build+(1 of 1) merge+ land* close" },
  { name: "blocked, a task handed back", at: (w) => mission(w, "blocked", two(milestone(1, ["handed-back", "passed"]))),
    full: "interview+ plan-gate+ preflight+ build*(1 of 2) review(1 of 2) merge proof land walk close",
    light: "interview+ plan-gate+ preflight+ build*(1 of 2) merge land close" },
  { name: "paused, mid-review", at: (w) => mission(w, "paused", two(milestone(1, ["reviewing"]))),
    full: "interview+ plan-gate+ preflight+ build+(1 of 1) review*(0 of 1) merge proof land walk close",
    light: "interview+ plan-gate+ preflight+ build*(1 of 1) merge land close" },
  { name: "review", at: (w) => mission(w, "review", [milestone(1, ["passed", "passed"], { ...merged, proof: { ok: true, at: "t", output: "" }, walkthrough: walked })]),
    full: "interview+ plan-gate+ preflight+ build+(2 of 2) review+(2 of 2) merge+ proof+ land+ walk+ close*",
    light: "interview+ plan-gate+ preflight+ build+(2 of 2) merge+ land+ close*" },
  { name: "closed", at: (w) => mission(w, "closed", [milestone(1, ["passed", "passed"], { ...merged, proof: { ok: true, at: "t", output: "" }, walkthrough: walked })]),
    full: "interview+ plan-gate+ preflight+ build+(2 of 2) review+(2 of 2) merge+ proof+ land+ walk+ close+",
    light: "interview+ plan-gate+ preflight+ build+(2 of 2) merge+ land+ close+" },
  { name: "abandoned in flight", at: (w) => mission(w, "abandoned", two(milestone(1, ["passed", "handed-back"]))),
    full: "interview+ plan-gate+ preflight+ build*(1 of 2) review(1 of 2) merge proof land walk close",
    light: "interview+ plan-gate+ preflight+ build*(1 of 2) merge land close" },
  { name: "abandoned in its interview", at: (w) => mission(w, "abandoned", [], { approved: undefined }),
    full: "interview* plan-gate preflight build review merge proof land walk close",
    light: "interview* plan-gate preflight build merge land close" },
];

for (const c of CASES) {
  test(`flightOf, ${c.name}: the strip each template draws`, () => {
    assert.equal(strip(c.at(FULL)), c.full, "mission");
    assert.equal(strip(c.at(LIGHT)), c.light, "light");
  });
}

test("flightOf reads an older record with no template as mission, and labels every stage it draws", () => {
  const old = mission(FULL, "planned");
  delete old.template;
  assert.equal(strip(old), "interview+ plan-gate* preflight build review merge proof land walk close");
  assert.deepEqual(flightOf(old).map((s) => s.label), ["Interview", "Plan gate", "Preflight", "Build", "Review", "Merge", "Proof", "Land", "Walk", "Close"]);
});

test("flightOf is pure: it changes nothing on the record it reads", () => {
  const m = mission(FULL, "flying", two(milestone(1, ["reviewing", "passed"])));
  const before = structuredClone(m);
  flightOf(m);
  assert.deepEqual(m, before);
});

/* ---------- over HTTP ---------- */

let harbor: Harbor;
before(async () => { harbor = await startHarbor(); });
after(async () => { await harbor.stop(); });

const get = async (path: string): Promise<{ status: number; json: unknown }> => {
  const res = await fetch(`${harbor.url}${path}`);
  return { status: res.status, json: await res.json() };
};
const harborFile = (id: string) => join(harbor.repo, ".maverick", "workflows", `${id}.json`);
const harborRecord = (id: string): Mission => JSON.parse(readFileSync(join(harbor.sessions, "missions", "harbor", `${id}.json`), "utf8"));

test("POST /api/missions starts from the template named, and the mission= route serves its pinned copy after the file is edited and deleted", async () => {
  mkdirSync(dirname(harborFile("dockside")), { recursive: true });
  writeFileSync(harborFile("dockside"), JSON.stringify(dockside("as it was")), "utf8");
  const res = await fetch(`${harbor.url}/api/missions?project=harbor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "quay", brief: "a line", template: "dockside" }) });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(harborRecord("quay").template, dockside("as it was"));

  writeFileSync(harborFile("dockside"), JSON.stringify(dockside("as it is now")), "utf8");
  assert.equal(((await get("/api/workflows/dockside?project=harbor")).json as TemplateChoice).description, "as it is now", "the project's file did change");
  const pinned = await get("/api/workflows/dockside?project=harbor&mission=quay");
  assert.equal(pinned.status, 200, JSON.stringify(pinned.json));
  assert.deepEqual(pinned.json, { id: "dockside", name: "Dockside", description: "as it was", source: "project", unverified: true, template: dockside("as it was") });

  rmSync(harborFile("dockside"));
  assert.equal((await get("/api/workflows/dockside?project=harbor")).status, 404, "the project no longer offers it");
  assert.deepEqual((await get("/api/workflows/dockside?project=harbor&mission=quay")).json, pinned.json, "the mission still flies it");
});

test("POST /api/missions with no template pins mission, and one naming a broken template is refused", async () => {
  const res = await fetch(`${harbor.url}/api/missions?project=harbor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "jetty", brief: "a line" }) });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(harborRecord("jetty").template, structuredClone(defaultWorkflow()));
  writeFileSync(harborFile("broken"), "{ not json", "utf8");
  const refused = await fetch(`${harbor.url}/api/missions?project=harbor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "pier", brief: "a line", template: "broken" }) });
  assert.notEqual(refused.status, 200);
  assert.match(await refused.text(), /broken\.json: not JSON/);
  rmSync(harborFile("broken"));
});

test("GET /api/workflows/<id>?mission= reads an older record as mission, and answers 404 for another id, an unknown mission or a path", async () => {
  const old = { id: "old-wharf", project: "harbor", name: "old wharf", brief: "b", status: "closed", created: "2026-10-01T09:00:00Z", plan: "deliverables/missions/old-wharf.md", repos: [], land: "merge", trackerIndex: 0, milestones: [], rev: 1 };
  writeFileSync(join(harbor.sessions, "missions", "harbor", "old-wharf.json"), JSON.stringify(old), "utf8");
  const read = await get("/api/workflows/mission?project=harbor&mission=old-wharf");
  assert.equal(read.status, 200, JSON.stringify(read.json));
  const choice = read.json as TemplateChoice;
  assert.deepEqual([choice.id, choice.name, choice.source, choice.unverified], ["mission", "Mission", "built-in", false]);
  assert.deepEqual(choice.template, structuredClone(defaultWorkflow()));
  assert.equal((await get("/api/workflows/light?project=harbor&mission=old-wharf")).status, 404, "the mission flies mission, not light");
  assert.equal((await get("/api/workflows/mission?project=harbor&mission=no-such")).status, 404);
  assert.equal((await get(`/api/workflows/mission?project=harbor&mission=${encodeURIComponent("../harbor/old-wharf")}`)).status, 404, "a mission id is never a path");
});
