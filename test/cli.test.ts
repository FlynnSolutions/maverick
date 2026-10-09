/**
 * `bin/maverick` is the protocol from a terminal: the same parser and briefs as the app, with
 * the app's layout. A Strike Lead outside the app must not have to reimplement either.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const cli = join(import.meta.dirname, "..", "bin", "maverick");
const dir = realpathSync(mkdtempSync(join(tmpdir(), "mv-cli-")));
execFileSync("git", ["-C", dir, "init", "-q"]);
execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "base"]);
mkdirSync(join(dir, "deliverables", "missions"), { recursive: true });
const plan = join(dir, "deliverables", "missions", "orbit.md");
await writeFile(plan, [
  "# Mission: Orbit", "", "A test mission.", "",
  "## Milestone 1 — the first", "", "_done when: it parses._", "",
  "- [x] **Parse**", "  - status: passed", "  - attempt: 1", "  - verdict: pass", "  Parse the thing.", "",
  "- [ ] **Write**", "  Write the thing.", "",
  "## Log", "", "- 2026-10-09 10:00 m1-t1 Parse: reviewing to passed (RIO: pass)", "",
].join("\n"), "utf8");
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

test("plan-check prints where every task stands and exits 0 on a flyable plan", () => {
  const { status, stdout } = run("plan-check", plan);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /^flyable: Orbit: 1 milestone\(s\), 2 task\(s\), repos root/m);
  assert.match(stdout, /m1-t1  passed {6}attempt 1 RIO pass {2}Parse/);
  assert.match(stdout, /m1-t2  pending {6}Write/);
  assert.match(stdout, /Log \(1\), last: 2026-10-09 10:00 m1-t1 Parse/);
});

test("plan-check prints what each task touches and needs, and every overlap", async () => {
  const owned = join(dir, "deliverables", "missions", "owned.md");
  await writeFile(owned, "# Mission: owned\n\nO.\n\n## Milestone 1 — m\n\n_done when: d._\n\n- [ ] **A**\n  - touches: src/a.ts, src/shared/\n  a\n\n- [ ] **B**\n  - touches: src/shared/b.ts\n  - needs: m1-t1\n  b\n", "utf8");
  const { status, stdout } = run("plan-check", owned);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /touches src\/a\.ts, src\/shared\n/);
  assert.match(stdout, /needs m1-t1\n/);
  assert.match(stdout, /overlap: milestone 1: m1-t1 and m1-t2 both touch src\/shared/);
});

test("plan-check names every problem and exits 1", async () => {
  const bad = join(dir, "deliverables", "missions", "bad.md");
  await writeFile(bad, "## Milestone 1 — x\n\n- [ ] **only a title**\n", "utf8");
  const { status, stdout } = run("plan-check", bad);
  assert.equal(status, 1, stdout);
  assert.match(stdout, /problem: milestone 1 has no "_done when/);
  assert.match(stdout, /problem: the document has no "# Mission/);
  assert.match(stdout, /^cannot fly:/m);
});

test("brief derives the worktree, branch and plan path the app would use, for either seat", () => {
  const wingman = run("brief", plan, "m1-t2", "--role", "wingman");
  assert.equal(wingman.status, 0, wingman.stderr);
  assert.ok(wingman.stdout.includes(`Your worktree is ${join(dir, ".claude", "worktrees", "orbit-m1-t2-root")}, on branch mission/orbit-m1-t2, branched from mission/orbit.`), wingman.stdout);
  assert.ok(wingman.stdout.includes(join(dir, ".claude", "worktrees", "orbit-integration-root", "deliverables", "missions", "orbit.md")), "the plan on the mission branch");
  assert.ok(wingman.stdout.includes("Write the thing."));
  const rio = run("brief", plan, "m1-t2", "--role", "rio");
  assert.equal(rio.status, 0, rio.stderr);
  assert.ok(rio.stdout.includes(`Write your findings to ${join(dir, ".claude", "worktrees", "orbit-m1-t2-root", ".scratch", "rio1", "findings.md")}`), rio.stdout);
  assert.equal(run("brief", plan, "m9-t9", "--role", "rio").status, 1);
  assert.equal(run("brief", plan, "m1-t2").status, 2, "a seat is required");
});
