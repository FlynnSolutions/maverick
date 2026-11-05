/**
 * A mission pins its template when it starts. The real `startMission`, the real sweep and real git
 * in temp repos, with a fake `claude` first on PATH. What the record holds is read off the disk,
 * because that copy is the one a restarted console flies from.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { tempRepo, until } from "./fixtures.ts";

const made: string[] = [];
const scratch = (name: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `mv-m1-t3-pin-${name}-`)));
  made.push(dir);
  return dir;
};

// config.ts reads these once when the module graph loads, so they are set before the imports below.
const sessions = scratch("sessions");
process.env.SESSION_CONSOLE_SESSIONS = sessions;
process.env.SESSION_CONSOLE_HOME = scratch("home");
process.env.CLAUDE_CONFIG_DIR = scratch("claude");
const { approveMission, leadBusy, parsePlan, startMission, sweepMissions, sweepSoon } = await import("../src/missions.ts");
const { defaultWorkflow, hasStage, workflowOf } = await import("../src/workflows.ts");
type Stage = import("../src/workflows.ts").Stage;

/** A Strike Lead's turn answers in its schema; anything else is a background session, logged with its folder and arguments. */
const bin = scratch("bin");
const log = join(bin, "spawns");
const listing = join(bin, "agents.json");
writeFileSync(listing, "[]", "utf8");
writeFileSync(join(bin, "claude"), `#!/bin/sh
case "$1" in
  agents) cat "${listing}"; exit 0 ;;
  stop) exit 0 ;;
  -p) echo '{"is_error":false,"result":"","structured_output":{"message":"Tell me more.","questions":[],"planReady":false}}'; exit 0 ;;
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

const spawns = () => (existsSync(log) ? readFileSync(log, "utf8").split("\x1e").slice(0, -1) : []).map((record) => {
  const [id, cwd, ...args] = record.split("\0").slice(0, -1);
  return { id, cwd, agent: args.includes("--agent") ? args[args.indexOf("--agent") + 1] : undefined };
});

const PLAN = `# Mission: pin

An invented mission.

## Milestone 1: the widget

_done when: the widget exists_
_walk: open the widget_

- [ ] **Base the widget**
  - touches: src/widget.txt
  Write the widget to src/widget.txt.
`;
const PROOF = "pin-proof-command";

/** A project of its own, with the three slots filled in `maverick.json` and the plan in place. */
const projectFor = (id: string) => {
  const { dir: root, git } = tempRepo(`mv-m1-t3-pin-${id}`);
  made.push(root);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  const settings = (missions: object): void => write("maverick.json", JSON.stringify({ missions }));
  settings({ wingmanAgent: "pin-wingman", rioAgent: "pin-rio", proof: PROOF });
  for (const agent of ["pin-wingman", "pin-rio", "pin-other-rio"]) write(`.claude/agents/${agent}.md`, "an agent\n");
  write("deliverables/CHECKLIST.md", "# Checklist\n\n## 🔥 Priority\n\n## 📋 Backlog\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the project");
  write(`deliverables/missions/${id}.md`, PLAN);
  const project = { id: `p-${id}`, name: "P", path: root, trackers: [{ label: "CHECKLIST", path: join(root, "deliverables/CHECKLIST.md") }] } as never;
  const file = join(sessions, "missions", `p-${id}`, `${id}.json`);
  const text = (): string => readFileSync(file, "utf8");
  const finished = new Set<string>();
  const list = (): void => writeFileSync(listing, JSON.stringify(spawns().map((s) => ({ id: s.id, sessionId: `session-${s.id}`, cwd: s.cwd, kind: "background", state: finished.has(s.id) ? "done" : "working", ...(finished.has(s.id) ? {} : { pid: 4242 }) }))), "utf8");
  return {
    id, project, root, file, settings, finished, list,
    text,
    record: () => JSON.parse(text()),
    /** One real pass. `sweepSoon` drops the agent listing, and its timer is unref'd, so something here has to hold the loop open. */
    sweep: (): Promise<void> => new Promise((resolve, reject) => {
      list();
      const open = setInterval(() => undefined, 1_000);
      sweepSoon(project, (p) => sweepMissions(p).then(() => { clearInterval(open); resolve(); }, (err) => { clearInterval(open); reject(err); }), 0);
    }),
  };
};

/** Through the real door, and past the Strike Lead's first turn, whose write would race anything after it. */
const started = async (id: string) => {
  const p = projectFor(id);
  await startMission(p.project, id, "a line");
  await until(() => !leadBusy({ project: `p-${id}`, id }));
  return p;
};

const pinned = () => JSON.parse(JSON.stringify(defaultWorkflow()));
const flat = (stages: Stage[]): Stage[] => stages.flatMap((s) => [s, ...flat(s.stages ?? [])]);

test("a started mission carries the template on disk, as slot names and never their values", async () => {
  const p = await started("pin-started");
  const on = p.record();
  assert.equal(on.lead?.sessionId !== undefined, true, "and it kept it through the Strike Lead's first write");
  assert.deepEqual(on.template, pinned());
  const stage = (id: string) => flat(on.template.stages).find((s) => s.id === id);
  assert.deepEqual(stage("build"), { id: "build", kind: "agent", slot: "wingmanAgent" });
  assert.deepEqual(stage("review"), { id: "review", kind: "agent", slot: "rioAgent" });
  assert.deepEqual(stage("proof"), { id: "proof", kind: "command", slot: "proof" });
  for (const value of ["pin-wingman", "pin-rio", PROOF]) assert.equal(JSON.stringify(on.template).includes(value), false, `${value} is the project's, and read at use`);
});

