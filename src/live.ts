/**
 * Live signals for one project that its trackers cannot know: Claude Code sessions running
 * under it (interactive and background), dev servers, worktrees, open PRs. gh, git and
 * claude are slow enough that results are cached per project for config.liveCacheMs.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";
import { backgroundAgents, openPullRequests, reposUnder, worktrees, type BackgroundAgent, type PullRequest } from "./git.ts";
import type { Project } from "./projects.ts";

/** One entry of Claude Code's registry (`~/.claude/sessions/<pid>.json`), written by the CLI itself. */
export interface ClaudeSession {
  pid: number;
  sessionId: string;
  name?: string;
  cwd: string;
  kind?: string;
  status?: string;
  waitingFor?: string;
  jobId?: string;
  startedAt?: number;
  updatedAt?: number;
}

export interface LiveSignals {
  fetchedAt: string;
  claudeSessions: ClaudeSession[];
  backgroundAgents: BackgroundAgent[];
  devServers: unknown[];
  repos: Array<{
    label: string;
    path: string;
    worktrees: Array<{ path: string; branch: string; head: string }>;
    pullRequests: PullRequest[];
    error?: string;
  }>;
}

const cache = new Map<string, { at: number; value: LiveSignals }>();

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
};

const readClaudeSessions = async (): Promise<ClaudeSession[]> => {
  let names: string[];
  try {
    names = await readdir(config.claudeSessionsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const records = await Promise.all(
    names
      .filter((n) => /^\d+\.json$/.test(n))
      .map(async (n) => JSON.parse(await readFile(join(config.claudeSessionsDir, n), "utf8")) as ClaudeSession),
  );
  // The registry keeps files for processes that have exited; only a live pid is a session.
  return records.filter((r) => isAlive(r.pid)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
};

const readDevServers = async (projectPath: string): Promise<unknown[]> => {
  try {
    const parsed = JSON.parse(await readFile(join(projectPath, ".dev-servers.json"), "utf8")) as { servers?: unknown[] };
    return parsed.servers ?? [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
};

const underPath = (cwd: string, projectPath: string): boolean => cwd === projectPath || cwd.startsWith(`${projectPath}/`);

export const liveSignals = async (project: Project, force = false): Promise<LiveSignals> => {
  const hit = cache.get(project.id);
  if (hit && !force && Date.now() - hit.at < config.liveCacheMs) return hit.value;

  const repos = await Promise.all(
    (await reposUnder(project.path)).map(async (repo) => {
      try {
        const [trees, prs] = await Promise.all([worktrees(repo.path), openPullRequests(repo.path)]);
        return { ...repo, worktrees: trees, pullRequests: prs };
      } catch (err) {
        return { ...repo, worktrees: [], pullRequests: [], error: (err as Error).message };
      }
    }),
  );
  const [allSessions, agents, devServers] = await Promise.all([
    readClaudeSessions(),
    backgroundAgents(project.path),
    readDevServers(project.path),
  ]);
  const value: LiveSignals = {
    fetchedAt: new Date().toISOString(),
    claudeSessions: allSessions.filter((s) => underPath(s.cwd, project.path)),
    backgroundAgents: agents,
    devServers,
    repos,
  };
  cache.set(project.id, { at: Date.now(), value });
  return value;
};
