import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const repoRootOf = async (filePath: string): Promise<string> => {
  const { stdout } = await run("git", ["-C", dirname(filePath), "rev-parse", "--show-toplevel"]);
  return stdout.trim();
};

/**
 * Stage exactly this file and commit it. Every console edit commits immediately so other
 * sessions see it on their next read (Cory, 2026-09-14). Never `git add -A`.
 */
export const commitFile = async (filePath: string, message: string): Promise<string> => {
  const root = await repoRootOf(filePath);
  // A no-op edit (an item dropped back where it was) must not try to commit nothing.
  try {
    await run("git", ["-C", root, "diff", "--quiet", "--", filePath]);
    return "no change";
  } catch {
    /* exit 1: the file differs, commit it */
  }
  await run("git", ["-C", root, "add", "--", filePath]);
  await run("git", ["-C", root, "commit", "-q", "-m", message, "--", filePath]);
  const { stdout: sha } = await run("git", ["-C", root, "rev-parse", "--short", "HEAD"]);
  return sha.trim();
};

const isGitRepo = async (dir: string): Promise<boolean> => {
  try {
    return (await stat(join(dir, ".git"))).isDirectory() || (await stat(join(dir, ".git"))).isFile();
  } catch {
    return false;
  }
};

/** The project directory itself if it is a repo, plus any immediate child repos (a multi-repo project like Realtime). */
export const reposUnder = async (projectPath: string): Promise<Array<{ label: string; path: string }>> => {
  const found: Array<{ label: string; path: string }> = [];
  if (await isGitRepo(projectPath)) found.push({ label: "root", path: projectPath });
  const entries = await readdir(projectPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "worktrees") continue;
    const child = join(projectPath, entry.name);
    if (await isGitRepo(child)) found.push({ label: entry.name, path: child });
  }
  return found;
};

export const worktrees = async (repoPath: string): Promise<Array<{ path: string; branch: string; head: string }>> => {
  const { stdout } = await run("git", ["-C", repoPath, "worktree", "list", "--porcelain"]);
  const out: Array<{ path: string; branch: string; head: string }> = [];
  let current: { path: string; branch: string; head: string } | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), branch: "", head: "" };
      out.push(current);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice(5, 12);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    }
  }
  return out;
};

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
}

/** Open PRs for the repo at `repoPath`; a repo with no GitHub remote yields none rather than an error. */
export const openPullRequests = async (repoPath: string): Promise<PullRequest[]> => {
  try {
    const { stdout } = await run(
      "gh",
      ["pr", "list", "--json", "number,title,url,isDraft,headRefName,baseRefName"],
      { cwd: repoPath },
    );
    return JSON.parse(stdout) as PullRequest[];
  } catch (err) {
    const message = (err as { stderr?: string }).stderr ?? "";
    if (/no git remotes|not a git repository|could not determine|none of the git remotes/i.test(message)) return [];
    throw err;
  }
};

export interface BackgroundAgent {
  id: string;
  sessionId: string;
  cwd: string;
  name?: string;
  state?: string;
  startedAt?: number;
}

/** Claude Code's own background sessions started under `cwd` (`claude --bg`), via its JSON listing. */
export const backgroundAgents = async (cwd: string): Promise<BackgroundAgent[]> => {
  const { stdout } = await run("claude", ["agents", "--json", "--all", "--cwd", cwd]);
  const all = JSON.parse(stdout) as Array<BackgroundAgent & { kind: string }>;
  return all.filter((a) => a.kind === "background");
};

/* ---------- branches and worktrees, for a mission's flight ---------- */

const branchExists = async (repoPath: string, branch: string): Promise<boolean> => {
  try {
    await run("git", ["-C", repoPath, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
};

/** Create `branch` at `from` unless it is already there. Never checks anything out. */
export const ensureBranch = async (repoPath: string, branch: string, from = "HEAD"): Promise<void> => {
  if (await branchExists(repoPath, branch)) return;
  await run("git", ["-C", repoPath, "branch", branch, from]);
};

/**
 * A worktree at `path` on `branch`, branched from `from` when it is new. Idempotent, so a
 * sweep that runs twice does not fail: an existing worktree at that path is accepted as is.
 */
export const ensureWorktree = async (repoPath: string, path: string, branch: string, from: string): Promise<void> => {
  if ((await worktrees(repoPath)).some((w) => w.path === path)) return;
  await ensureBranch(repoPath, branch, from);
  await run("git", ["-C", repoPath, "worktree", "add", path, branch]);
};

/** Drop a worktree and the directory with it; a worktree that is already gone is not an error. */
export const removeWorktree = async (repoPath: string, path: string): Promise<void> => {
  try {
    await run("git", ["-C", repoPath, "worktree", "remove", "--force", path]);
  } catch (err) {
    if (!/is not a working tree|No such file/i.test((err as { stderr?: string }).stderr ?? "")) throw err;
  }
};

/** Commit subjects on `branch` that `base` does not have, oldest first. Empty means the branch did nothing. */
export const commitsAhead = async (repoPath: string, base: string, branch: string): Promise<string[]> => {
  const { stdout } = await run("git", ["-C", repoPath, "log", "--reverse", "--format=%h %s", `${base}..${branch}`]);
  return stdout.split("\n").filter(Boolean);
};

/**
 * Merge `branch` into whatever is checked out at `worktreePath`. A conflict is reported, not
 * thrown: the merge is aborted and the conflicting paths come back so the mission can say
 * plainly which work collided rather than leaving a half-merged index behind.
 */
export const mergeInto = async (worktreePath: string, branch: string, message: string): Promise<{ merged: boolean; sha?: string; conflicts?: string[] }> => {
  try {
    await run("git", ["-C", worktreePath, "merge", "--no-ff", "-m", message, branch]);
  } catch {
    const { stdout } = await run("git", ["-C", worktreePath, "diff", "--name-only", "--diff-filter=U"]).catch(() => ({ stdout: "" }));
    await run("git", ["-C", worktreePath, "merge", "--abort"]).catch(() => undefined);
    return { merged: false, conflicts: stdout.split("\n").filter(Boolean) };
  }
  const { stdout: sha } = await run("git", ["-C", worktreePath, "rev-parse", "--short", "HEAD"]);
  return { merged: true, sha: sha.trim() };
};
