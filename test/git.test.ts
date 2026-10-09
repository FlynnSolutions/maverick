import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changedFiles, excludeLocally } from "../src/git.ts";

test("excludeLocally ignores paths in the repo without a commit, once, and a worktree shares it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mv-exclude-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "base");
  // A rule already there with no newline after it must not have the first pattern glued on.
  await writeFile(join(dir, ".git", "info", "exclude"), "# mine\nsecret.env", "utf8");
  await excludeLocally(dir, [".claude/worktrees/", ".scratch/"]);
  await excludeLocally(dir, [".scratch/", "other/"]);
  await writeFile(join(dir, "secret.env"), "x", "utf8");
  assert.ok((await readFile(join(dir, ".git", "info", "exclude"), "utf8")).includes("secret.env\n.claude/worktrees/\n"), "appended on its own line");
  const exclude = await readFile(join(dir, ".git", "info", "exclude"), "utf8");
  assert.equal(exclude.split("\n").filter((l) => l === ".scratch/").length, 1, "written once");
  assert.ok(exclude.includes(".claude/worktrees/\n") && exclude.includes("other/\n"));
  git("worktree", "add", "-q", "--detach", join(dir, ".claude", "worktrees", "w"));
  assert.equal(git("status", "--porcelain").trim(), "", "the worktree is invisible to status");
  await excludeLocally(join(dir, ".claude", "worktrees", "w"), ["probe/"]);
  assert.ok((await readFile(join(dir, ".git", "info", "exclude"), "utf8")).includes("probe/\n"), "a worktree resolves to the same exclude file");
});

test("changedFiles against the commit a task was cut from ignores what the mission branch did since", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mv-changed-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "mission/x");
  git("config", "user.name", "t"); git("config", "user.email", "t@example.com");
  await writeFile(join(dir, "a.ts"), "a", "utf8"); git("add", "-A"); git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  git("checkout", "-q", "-b", "mission/x-m1-t1");
  await writeFile(join(dir, "src.ts"), "s", "utf8"); git("add", "-A"); git("commit", "-q", "-m", "the task");
  // The ledger moves the mission branch while the task flies.
  git("checkout", "-q", "mission/x");
  await writeFile(join(dir, "plan.md"), "p", "utf8"); git("add", "-A"); git("commit", "-q", "-m", "ledger");
  assert.deepEqual(await changedFiles(dir, base, "mission/x-m1-t1"), ["src.ts"]);
  assert.deepEqual(await changedFiles(dir, "mission/x", "mission/x-m1-t1"), ["plan.md", "src.ts"], "which is why the diff is against the cut, not the tip");
});
