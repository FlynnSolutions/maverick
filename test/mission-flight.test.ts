/**
 * The whole flight, as the code flew it before any template existed: the before half of a before
 * and after, so no later change may touch this file. Invented missions go through the real
 * `src/missions.ts` with a fake `claude` first on PATH and real git in temp repos, and the test
 * plays each session's part between sweeps. Every record is seeded with no template, as a record
 * is on disk today, so this is also the proof that an older record runs and lands as the default.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, test, type TestContext } from "node:test";
import { tempRepo } from "./fixtures.ts";

const made: string[] = [];
const scratch = (name: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `mv-m1-t1-flight-${name}-`)));
  made.push(dir);
  return dir;
};

// config.ts reads these once when the module graph loads, so they are set before the imports below.
const sessions = scratch("sessions");
process.env.SESSION_CONSOLE_SESSIONS = sessions;
process.env.SESSION_CONSOLE_HOME = scratch("home");
process.env.CLAUDE_CONFIG_DIR = scratch("claude");
// A Wingman or a RIO running this test carries its own; the fake must see only what the flight sets.
delete process.env.MAVERICK_TASK;
const { approveMission, closeMission, parsePlan, readMission, recordWalkthrough, summarizeMission, sweepMissions, sweepSoon } = await import("../src/missions.ts");
const { walkthroughState } = await import("../src/questions.ts");
type Mission = NonNullable<Awaited<ReturnType<typeof readMission>>>;

/**
 * The fakes, first on PATH. They append to one log, so its order is the order things really
 * happened in: `claude` every spawn with its id, folder, task and arguments, `gh` its arguments,
 * `flight-proof` the moment a project's proof finished, which it holds until the test lets it. A record's fields end in NUL and a
 * record ends in 0x1e, because a brief holds anything else. Anything `claude` does not expect (a
 * Strike Lead's `-p` turn) is logged as a spawn too, so the literal list catches it.
 */
