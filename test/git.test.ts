import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { excludeLocally } from "../src/git.ts";

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
