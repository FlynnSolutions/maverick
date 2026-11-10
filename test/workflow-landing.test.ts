/**
 * Unverified work cannot land. Under a template that leaves out review, proof or walk, a repo set
 * to land by `pr` or `push` is refused at the plan gate, and refused again at landing when
 * `maverick.json` changes after the gate; setting it back to merge lets the mission go on. The real
 * `src/missions.ts` and the real sweep, with a fake `claude` and a fake `gh` first on PATH that log
 * every call, and real git in temp repos, each with a bare `origin` that a push would reach.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { flightHarness } from "./flight-harness.ts";
import { tempRepo } from "./fixtures.ts";

// config.ts reads its environment once when the module graph loads, so this runs before the imports below.
const { made, scratch, sessions, bin, listing, spawned } = flightHarness("mv-m1-t5-landing");
const ghLog = join(bin, "gh-calls");
writeFileSync(join(bin, "gh"), `#!/bin/sh
printf '%s ' "$@" >> "${ghLog}"; printf '\\036' >> "${ghLog}"
case "$1 $2" in
  "pr create") echo "https://example.test/pull/7" ;;
esac
`, "utf8");
chmodSync(join(bin, "gh"), 0o755);
const { approveMission, closeMission, landAgain, parsePlan, preflightFor, previewPlan, sweepMissions, sweepSoon } = await import("../src/missions.ts");
const { builtInWorkflows, defaultWorkflow } = await import("../src/workflows.ts");
const { DEFAULT_MISSION_CONFIG } = await import("../src/project-config.ts");
type Mission = import("../src/missions.ts").Mission;
type Workflow = import("../src/workflows.ts").Workflow;

const LIGHT = builtInWorkflows().find((w) => w.id === "light")!;
const WINGMAN = "m1-t5-wingman";
const RIO = "m1-t5-rio";
const ghCalls = (): string[] => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").split("\x1e").filter(Boolean) : []);
const REASON = (label: string, land: string): string => `${label} is set to land by ${land}, but this mission's template leaves out review, proof, walk, so its work stays on its mission branch; set ${label}'s land to merge in maverick.json, or choose a template that verifies`;

/** A repo with a bare `origin`, so a push would land somewhere this test can look. */
const withOrigin = (prefix: string) => {
  const repo = tempRepo(prefix);
  const origin = scratch(`${prefix}-origin`);
  execFileSync("git", ["init", "-q", "--bare", origin]);
  repo.git("remote", "add", "origin", origin);
  repo.git("push", "-q", "origin", "main");
  made.push(repo.dir);
  return { ...repo, origin, branches: () => execFileSync("git", ["-C", origin, "branch", "--format=%(refname:short)"], { encoding: "utf8" }).split("\n").filter(Boolean) };
};

const PLAN = `# Mission: landing

An invented mission, flown light.

## Milestone 1: the lamp

_done when: the lamp exists_

- [ ] **Base the lamp**
  - touches: src/lamp.txt
  Write the lamp to src/lamp.txt.
`;

const writeIn = (root: string, path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
};

