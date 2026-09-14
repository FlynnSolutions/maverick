/**
 * Live signals the trackers cannot know: running dev servers, worktrees, open PRs.
 * gh and git are slow enough that results are cached for config.liveCacheMs.
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config.ts";
import { openPullRequests, worktrees, type PullRequest } from "./git.ts";

/**
 * Claude Code's own registry of running sessions (`~/.claude/sessions/<pid>.json`, one per
 * process, written by the CLI itself). Read-only here; it is the harness's file, not ours.
 */
export interface ClaudeSession {
  pid: number;
  sessionId: string;
  name?: string;
  cwd: string;
  status?: string;
  waitingFor?: string;
  startedAt?: number;
  updatedAt?: number;
}

const claudeSessionsDir = join(homedir(), ".claude", "sessions");

const readClaudeSessions = async (): Promise<ClaudeSession[]> => {
  let names: string[];
  try {
    names = await readdir(claudeSessionsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const records = await Promise.all(
    names
      .filter((n) => /^\d+\.json$/.test(n))
      .map(async (n) => JSON.parse(await readFile(join(claudeSessionsDir, n), "utf8")) as ClaudeSession),
  );
  return records.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
};

export interface LiveSignals {
  fetchedAt: string;
  claudeSessions: ClaudeSession[];
  devServers: unknown[];
  repos: Array<{
    label: string;
    worktrees: Array<{ path: string; branch: string; head: string }>;
    pullRequests: PullRequest[];
    error?: string;
  }>;
}

let cached: { at: number; value: LiveSignals } | null = null;

const readDevServers = async (): Promise<unknown[]> => {
  try {
    const parsed = JSON.parse(await readFile(config.devServersRegistry, "utf8")) as { servers?: unknown[] };
    return parsed.servers ?? [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
};

export const liveSignals = async (): Promise<LiveSignals> => {
  if (cached && Date.now() - cached.at < config.liveCacheMs) return cached.value;
  const repos = await Promise.all(
    config.repos.map(async (repo) => {
      try {
        const [trees, prs] = await Promise.all([worktrees(repo.path), openPullRequests(repo.gh)]);
        return { label: repo.label, worktrees: trees, pullRequests: prs };
      } catch (err) {
        return { label: repo.label, worktrees: [], pullRequests: [], error: (err as Error).message };
      }
    }),
  );
  const [claudeSessions, devServers] = await Promise.all([readClaudeSessions(), readDevServers()]);
  const value: LiveSignals = { fetchedAt: new Date().toISOString(), claudeSessions, devServers, repos };
  cached = { at: Date.now(), value };
  return value;
};