const bin = scratch("bin");
const log = join(bin, "events");
const listing = join(bin, "agents.json");
const script = (name: string, body: string): void => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(join(bin, name), 0o755);
};
const logs = (...fields: string[]): string => `printf '%s\\0' ${fields.join(" ")} >> "${log}"; printf '\\036' >> "${log}"`;
script("claude", `case "$1" in
  agents) cat "${listing}"; exit 0 ;;
  stop) ${logs("stop", '"$2"')}; exit 0 ;;
esac
n=$(( $(cat "${bin}/count" 2>/dev/null || echo 160) + 1 )); echo "$n" > "${bin}/count"
id=$(printf '%x' "$n")
${logs("spawn", '"$id"', '"$(pwd)"', '"\${MAVERICK_TASK:-}"', '"$@"')}
echo "backgrounded · $id"`);
script("gh", `${logs("gh", '"$@"')}
echo "https://example.test/flight/pull/1"`);
const proofMayEnd = join(bin, "proof-may-end");
// Let go with the temp folder as well, so a test that fails while holding a proof cannot hang the run.
script("flight-proof", `until [ -e "${proofMayEnd}" ] || [ ! -d "${bin}" ]; do sleep 0.05; done
${logs("proof", '"$(pwd)"')}`);
const realPath = process.env.PATH;
process.env.PATH = `${bin}:${realPath}`;
after(() => {
  process.env.PATH = realPath;
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const events = (): string[][] => (existsSync(log) ? readFileSync(log, "utf8").split("\x1e").slice(0, -1).map((r) => r.split("\0").slice(0, -1)) : []);
const valueOf = (args: string[], flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const spawns = () => events().filter(([kind]) => kind === "spawn").map(([, id, cwd, task, ...args]) => ({ id, cwd, task, args, name: valueOf(args, "--name"), agent: valueOf(args, "--agent"), tools: valueOf(args, "--tools"), prompt: args.at(-1)! }));

const RIO_FENCE = "Bash,Read,Grep,Glob";
const FILLED = `<main><h1>The widget</h1>
<div class="tc" data-id="c1"><p class="tc-title">Open the widget</p></div>
<div class="tc" data-id="c2"><p class="tc-title">Close the widget</p></div>
</main>
`;
const walked = (verdicts: Record<string, string>, more: object = {}) => ({ progress: { total: 2, answered: Object.keys(verdicts).length, verdicts, updatedAt: "2020-01-01T00:00:00Z", ...more } });

/** One mission on a project of its own, as `startMission` and the plan gate leave it: planned, its plan written, nothing approved. No template field, on purpose. */
const flight = (t: TestContext, id: string, opts: { land: "merge" | "pr"; plan: string; proof: string }) => {
  // Frozen, and moved a minute per step below, so every stamp in the ledger is exact and a pass that crosses a minute by chance writes nothing extra.
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2020, 0, 1, 9, 0).getTime() });
  rmSync(log, { force: true });
  writeFileSync(proofMayEnd, "", "utf8");
  t.after(() => writeFileSync(proofMayEnd, "", "utf8"));
  const { dir: root, git } = tempRepo(`mv-m1-t1-flight-${id}`);
  made.push(root);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write("maverick.json", JSON.stringify({ missions: { wingmanAgent: "wingman", proof: opts.proof, ...(opts.land === "pr" ? { land: "pr" } : {}) } }));
  write(".claude/agents/wingman.md", "a wingman\n");
  write(".claude/agents/rio.md", "a rio\n");
  write("deliverables/CHECKLIST.md", "# Checklist\n\n## 🔥 Priority\n\n## 📋 Backlog\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the project");
  write(`deliverables/missions/${id}.md`, opts.plan);
  const project = { id: `p-${id}`, name: "P", path: root, trackers: [{ label: "CHECKLIST", path: join(root, "deliverables/CHECKLIST.md") }] } as never;
  const seeded = {
    id, project: `p-${id}`, name: id.replace("-", " "), brief: "a line", status: "planned", created: new Date().toISOString(), plan: `deliverables/missions/${id}.md`,
    repos: [], land: opts.land, trackerIndex: 0, lead: { sessionId: `lead-${id}`, started: new Date().toISOString() }, chat: [],
    milestones: parsePlan(opts.plan, ["root"]).milestones, rev: 2,
  };
  mkdirSync(join(sessions, "missions", `p-${id}`), { recursive: true });
  writeFileSync(join(sessions, "missions", `p-${id}`, `${id}.json`), `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

  const finished = new Set<string>();
  const integration = join(root, ".claude/worktrees", `${id}-integration-root`);
  const record = (): Mission => JSON.parse(readFileSync(join(sessions, "missions", `p-${id}`, `${id}.json`), "utf8")) as Mission;
  const task = (taskId: string) => record().milestones.flatMap((m) => m.tasks).find((x) => x.id === taskId)!;
  /** One real pass. `sweepSoon` drops the agent listing, which `sweepMissions` alone would keep for 20 s, and its timer is unref'd, so something here has to hold the loop open. */
  const sweep = (): Promise<void> => new Promise((resolve, reject) => {
    writeFileSync(listing, JSON.stringify(spawns().map((s) => ({ id: s.id, sessionId: `session-${s.id}`, cwd: s.cwd, kind: "background", state: finished.has(s.id) ? "done" : "working", ...(finished.has(s.id) ? {} : { pid: 4242 }) }))), "utf8");
    const open = setInterval(() => undefined, 1_000);
    sweepSoon(project, (p) => sweepMissions(p).then(() => { clearInterval(open); resolve(); }, (err) => { clearInterval(open); reject(err); }), 0);
  });
  return {
    project, root, git, integration, record, task, sweep,
    id,
    /** A step later: the next minute on the ledger's clock. */
    step: (): void => t.mock.timers.tick(60_000),
    /** The Wingman's part: a commit on the task's branch, then its agent finished. */
    wingman: (taskId: string, path: string, text: string): void => {
      const { worktree, claudeId } = task(taskId);
      mkdirSync(dirname(join(worktree!, path)), { recursive: true });
      writeFileSync(join(worktree!, path), text, "utf8");
      execFileSync("git", ["-C", worktree!, "add", "--", path]);
      execFileSync("git", ["-C", worktree!, "commit", "-q", "-m", `${taskId}: ${path}`]);
      finished.add(claudeId!);
    },
    /** The RIO's part: its verdict where the record says, then its agent finished. */
    rio: (taskId: string, findings: string): void => {
      const { review } = task(taskId);
      writeFileSync(review!.file, findings, "utf8");
      finished.add(review!.claudeId);
    },
    /** The proof runs detached: the pass starts it and a later pass reads it. */
    sweepToProof: async (): Promise<void> => {
      const start = performance.now();
      for (await sweep(); !record().milestones[0].proof; await sweep()) {
        if (performance.now() - start > 120_000) throw new Error("the proof never reached the record");
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    /** The builder's part: the template it was given, filled in and committed where `walkthroughFile` says, then its agent finished. */
    builder: (): string => {
      const file = join("deliverables/testing", `${id}-m1-walkthrough.html`);
      const placed = readFileSync(join(integration, file), "utf8");
      assert.match(placed, /<[a-z][^>]*\sdata-example\b/, "the template is in place before the builder has done anything");
      assert.ok(placed.includes(`const KEY = "${id}-m1";`), "with its key already set");
      writeFileSync(join(integration, file), FILLED, "utf8");
      execFileSync("git", ["-C", integration, "add", "--", file]);
      execFileSync("git", ["-C", integration, "commit", "-q", "-m", "the walkthrough"]);
      finished.add(record().milestones[0].walkthrough!.claudeId!);
      return relative(root, join(integration, file));
    },
    finish: (claudeId: string): void => { finished.add(claudeId); },
    ledger: () => parsePlan(readFileSync(join(integration, `deliverables/missions/${id}.md`), "utf8")),
  };
};

/** The list of spawns as the test asserts it: name, `--agent`, `--tools`, the folder and the task it was told. */
const sequence = (root: string) => spawns().map((s) => ({ name: s.name, agent: s.agent, tools: s.tools, in: relative(root, s.cwd), task: s.task }));
const stamp = (minute: number): string => `2020-01-01 09:${String(minute).padStart(2, "0")}`;

const MERGE_PLAN = `# Mission: flight merge

An invented mission, to fly the whole flow once.

## Milestone 1: the widget

_done when: the widget exists and is painted_
_walk: open the widget; close the widget_

- [ ] **Base the widget**
  - touches: src/widget.txt
  Write the widget to src/widget.txt.

- [ ] **Paint the widget**
  - touches: src/paint.txt
  - needs: m1-t1
  Write its paint to src/paint.txt.

## Contracts

- **the widget** (owner: m1-t1): a text file at src/widget.txt
`;

test("a record with no template flies the whole flow: a retry, a needing task, proof, a failed walk and its fix, a close and a summary", { timeout: 300_000 }, async (t) => {
  const f = flight(t, "flight-merge", { land: "merge", plan: MERGE_PLAN, proof: "test -f src/widget.txt && test -f src/paint.txt && flight-proof" });
  assert.equal("template" in f.record(), false, "seeded as an older record is");

  // The blessing: the first task goes, the one that needs it waits.
  const approved = await approveMission(f.project, f.id);
  assert.equal(approved.status, "flying");
  assert.deepEqual(f.record().milestones[0].tasks.map((x) => x.status), ["flying", "pending"]);

  // Wingman, RIO, a failing verdict.
  f.step();
  f.wingman("m1-t1", "src/widget.txt", "a widget, empty\n");
  await f.sweep();
  assert.equal(f.task("m1-t1").status, "reviewing");
  f.step();
  const [firstWingman, firstRio] = [f.task("m1-t1").claudeId!, f.task("m1-t1").review!.claudeId];
  f.rio("m1-t1", "verdict: fail\n\n- BLOCKER(src/widget.txt, fix): the widget is empty.\n");
  await f.sweep();

  // The retry: a fresh Wingman in the same worktree, told what the RIO found, and the earlier sessions stopped.
  assert.deepEqual([f.task("m1-t1").status, f.task("m1-t1").attempts, f.task("m1-t1").verdict], ["flying", 2, undefined]);
  assert.notEqual(f.task("m1-t1").claudeId, firstWingman);
  assert.match(spawns().at(-1)!.prompt, /the widget is empty/);
  assert.deepEqual(events().filter(([kind]) => kind === "stop").map(([, id]) => id), [firstWingman, firstRio]);
  assert.equal(f.task("m1-t2").status, "pending", "nothing starts on a task that has not passed");

  // A pass, and the needing task goes in the same sweep.
  f.step();
  f.wingman("m1-t1", "src/widget.txt", "a widget, whole\n");
  await f.sweep();
  f.step();
  f.rio("m1-t1", "verdict: pass\n");
  await f.sweep();
  assert.equal(f.task("m1-t1").status, "passed");
  assert.equal(f.task("m1-t2").status, "flying");

  // The needing task, then the merge onto the mission branch, then the proof on the merged tree.
  f.step();
  f.wingman("m1-t2", "src/paint.txt", "paint\n");
  await f.sweep();
  f.step();
  f.rio("m1-t2", "verdict: pass with notes\n\n- NOTE(src/paint.txt, ship): the paint is thin.\n");
  await f.sweepToProof();
  assert.equal(f.record().milestones[0].proof!.ok, true);
  assert.equal(f.git("show", "mission/flight-merge:src/widget.txt"), "a widget, whole\n", "the retry's commit is what merged");
  assert.equal(f.git("show", "mission/flight-merge:src/paint.txt"), "paint\n");
  assert.equal(f.record().status, "review", "every milestone is proved");
  assert.equal(spawns().at(-1)!.name, "walkthrough · m1 the widget", "the pass that read the proof sent the builder");

  // The builder leaves the document, and the sweep reads it off the branch.
  f.step();
  const doc = f.builder();
  await f.sweep();
  assert.equal(f.record().milestones[0].walkthrough!.doc, doc);
  assert.equal(walkthroughState(f.record().milestones[0]), "walking");

  // A walk with one failed case: the fix task (M29), the milestone reopened.
  f.step();
  await recordWalkthrough(f.project, f.id, 1, walked({ c1: "pass", c2: "fail" }, { notes: { c2: "it stays open" } }));
  const reopened = f.record();
  assert.equal(reopened.status, "flying");
  assert.equal(reopened.milestones[0].merged, undefined);
  assert.equal(reopened.milestones[0].proof, undefined);
  assert.deepEqual(reopened.milestones[0].walkthrough!.fixes!.map((x) => [x.round, x.task, x.cases, x.cleared]), [[1, "m1-fix1", ["c2"], undefined]]);
  assert.equal(walkthroughState(reopened.milestones[0]), "fixing");
  assert.equal(f.task("m1-fix1").status, "pending");
  await assert.rejects(() => closeMission(f.project, f.id), /not ready to close/);

  // The fix flies, is reviewed, merges and is proved like any other task.
  f.step();
  await f.sweep();
  assert.equal(f.task("m1-fix1").status, "flying");
  assert.match(spawns().at(-1)!.prompt, /c2: fail\. it stays open/);
  f.step();
  f.wingman("m1-fix1", "src/widget.txt", "a widget, whole, and it closes\n");
  await f.sweep();
  f.step();
  f.rio("m1-fix1", "verdict: pass\n");
  await f.sweepToProof();
  const proved = f.record();
  assert.equal(proved.status, "review");
  assert.equal(f.git("show", "mission/flight-merge:src/widget.txt"), "a widget, whole, and it closes\n");
  assert.ok(proved.milestones[0].walkthrough!.fixes![0].cleared, "merged and proved, so the round is cleared");
  assert.deepEqual(proved.milestones[0].walkthrough!.progress!.verdicts, { c1: "pass" }, "only the failed case is walked again");
  assert.equal(walkthroughState(proved.milestones[0]), "walking");
  await assert.rejects(() => closeMission(f.project, f.id), /not walked yet: milestone 1 \(walking\)/);

  // The re-walk, then the close.
  f.step();
  await recordWalkthrough(f.project, f.id, 1, walked({ c1: "pass", c2: "pass" }, { round: 1 }));
  assert.equal(walkthroughState(f.record().milestones[0]), "walked");
  f.step();
  const closed = await closeMission(f.project, f.id);
  assert.deepEqual(closed.ticked.sort(), ["Base the widget", "Mission: flight merge", "Paint the widget"]);
  assert.deepEqual(closed.pullRequests, []);

  // The summary, on demand, after the close.
  f.step();
  const asked = await summarizeMission(f.project, f.id);
  writeFileSync(join(sessions, "missions", `p-${f.id}`, `${f.id}-summary.md`), "- one\n- two\n- three\n", "utf8");
  f.finish(asked.summary!.claudeId!);
  await f.sweep();

  // Every session the flow started, in order.
  const wingmen = (taskId: string) => ({ agent: "wingman", tools: undefined, in: `.claude/worktrees/flight-merge-${taskId}-root`, task: taskId });
  const rio = { agent: "rio", tools: RIO_FENCE, in: "", task: "" };
  assert.deepEqual(sequence(f.root), [
    { name: "flight merge · Base the widget", ...wingmen("m1-t1") },
    { name: "RIO · Base the widget", ...rio },
    { name: "flight merge · Base the widget (retry 2)", ...wingmen("m1-t1") },
    { name: "RIO · Base the widget", ...rio },
    { name: "flight merge · Paint the widget", ...wingmen("m1-t2") },
    { name: "RIO · Paint the widget", ...rio },
    { name: "walkthrough · m1 the widget", agent: undefined, tools: undefined, in: ".claude/worktrees/flight-merge-integration-root", task: "" },
    { name: "flight merge · fix the 1 case walk 1 of milestone 1 failed", ...wingmen("m1-fix1") },
    { name: "RIO · fix the 1 case walk 1 of milestone 1 failed", ...rio },
    { name: "summary · flight merge", ...rio },
  ]);
  assert.equal(events().filter(([kind]) => kind === "proof").length, 2, "once for each merge, on the merged tree");
  assert.deepEqual(events().filter(([kind]) => kind === "proof").map(([, cwd]) => relative(f.root, cwd)), [".claude/worktrees/flight-merge-integration-root", ".claude/worktrees/flight-merge-integration-root"]);
  assert.equal(events().some(([kind]) => kind === "gh"), false, "a mission that lands by merge opens nothing");

  // Where it all ended up.
  const end = f.record();
  assert.equal("template" in end, false, "never back-filled");
  assert.deepEqual([end.status, end.trouble, end.proofRequired], ["closed", undefined, true]);
  assert.deepEqual(end.milestones[0].tasks.map((x) => [x.id, x.status, x.attempts, x.reviews, x.verdict]), [
    ["m1-t1", "passed", 2, 2, "pass"],
    ["m1-t2", "passed", 1, 1, "pass with notes"],
    ["m1-fix1", "passed", 1, 1, "pass"],
  ]);
  assert.deepEqual(end.milestones[0].tasks[1].carried, ["NOTE(src/paint.txt, ship): the paint is thin."]);
  const [m] = end.milestones;
  assert.deepEqual([Boolean(m.merged), m.proof?.ok, m.hold, m.conflicts, walkthroughState(m)], [true, true, undefined, undefined, "walked"]);
  assert.deepEqual([end.summary?.text, end.summary?.failed], ["- one\n- two\n- three", undefined]);

  // The ledger, every line as it was written.
  const ledger = f.ledger();
  assert.deepEqual(ledger.log, [
    `${stamp(0)} m1-t1 Base the widget: pending to flying`,
    `${stamp(1)} m1-t1 Base the widget: flying to reviewing`,
    `${stamp(2)} m1-t1 Base the widget: reviewing to flying`,
    `${stamp(3)} m1-t1 Base the widget: flying to reviewing`,
    `${stamp(4)} m1-t1 Base the widget: reviewing to passed (RIO: pass)`,
    `${stamp(4)} m1-t2 Paint the widget: pending to flying`,
    `${stamp(5)} m1-t2 Paint the widget: flying to reviewing`,
    `${stamp(6)} m1-t2 Paint the widget: reviewing to passed (RIO: pass with notes) with 1 notes carried`,
    `${stamp(6)} merged: milestone 1 (the widget) is on the mission branch`,
    `${stamp(8)} m1-fix1 fix the 1 case walk 1 of milestone 1 failed: new to pending`,
    `${stamp(8)} decision: milestone 1 walk 1 failed c2: one fix task, m1-fix1, and those cases are walked again once it merges`,
    `${stamp(9)} m1-fix1 fix the 1 case walk 1 of milestone 1 failed: pending to flying`,
    `${stamp(10)} m1-fix1 fix the 1 case walk 1 of milestone 1 failed: flying to reviewing`,
    `${stamp(11)} m1-fix1 fix the 1 case walk 1 of milestone 1 failed: reviewing to passed (RIO: pass)`,
    `${stamp(11)} merged: milestone 1 (the widget) is on the mission branch`,
    `${stamp(13)} decision: closed by Cory: 3 item(s) ticked`,
  ]);
  assert.deepEqual(ledger.milestones[0].tasks.map((x) => [x.id, x.status, x.attempts, x.verdict]), [["m1-t1", "passed", 2, "pass"], ["m1-t2", "passed", 1, "pass with notes"]], "the plan's own tasks carry their state; a fix task lives in the log");

  // The base got the tracker's two commits and nothing of the work; the report sits beside the ledger.
  assert.deepEqual(f.git("log", "--format=%s", "main").trim().split("\n"), ['console: mission "flight merge" done (3 items)', 'console: plan mission "flight merge" (1 milestones, 2 tasks)', "the project", "base"]);
  assert.equal(f.git("ls-tree", "main", "src"), "");
  assert.match(f.git("show", "mission/flight-merge:deliverables/missions/flight-merge-report.md"), /flight merge/);
});

const PR_PLAN = `# Mission: flight pr

An invented mission, to see when a pull request is opened.

## Milestone 1: the widget

_done when: the widget exists_
_walk: open the widget; close the widget_

- [ ] **Base the widget**
  - touches: src/widget.txt
  Write the widget to src/widget.txt.
`;

test("a repo that lands by pull request lands after the proof and before the walkthrough builder, and the close does not land it again", { timeout: 300_000 }, async (t) => {
  const f = flight(t, "flight-pr", { land: "pr", plan: PR_PLAN, proof: "test -f src/widget.txt && flight-proof" });
  const remote = scratch("remote");
  execFileSync("git", ["-C", remote, "init", "-q", "--bare", "-b", "main"]);
  writeFileSync(join(remote, "hooks/post-receive"), `#!/bin/sh\nread -r old new ref\n${logs("push", '"$ref"')}\n`, "utf8");
  chmodSync(join(remote, "hooks/post-receive"), 0o755);
  f.git("remote", "add", "origin", remote);

  await approveMission(f.project, f.id);
  f.step();
  f.wingman("m1-t1", "src/widget.txt", "a widget\n");
  await f.sweep();
  f.step();
  // The proof is held open across real passes: while it runs, nothing lands and no builder goes.
  rmSync(proofMayEnd);
  f.rio("m1-t1", "verdict: pass\n");
  await f.sweep();
  await f.sweep();
  assert.ok(f.record().milestones[0].merged, "merged, and its proof still running");
  assert.equal(f.record().milestones[0].proof, undefined);
  assert.equal(f.record().status, "flying");
  assert.deepEqual(events().map(([kind, ...rest]) => (kind === "spawn" ? valueOf(rest, "--name") : kind)), ["flight pr · Base the widget", "RIO · Base the widget"]);
  writeFileSync(proofMayEnd, "", "utf8");
  await f.sweepToProof();

  // In the one log the fakes share, so this is the order they really ran in.
  const labels = (): string[] => events().map(([kind, ...rest]) => {
    if (kind === "spawn") return `spawn ${valueOf(rest, "--name")}`;
    if (kind === "gh") return `gh ${rest.slice(0, 9).join(" ")}`;
    return kind === "push" ? `push ${rest[0]}` : kind;
  });
  const flown = [
    "spawn flight pr · Base the widget",
    "spawn RIO · Base the widget",
    "proof",
    "push refs/heads/mission/flight-pr",
    "gh pr create --head mission/flight-pr --base main --title flight pr (root) --body",
    "spawn walkthrough · m1 the widget",
  ];
  assert.deepEqual(labels(), flown);
  assert.match(events().find(([kind]) => kind === "gh")!.at(-1)!, /^Mission \*\*flight pr\*\*, planned and flown from Maverick\./);
  assert.equal(f.record().repos[0].landed, "https://example.test/flight/pull/1");
  assert.equal(execFileSync("git", ["-C", remote, "show", "mission/flight-pr:src/widget.txt"], { encoding: "utf8" }), "a widget\n", "the merged work is what was pushed");
  assert.equal(f.record().status, "review");
  const pushed = execFileSync("git", ["-C", remote, "rev-parse", "mission/flight-pr"], { encoding: "utf8" });

  f.step();
  f.builder();
  await f.sweep();
  f.step();
  await recordWalkthrough(f.project, f.id, 1, walked({ c1: "pass", c2: "pass" }));
  f.step();
  const closed = await closeMission(f.project, f.id);

  assert.deepEqual(closed.pullRequests, ["https://example.test/flight/pull/1"], "the close reports the one landing");
  assert.deepEqual(labels(), flown, "nothing pushed, opened or spawned again at the close");
  assert.equal(execFileSync("git", ["-C", remote, "rev-parse", "mission/flight-pr"], { encoding: "utf8" }), pushed);
  assert.deepEqual(sequence(f.root), [
    { name: "flight pr · Base the widget", agent: "wingman", tools: undefined, in: ".claude/worktrees/flight-pr-m1-t1-root", task: "m1-t1" },
    { name: "RIO · Base the widget", agent: "rio", tools: RIO_FENCE, in: "", task: "" },
    { name: "walkthrough · m1 the widget", agent: undefined, tools: undefined, in: ".claude/worktrees/flight-pr-integration-root", task: "" },
  ]);

  const end = f.record();
  assert.equal("template" in end, false, "never back-filled");
  assert.deepEqual([end.status, end.trouble, end.land, end.repos[0].land], ["closed", undefined, "pr", "pr"]);
  assert.deepEqual(end.milestones[0].tasks.map((x) => [x.id, x.status, x.attempts, x.verdict]), [["m1-t1", "passed", 1, "pass"]]);
  assert.deepEqual([Boolean(end.milestones[0].merged), end.milestones[0].proof?.ok, end.milestones[0].hold, walkthroughState(end.milestones[0])], [true, true, undefined, "walked"]);
  assert.deepEqual(f.ledger().log, [
    `${stamp(0)} m1-t1 Base the widget: pending to flying`,
    `${stamp(1)} m1-t1 Base the widget: flying to reviewing`,
    `${stamp(2)} m1-t1 Base the widget: reviewing to passed (RIO: pass)`,
    `${stamp(2)} merged: milestone 1 (the widget) is on the mission branch`,
    `${stamp(5)} decision: closed by Cory: 2 item(s) ticked, https://example.test/flight/pull/1`,
  ]);
  assert.equal(f.git("ls-tree", "main", "src"), "", "nothing merged to the base by a tool");
});
