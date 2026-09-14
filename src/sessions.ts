/**
 * Session records: one JSON file per Claude session under ~/.claude/console-sessions, written by
 * bin/session-open and bin/session-close. The console draws the tree from `parent`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type SessionRole = "driver" | "develop" | "audit" | "plan";
export type SessionStatus = "open" | "closed" | "handed-off";

export interface SessionRecord {
  id: string;
  role: SessionRole;
  loop: string;
  exit?: string;
  parent?: string;
  status: SessionStatus;
  handoff?: string;
  started: string;
  ended?: string;
  /** Project id or name as given to session-open; matched against both. */
  project?: string;
  worktree?: string;
  pr?: string;
  /** The `claude --bg` id when the console spawned this session; links the record to the live agent. */
  claudeId?: string;
}

export const readSessions = async (dir: string): Promise<SessionRecord[]> => {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const records = await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map(async (n) => JSON.parse(await readFile(join(dir, n), "utf8")) as SessionRecord),
  );
  return records.sort((a, b) => b.started.localeCompare(a.started));
};

export const sessionsForProject = async (dir: string, projectId: string, projectName: string): Promise<SessionRecord[]> =>
  (await readSessions(dir)).filter((r) => r.project === projectId || r.project === projectName);
