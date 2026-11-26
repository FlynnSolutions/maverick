#!/usr/bin/env node
/**
 * Saltmarsh: an invented project for walking workflow templates (milestone 1 of workflow templates
 * m2) against this checkout's own server. Nothing in it is real: the repo, its tracker and its
 * templates are made up, and the server it is registered with keeps its registry and its mission
 * records in the seed's folder, never in ~/.claude.
 *
 *   node tools/seed-templates.mjs           the project: one project template, one broken one, land by merge
 *   node tools/seed-templates.mjs --scale   the same, plus 54 more project templates, 6 more broken ones,
 *                                           and two paused missions of 12 milestones and 340 tasks each
 *   node tools/seed-templates.mjs --clear   remove the folder and everything in it (stop the server first)
 *
 * `--dir <folder>` puts it somewhere other than <tmpdir>/maverick-walk-templates, and `--port` picks
 * the port the printed server command uses (8797). It prints the command that starts the server.
 * The scale missions are paused (`pausedFor` set, which is what keeps them paused through a sweep) with
 * no task flying, so the sweep spawns nothing for them. With `--scale` the printed command also puts a
 * stand-in `claude` first on PATH, which answers and spawns nothing real: a "resume" pressed on a
 * seeded mission would otherwise send 50 real Wingmen. Walk the real flight on a seed without it.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values: opts } = parseArgs({ options: { scale: { type: "boolean" }, clear: { type: "boolean" }, dir: { type: "string" }, port: { type: "string" } } });
const dir = opts.dir ?? join(tmpdir(), "maverick-walk-templates");
const port = opts.port ?? "8797";

if (opts.clear) {
  rmSync(dir, { recursive: true, force: true });
  console.log(`cleared ${dir}`);
  process.exit(0);
}
if (existsSync(dir)) {
  console.error(`${dir} is already seeded; run with --clear first`);
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
const base = realpathSync(dir);
const repo = join(base, "saltmarsh");
const consoleHome = join(base, "console");
const sessions = join(base, "sessions");
for (const d of [repo, consoleHome, sessions]) mkdirSync(d, { recursive: true });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const write = (rel, text) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text, "utf8");
};
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

git("init", "-q", "-b", "main");
git("config", "user.name", "Saltmarsh walk");
git("config", "user.email", "walk@example.com");

const tracker = join(repo, "deliverables", "CHECKLIST.md");
write("deliverables/CHECKLIST.md", `# Saltmarsh checklist

## 🔥 Priority

- [ ] \`[ENG]\` **Tide gauge readings on the board**
  - created: 2026-11-01
  The board shows the last gauge reading for each creek.

## 📋 Backlog

- [ ] \`[ENG]\` **Footpath closures list**
  - created: 2026-11-02

## ✅ Shipped

- [x] \`[ENG]\` **Creek names**
  - created: 2026-10-20
`);
write("README.md", "# Saltmarsh\n\nAn invented project: a tiny tide gauge log, for walking Maverick's workflow templates.\n");
write("gauge.mjs", "export const readings = [];\n");
write("maverick.json", json({ missions: { wingmanAgent: "wingman", land: "merge" } }));
write(".gitignore", ".claude/worktrees/\n");
// This checkout's Wingman, so a flight runs the standing orders the branch ships, not whatever ~/.claude holds.
mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
copyFileSync(join(root, ".claude", "agents", "wingman.md"), join(repo, ".claude", "agents", "wingman.md"));

const builtIn = (id) => JSON.parse(readFileSync(join(root, "src", "workflows", `${id}.json`), "utf8"));
const MISSION = builtIn("mission");
const LIGHT = builtIn("light");
// A verified project template: the full flight under the project's own name.
write(".maverick/workflows/survey.json", json({ ...MISSION, id: "survey", name: "Survey", description: "The full flight, named for the creek survey: reviewed, proved and walked." }));
// A broken one: review before build, which the validator refuses.
const tasksOf = (w) => w.stages.find((s) => s.id === "milestones").stages.find((s) => s.id === "tasks");
const quick = structuredClone(MISSION);
tasksOf(quick).stages.reverse();
write(".maverick/workflows/quick.json", json({ ...quick, id: "quick", name: "Quick", description: "Reviews before it builds, so it cannot be chosen." }));

if (opts.scale) {
  const LONG = "A template a project keeps for one recurring kind of job, written by hand, with a description long enough to wrap twice at a phone's width so the card's height is tested by real text.";
  for (let i = 1; i <= 54; i++) {
    const n = String(i).padStart(2, "0");
    const from = i % 2 ? MISSION : LIGHT;
    write(`.maverick/workflows/bulk-${n}.json`, json({ ...from, id: `bulk-${n}`, name: `Bulk template ${n} for the creek gauges and footpaths`, description: `${n}. ${LONG}` }));
  }
  const noGate = structuredClone(LIGHT);
  noGate.stages = noGate.stages.filter((s) => s.id !== "plan-gate");
  const lonelyWalk = structuredClone(MISSION);
  lonelyWalk.stages.find((s) => s.id === "milestones").stages = lonelyWalk.stages.find((s) => s.id === "milestones").stages.filter((s) => s.id !== "walk");
  write(".maverick/workflows/broken-a.json", "{ \"id\": \"broken-a\", \"stages\": [ \n");
  write(".maverick/workflows/broken-b.json", json({ ...LIGHT, id: "not-broken-b" }));
  write(".maverick/workflows/broken-c.json", json({ ...LIGHT, id: "broken-c", owner: "harbour master" }));
  write(".maverick/workflows/broken-d.json", json({ ...quick, id: "broken-d" }));
  write(".maverick/workflows/broken-e.json", json({ ...noGate, id: "broken-e" }));
  write(".maverick/workflows/broken-f.json", json({ ...lonelyWalk, id: "broken-f" }));
}

git("add", ".");
git("commit", "-q", "-m", "saltmarsh: the checklist, the gauge and the templates");

if (opts.scale) {
  const records = join(sessions, "missions", "saltmarsh");
  mkdirSync(records, { recursive: true });
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const head = git("rev-parse", "--short", "HEAD").trim();
  const mission = (id, name, template) => {
    const task = (m, t, status) => ({ id: `m${m}-t${t}`, title: `Read creek gauge ${m}.${t} and log its height`, intent: `Read creek gauge ${m}.${t} and log its height`, status, attempts: status === "pending" ? 0 : 1, repo: "root" });
    const milestones = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      const size = n === 7 ? 120 : 20;
      const merged = n < 7;
      const tasks = Array.from({ length: size }, (_, t) => task(n, t + 1, merged || (n === 7 && t < 70) ? "passed" : "pending"));
      return { n, title: `Gauges, round ${n}`, done: `every gauge in round ${n} has a logged height`, tasks,
        ...(merged ? { dispatched: ago(600 - n * 40), merged: ago(560 - n * 40), mergeShas: { root: head }, ...(template.id === "mission" ? { walkthrough: { waived: { note: "seeded for scale", at: ago(550 - n * 40) } } } : {}) } : {}),
        ...(n === 7 ? { dispatched: ago(300) } : {}) };
    });
    const plan = `deliverables/missions/${id}.md`;
    write(plan, `# ${name}\n\nSeeded for scale: invented gauges.\n\n${milestones.map((m) => `## Milestone ${m.n}: ${m.title}\n\n_done when: ${m.done}_\n\n${m.tasks.map((t) => `- [ ] **${t.title}**\n`).join("")}`).join("\n")}`);
    git("add", plan);
    git("commit", "-q", "-m", `saltmarsh: the ${id} plan`);
    git("branch", `mission/${id}`, "main");
    const integration = join(base, `int-${id}`);
    git("worktree", "add", "-q", integration, `mission/${id}`);
    const record = { id, project: "saltmarsh", name, brief: `Log every creek gauge's height, ${template.name} edition.`, status: "paused", pausedFor: "seeded for scale: nothing may fly", created: ago(720), approved: ago(700), plan,
      repos: [{ label: "root", path: repo, base: "main", branch: `mission/${id}`, integration, land: "merge" }], land: "merge", trackerIndex: 0, milestones, template, rev: 1 };
    writeFileSync(join(records, `${id}.json`), json(record), "utf8");
  };
  mission("scale-light", "Log every gauge, light", LIGHT);
  mission("scale-full", "Log every gauge, in full", MISSION);
}

// The stand-in lists no agents and records each spawn beside itself, as test/harbor.ts's does.
const bin = join(base, "bin");
if (opts.scale) {
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), `#!/bin/sh
if [ "$1" = agents ]; then echo '[]'; exit 0; fi
printf '%s\\n' "$*" >> "${bin}/spawns"
echo "backgrounded · seed0"
`, "utf8");
  chmodSync(join(bin, "claude"), 0o755);
}

writeFileSync(join(consoleHome, "projects.json"), json([{ id: "saltmarsh", name: "Saltmarsh", path: repo, trackers: [{ label: "CHECKLIST", path: tracker }] }]), "utf8");

console.log(`seeded ${base}${opts.scale ? " (with the scale set)" : ""}
project:  ${repo}
start the server from this checkout${opts.scale ? ", with the stand-in claude" : ""}:
  ${opts.scale ? `PATH=${bin}:$PATH ` : ""}SESSION_CONSOLE_HOME=${consoleHome} SESSION_CONSOLE_SESSIONS=${sessions} SESSION_CONSOLE_PORT=${port} MAVERICK_SERVER_LOG=${join(base, "server.log")} node server.ts
then open http://127.0.0.1:${port}/?project=saltmarsh&view=workspace`);
