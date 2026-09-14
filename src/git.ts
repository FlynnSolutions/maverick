import { execFile } from "node:child_process";
import { dirname } from "node:path";
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
  await run("git", ["-C", root, "add", "--", filePath]);
  const { stdout } = await run("git", ["-C", root, "commit", "-q", "-m", message, "--", filePath]);
  const { stdout: sha } = await run("git", ["-C", root, "rev-parse", "--short", "HEAD"]);
  return `${sha.trim()}${stdout.trim() ? ` ${stdout.trim()}` : ""}`;
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
}

export const openPullRequests = async (ghRepo: string): Promise<PullRequest[]> => {
  const { stdout } = await run("gh", [
    "pr", "list", "-R", ghRepo, "--base", "develop",
    "--json", "number,title,url,isDraft,headRefName",
  ]);
  return JSON.parse(stdout) as PullRequest[];
};
