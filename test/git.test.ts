import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FINISHED, changedFiles, excludeLocally, listedAgents, whyFailed } from "../src/git.ts";
import { tempRepo } from "./fixtures.ts";

test("excludeLocally ignores paths in the repo without a commit, once, and a worktree shares it", async () => {
  const { dir, git } = tempRepo("mv-exclude");
  // A rule already there with no newline after it must not have the first pattern glued on.
  await writeFile(join(dir, ".git", "info", "exclude"), "# mine\nsecret.env", "utf8");
  await excludeLocally(dir, [".claude/worktrees/", ".scratch/"]);
  await excludeLocally(dir, [".scratch/", "other/"]);
  await writeFile(join(dir, "secret.env"), "x", "utf8");
  assert.ok((await readFile(join(dir, ".git", "info", "exclude"), "utf8")).includes("secret.env\n.claude/worktrees/\n"), "appended on its own line");
  const exclude = await readFile(join(dir, ".git", "info", "exclude"), "utf8");
  assert.equal(exclude.split("\n").filter((l) => l === ".scratch/").length, 1, "written once");
  assert.ok(exclude.includes("other/\n"));
  git("worktree", "add", "-q", "--detach", join(dir, ".claude", "worktrees", "w"));
  assert.equal(git("status", "--porcelain").trim(), "", "the worktree is invisible to status");
  await excludeLocally(join(dir, ".claude", "worktrees", "w"), ["probe/"]);
  assert.ok((await readFile(join(dir, ".git", "info", "exclude"), "utf8")).includes("probe/\n"), "a worktree resolves to the same exclude file");
});

test("changedFiles against the commit a task was cut from ignores what the mission branch did since", async () => {
  const { dir, git } = tempRepo("mv-changed", "mission/x");
  await writeFile(join(dir, "a.ts"), "a", "utf8"); git("add", "-A"); git("commit", "-q", "-m", "a");
  const base = git("rev-parse", "HEAD").trim();
  git("checkout", "-q", "-b", "mission/x-m1-t1");
  await writeFile(join(dir, "src.ts"), "s", "utf8"); git("add", "-A"); git("commit", "-q", "-m", "the task");
  // The ledger moves the mission branch while the task flies.
  git("checkout", "-q", "mission/x");
  await writeFile(join(dir, "plan.md"), "p", "utf8"); git("add", "-A"); git("commit", "-q", "-m", "ledger");
  assert.deepEqual(await changedFiles(dir, base, "mission/x-m1-t1"), ["src.ts"]);
  assert.deepEqual(await changedFiles(dir, "mission/x", "mission/x-m1-t1"), ["plan.md", "src.ts"], "which is why the diff is against the cut, not the tip");
});

test("a listed session with no process is said down, a finished word, whatever its last word was", () => {
  const listed = listedAgents([
    { id: "live", sessionId: "s1", cwd: "/p", kind: "background", state: "blocked", pid: 41 },
    { id: "dead", sessionId: "s2", cwd: "/p", kind: "background", state: "blocked" },
    { id: "done", sessionId: "s3", cwd: "/p", kind: "background", state: "done" },
    { id: "chat", sessionId: "s4", cwd: "/p", kind: "interactive", state: "idle" },
  ]);
  assert.deepEqual(listed.map((a) => [a.id, a.state]), [["live", "blocked"], ["dead", "down"], ["done", "done"]]);
  assert.ok(FINISHED.test("down"), "so the mission sweep, the ship sweep and the audits all read it as ended");
});

test("a failed command says why in its own words, not by repeating the command line", () => {
  const push = Object.assign(new Error("Command failed: git -C /r push --set-upstream origin feature/x\nfatal: 'origin' does not appear to be a git repository\nfatal: Could not read from remote repository."), {
    stderr: "fatal: 'origin' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n",
  });
  assert.equal(whyFailed(push), "fatal: 'origin' does not appear to be a git repository", "the first fatal line, not the advice after it");
  assert.equal(whyFailed(Object.assign(new Error("Command failed: claude --bg ..."), { stderr: "Workspace not trusted. Run `claude` in /w once and accept the trust prompt, then retry.\n" })), "Workspace not trusted. Run `claude` in /w once and accept the trust prompt, then retry.");
  assert.equal(whyFailed(new Error("spawn claude ENOENT\n  at ...")), "spawn claude ENOENT", "no stderr: the message's first line");
});

test("a session's variables go in its folder's settings, merged into what is there, since a background session gets no other way", async () => {
  const { sessionEnv } = await import("../src/git.ts");
  const dir = mkdtempSync(join(tmpdir(), "mv-sessionenv-"));
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, env: { KEEP: "1", MAVERICK_TASK: "m1-t1" } }), "utf8");
  await sessionEnv(dir, { MAVERICK_TASK: "m1-t2" });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8")), { permissions: { allow: ["Bash(npm test)"] }, env: { KEEP: "1", MAVERICK_TASK: "m1-t2" } });
  const fresh = mkdtempSync(join(tmpdir(), "mv-sessionenv-"));
  await sessionEnv(fresh, { MAVERICK_TASK: "m2-t1", MAVERICK_SHARED: "dev" });
  assert.deepEqual(JSON.parse(readFileSync(join(fresh, ".claude", "settings.local.json"), "utf8")), { env: { MAVERICK_TASK: "m2-t1", MAVERICK_SHARED: "dev" } });
});

test("no session is launched on a login that has ended, and the check is read at most every five minutes", async () => {
  const { launchRefused } = await import("../src/git.ts");
  let reads = 0;
  const now = Date.parse("2026-11-04T09:00:00Z");
  const said = (auth: object) => async () => { reads += 1; return auth; };
  assert.match((await launchRefused(now, said({ loggedIn: true, loginExpiresAt: "2026-11-04T08:50:00Z" })))!, /claude login has ended/);
  assert.equal(await launchRefused(now + 1000, said({ loggedIn: true, loginExpiresAt: "2026-12-03T00:00:00Z" })), undefined, "a refusal is not cached: logging in counts at once");
  assert.equal(await launchRefused(now + 2000, said({ loggedIn: false })), undefined, "a good answer is kept for five minutes");
  assert.equal(reads, 2);
  assert.match((await launchRefused(now + 6 * 60_000, said({ loggedIn: false })))!, /log in again/);
  assert.equal(await launchRefused(now + 13 * 60_000, async () => undefined), undefined, "a status that does not answer launches; a failed launch says why itself");
});