/** One Light mission on a project of its own with one repo, planned and not approved, landing by merge. */
const flow = (t: TestContext, id: string, template: Workflow = LIGHT) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2020, 0, 1, 9, 0).getTime() });
  const repo = withOrigin(`mv-m1-t5-${id}`);
  const root = repo.dir;
  const config = (land: string): void => writeIn(root, "maverick.json", JSON.stringify({ missions: { wingmanAgent: WINGMAN, rioAgent: RIO, land } }));
  config("merge");
  writeIn(root, `.claude/agents/${WINGMAN}.md`, "an agent\n");
  writeIn(root, "deliverables/CHECKLIST.md", "# Checklist\n\n## 🔥 Priority\n\n## 📋 Backlog\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "the project");
  writeIn(root, `deliverables/missions/${id}.md`, PLAN);
  const project = { id: `p-${id}`, name: "P", path: root, trackers: [{ label: "CHECKLIST", path: join(root, "deliverables/CHECKLIST.md") }] } as never;
  const file = join(sessions, "missions", `p-${id}`, `${id}.json`);
  const seeded = {
    id, project: `p-${id}`, name: id, brief: "a line", status: "planned", created: new Date().toISOString(), plan: `deliverables/missions/${id}.md`,
    repos: [], land: "merge", trackerIndex: 0, lead: { sessionId: `lead-${id}`, started: new Date().toISOString() }, chat: [],
    milestones: parsePlan(PLAN, ["root"], [], { walk: false }).milestones, rev: 2, template,
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

  const finished = new Set<string>();
  const record = (): Mission => JSON.parse(readFileSync(file, "utf8")) as Mission;
  const task = () => record().milestones[0].tasks[0];
  const sweep = (): Promise<void> => new Promise((resolve, reject) => {
    writeFileSync(listing, JSON.stringify(spawned().map((s) => ({ id: s.id, sessionId: `session-${s.id}`, cwd: s.cwd, kind: "background", state: finished.has(s.id) ? "done" : "working", ...(finished.has(s.id) ? {} : { pid: 4242 }) }))), "utf8");
    const open = setInterval(() => undefined, 1_000);
    sweepSoon(project, (p) => sweepMissions(p).then(() => { clearInterval(open); resolve(); }, (err) => { clearInterval(open); reject(err); }), 0);
  });
  /** The Wingman's part, held back until asked: a commit on the task's branch, then its agent finished. */
  const build = (): void => {
    const { worktree, claudeId } = task();
    writeIn(worktree!, "src/lamp.txt", "a lamp\n");
    execFileSync("git", ["-C", worktree!, "add", "--", "src/lamp.txt"]);
    execFileSync("git", ["-C", worktree!, "commit", "-q", "-m", "m1-t1: src/lamp.txt"]);
    finished.add(claudeId!);
  };
  return { id, project, repo, config, record, task, sweep, build, step: (): void => t.mock.timers.tick(60_000) };
};

test("the gate refuses a Light plan with a pr repo and a push repo, naming each, and passes it with merge", async () => {
  const root = withOrigin("mv-m1-t5-gate-root");
  const api = withOrigin("mv-m1-t5-gate-api");
  const plan = parsePlan(`# Mission: two\n\n## Milestone 1: both\n\n_done when: both_\n\n- [ ] **Root**\n  - repo: root\n  - touches: a\n  A.\n\n- [ ] **Api**\n  - repo: api\n  - touches: b\n  B.\n`, ["root", "api"], [], { walk: false });
  assert.deepEqual(plan.problems, []);
  const cfg = { ...DEFAULT_MISSION_CONFIG, rioAgent: "m1-t5-no-such-rio", wingmanAgent: undefined };
  const project = { id: "p-gate", name: "P", path: root.dir, trackers: [] } as never;
  const gate = (rootLand: "merge" | "pr" | "push", apiLand: "merge" | "pr" | "push", template: Workflow) =>
    preflightFor(project, cfg, [{ label: "root", path: root.dir, land: rootLand }, { label: "api", path: api.dir, land: apiLand }], plan, { template });

  const refused = await gate("pr", "push", LIGHT);
  const unverified = refused.filter((c) => c.name.startsWith("unverified landing"));
  assert.deepEqual(unverified.map((c) => [c.kind, c.name, c.status, c.refuses, c.detail]), [
    ["landing", "unverified landing for root", "fail", true, REASON("root", "pr")],
    ["landing", "unverified landing for api", "fail", true, REASON("api", "push")],
  ]);
  assert.deepEqual(refused.filter((c) => c.refuses).map((c) => c.name), ["unverified landing for root", "unverified landing for api"], "only the landing refuses: both remotes are there");
  assert.equal(refused.some((c) => c.kind === "agent" && /rio/.test(c.name)), false, "Light reviews nothing, so a RIO that is not installed is not asked for");

  const merged = await gate("merge", "merge", LIGHT);
  assert.deepEqual(merged.filter((c) => c.kind === "landing"), [], "with merge there is nothing to land and nothing to refuse");
  assert.deepEqual(merged.filter((c) => c.refuses).map((c) => c.name), []);

  // The full template is as it was: no unverified line, the remote checked, and its RIO asked for.
  const full = await gate("pr", "push", defaultWorkflow());
  assert.deepEqual(full.filter((c) => c.kind === "landing").map((c) => [c.name, c.status]), [["remote for root", "ok"], ["remote for api", "ok"]]);
  assert.equal(full.some((c) => c.name.startsWith("unverified landing")), false);
  assert.equal(full.find((c) => c.name === "agent m1-t5-no-such-rio")?.refuses, true);
});

test("approving a Light plan whose repo lands by pr is refused at the gate, and nothing is sent", async (t) => {
  const f = flow(t, "gate-pr");
  f.config("pr");
  const preview = await previewPlan(f.project, f.id);
  assert.deepEqual(preview.preflight!.filter((c) => c.refuses).map((c) => [c.name, c.detail]), [["unverified landing for root", REASON("root", "pr")]]);
  await assert.rejects(() => approveMission(f.project, f.id), /unverified landing for root/);
  assert.equal(f.record().status, "planned");
  assert.deepEqual(spawned().filter((s) => s.cwd.startsWith(f.repo.dir)), [], "nothing was sent");
});

test("a Light mission whose maverick.json flips to pr mid-flight is refused at landAgain, held at landing, and released by setting it back to merge", { timeout: 120_000 }, async (t) => {
  const f = flow(t, "flip");
  await approveMission(f.project, f.id);
  assert.equal(f.task().status, "flying");

  // The project changes its mind while the Wingman works; landing again follows it and is refused.
  f.config("pr");
  const before = ghCalls().length;
  const refused = await landAgain(f.project, f.id);
  assert.deepEqual(refused.landed, []);
  assert.deepEqual(refused.failed, [`root: it is set to land by pr, but this mission's template leaves out review, proof, walk, so its work stays on its mission branch; set its land to merge in maverick.json and land again`]);
  assert.equal(f.record().repos[0].land, "pr", "the record follows the project, so the sweep sees the pr too");

  // The task passes and the milestone merges; landing is tried, refused, and holds the milestone.
  f.step();
  f.build();
  await f.sweep();
  const held = f.record();
  assert.ok(held.milestones[0].merged, "merged onto the mission branch");
  assert.equal(held.milestones[0].hold?.kind, "landing");
  assert.match(held.milestones[0].hold!.reason, /could not land: root: it is set to land by pr, but this mission's template leaves out review, proof, walk/);
  assert.equal(held.status, "blocked");
  assert.equal(held.repos[0].landed, undefined);
  await assert.rejects(() => closeMission(f.project, f.id), /is blocked, not ready to close/);
  assert.deepEqual(ghCalls().slice(before), [], "no gh call");
  assert.deepEqual(f.repo.branches(), ["main"], "nothing was pushed");

  // Back to merge: landing again follows it, the hold comes off, and the mission is at review.
  f.config("merge");
  const released = await landAgain(f.project, f.id);
  assert.deepEqual([released.landed, released.failed], [[], []]);
  assert.equal(released.mission.repos[0].land, "merge");
  assert.equal(released.mission.milestones[0].hold, undefined, "the hold is off");
  assert.equal(released.mission.status, "review");
  f.step();
  const closed = await closeMission(f.project, f.id);
  assert.equal(closed.mission.status, "closed");
  assert.deepEqual(closed.pullRequests, []);
  assert.deepEqual(ghCalls().slice(before), [], "still no gh call");
  assert.deepEqual(f.repo.branches(), ["main"], "and nothing pushed");
});

test("a Light mission at review whose maverick.json flips to pr is refused at the close, and nothing is ticked, pushed or opened", { timeout: 120_000 }, async (t) => {
  const f = flow(t, "close");
  await approveMission(f.project, f.id);
  f.step();
  f.build();
  await f.sweep();
  assert.equal(f.record().status, "review");

  f.config("pr");
  const before = ghCalls().length;
  const refused = await landAgain(f.project, f.id);
  assert.deepEqual(refused.failed.map((x) => x.split(":")[0]), ["root"]);
  assert.match(refused.mission.trouble ?? "", /^still could not land: root: it is set to land by pr/);
  await assert.rejects(() => closeMission(f.project, f.id), /landing it failed and nothing has been ticked: root: it is set to land by pr, but this mission's template leaves out review, proof, walk/);
  assert.equal(f.record().status, "review", "not closed");
  assert.equal(readFileSync(join(f.repo.dir, "deliverables/CHECKLIST.md"), "utf8").includes("[x]"), false, "nothing ticked");
  assert.deepEqual(ghCalls().slice(before), [], "no gh call");
  assert.deepEqual(f.repo.branches(), ["main"], "nothing was pushed");
});

/** A mission at a landing hold with one repo and its work merged, seeded as the record would read. */
const seededHold = (id: string, land: "pr" | "push", template?: Workflow) => {
  const repo = withOrigin(`mv-m1-t5-${id}`);
  repo.git("checkout", "-q", "-b", `mission/${id}`);
  writeIn(repo.dir, "src/lamp.txt", "a lamp\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "the lamp");
  repo.git("checkout", "-q", "main");
  // `push` is honoured only for a repo named in maverick.json, never project-wide.
  writeIn(repo.dir, "maverick.json", JSON.stringify({ missions: { repos: { root: { land } } } }));
  const file = join(sessions, "missions", `p-${id}`, `${id}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({
    id, project: `p-${id}`, name: id, brief: "b", status: "blocked", created: "2026-01-01T00:00:00Z", approved: "2026-01-01T00:00:00Z", plan: "p.md", trackerIndex: 0, land, rev: 1,
    ...(template ? { template } : {}), trouble: "could not land",
    repos: [{ label: "root", path: repo.dir, base: "main", branch: `mission/${id}`, integration: join(repo.dir, "none"), land }],
    milestones: [{ n: 1, title: "m", done: "d", dispatched: "2026-01-01T00:00:00Z", merged: "2026-01-01T00:00:00Z", hold: { kind: "landing", reason: "could not land", at: "2026-01-01T00:00:00Z" },
      tasks: [{ id: "m1-t1", title: "t", intent: "i", repo: "root", status: "passed", attempts: 1, verdict: "pass", commits: ["c"] }] }],
  }), "utf8");
  return { project: { id: `p-${id}`, name: "P", path: repo.dir, trackers: [] } as never, repo };
};

test("a full mission landing by pr still pushes its branch and opens a pull request", async () => {
  const { project, repo } = seededHold("full-pr", "pr");
  const before = ghCalls().length;
  const { mission, landed, failed } = await landAgain(project, "full-pr");
  assert.deepEqual([landed, failed], [["https://example.test/pull/7"], []]);
  assert.equal(mission.repos[0].landed, "https://example.test/pull/7");
  assert.equal(mission.milestones[0].hold, undefined);
  assert.deepEqual(repo.branches().sort(), ["main", "mission/full-pr"], "the branch was pushed");
  const calls = ghCalls().slice(before);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith("pr create --head mission/full-pr --base main --title full-pr (root) --body "), calls[0]);
});

test("a Light mission seeded to land by push or pr is refused at landing, pushing and opening nothing", async () => {
  for (const land of ["push", "pr"] as const) {
    const id = `light-${land}`;
    const { project, repo } = seededHold(id, land, LIGHT);
    const before = ghCalls().length;
    const { mission, landed, failed } = await landAgain(project, id);
    assert.deepEqual(landed, []);
    assert.deepEqual(failed, [`root: it is set to land by ${land}, but this mission's template leaves out review, proof, walk, so its work stays on its mission branch; set its land to merge in maverick.json and land again`]);
    assert.equal(mission.repos[0].landed, undefined);
    assert.equal(mission.milestones[0].hold?.kind, "landing", "the hold stays on");
    assert.deepEqual(ghCalls().slice(before), [], `${land}: no gh call`);
    assert.deepEqual(repo.branches(), ["main"], `${land}: nothing pushed`);
    assert.equal(execFileSync("git", ["-C", repo.origin, "rev-parse", "main"], { encoding: "utf8" }), repo.git("rev-parse", "main"), `${land}: origin's main did not move`);
  }
});