/**
 * The loader's template is cached and its file is the repo's own, so the change is made where it
 * would really happen: a copy of the source with `mission.json` edited, in a fresh process, as a
 * console restarted after the edit is. That process reads and sweeps and writes the same record.
 */
test("changing the template the loader would return leaves a started mission's copy unchanged", async () => {
  const p = await started("pin-frozen");
  await approveMission(p.project, p.id);
  const before = p.record();
  assert.equal(before.status, "flying");
  assert.deepEqual(before.template, pinned());
  assert.equal(hasStage(before.template, "summary"), true, "the copy holds the stage the edit below removes");

  const copy = scratch("copy");
  const repo = fileURLToPath(new URL("..", import.meta.url));
  cpSync(join(repo, "src"), join(copy, "src"), { recursive: true });
  cpSync(join(repo, "package.json"), join(copy, "package.json"));
  const templateFile = join(copy, "src/workflows/mission.json");
  const edited = JSON.parse(readFileSync(templateFile, "utf8"));
  edited.stages = edited.stages.filter((s: { id: string }) => s.id !== "summary");
  writeFileSync(templateFile, JSON.stringify(edited), "utf8");

  const out = join(copy, "out.json");
  const script = join(copy, "restarted.mjs");
  writeFileSync(script, `import { writeFileSync } from "node:fs";
const { readMission, sweepMissions } = await import("./src/missions.ts");
const { defaultWorkflow, hasStage, workflowOf } = await import("./src/workflows.ts");
const project = JSON.parse(process.argv[2]);
const summaryIn = (w) => hasStage(w, "summary");
const read = await readMission(project.id, process.argv[3]);
const answers = { loaderHasSummary: summaryIn(defaultWorkflow()), olderHasSummary: summaryIn(workflowOf({})), pinnedHasSummary: summaryIn(workflowOf(read)) };
await sweepMissions(project);
writeFileSync(process.argv[4], JSON.stringify({ ...answers, afterSweep: workflowOf(await readMission(project.id, process.argv[3])) }));
`, "utf8");
  p.list();
  execFileSync(process.execPath, [script, JSON.stringify(p.project), p.id, out], { encoding: "utf8" });

  const answers = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(answers.loaderHasSummary, false, "the loader in that process really returns the edited template");
  assert.equal(answers.olderHasSummary, false, "and a record with no copy follows it");
  assert.equal(answers.pinnedHasSummary, true, "the pinned record does not");
  assert.deepEqual(answers.afterSweep, before.template, "nor once that process has swept it");
  const after = p.record();
  assert.ok(after.rev > before.rev, `that process really wrote the record (rev ${before.rev} to ${after.rev})`);
  assert.deepEqual(after.template, before.template, "the copy on disk is the one the mission started with");
});

test("editing maverick.json still moves a mission in flight, and leaves its copy alone", async () => {
  const p = await started("pin-live");
  const approved = await approveMission(p.project, p.id);
  const task = approved.milestones[0].tasks[0];
  assert.equal(p.record().proofRequired, true);
  assert.equal(spawns().find((s) => s.id === task.claudeId)?.agent, "pin-wingman");
  const before = p.record().template;
  assert.deepEqual(before, pinned());

  p.settings({ wingmanAgent: "pin-wingman", rioAgent: "pin-other-rio" });
  mkdirSync(dirname(join(task.worktree!, "src/widget.txt")), { recursive: true });
  writeFileSync(join(task.worktree!, "src/widget.txt"), "a widget\n", "utf8");
  execFileSync("git", ["-C", task.worktree!, "add", "--", "src/widget.txt"]);
  execFileSync("git", ["-C", task.worktree!, "commit", "-q", "-m", "the widget"]);
  p.finished.add(task.claudeId!);
  await p.sweep();

  const after = p.record();
  assert.equal(after.proofRequired, false, "the proof the project removed is no longer required");
  assert.equal(after.milestones[0].tasks[0].status, "reviewing");
  assert.equal(spawns().find((s) => s.id === after.milestones[0].tasks[0].review.claudeId)?.agent, "pin-other-rio", "the RIO is the one the project names now");
  assert.deepEqual(after.template, before);
});

test("a record with no template, read and swept and written, still has none and reads as the default", async () => {
  const p = projectFor("pin-older");
  const seeded = {
    id: p.id, project: `p-${p.id}`, name: "pin older", brief: "a line", status: "planned", created: new Date().toISOString(), plan: `deliverables/missions/${p.id}.md`,
    repos: [], land: "merge", trackerIndex: 0, lead: { sessionId: `lead-${p.id}`, started: new Date().toISOString() }, chat: [],
    milestones: parsePlan(PLAN, ["root"]).milestones, rev: 2,
  };
  mkdirSync(dirname(p.file), { recursive: true });
  writeFileSync(p.file, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

  await approveMission(p.project, p.id);
  const approved = p.record();
  assert.equal("template" in approved, false, "approving it adds none");
  await p.sweep();

  const swept = p.record();
  assert.ok(swept.rev > approved.rev, `the sweep really wrote it (rev ${approved.rev} to ${swept.rev})`);
  assert.equal("template" in swept, false, "the sweep adds none");
  assert.equal(p.text().includes('"template"'), false, "nor anywhere inside it");
  assert.equal(workflowOf(swept), defaultWorkflow(), "and it answers with the default itself");
});
