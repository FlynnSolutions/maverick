/**
 * Session records: one JSON file per Claude session under ~/.claude/console-sessions, written by
 * bin/session-open and bin/session-close. The console draws the tree from `parent`.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
  /** Set by the console when this task session has been (or is being) audited. */
  audit?: { claudeId: string; started: string; file: string };
  /** Cory's call on the audit findings. */
  decision?: "accepted" | "rejected";
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

export const writeSession = async (dir: string, record: SessionRecord): Promise<SessionRecord> => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
};

/** Patch one record in place, creating nothing: a session the console never recorded is not an error. */
export const patchSession = async (dir: string, id: string, patch: Partial<SessionRecord>): Promise<void> => {
  const file = join(dir, `${id}.json`);
  try {
    const record = JSON.parse(await readFile(file, "utf8")) as SessionRecord;
    await writeFile(file, `${JSON.stringify({ ...record, ...patch }, null, 2)}\n`, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
};

export const sessionsForProject = async (dir: string, projectId: string, projectName: string): Promise<SessionRecord[]> =>
  (await readSessions(dir)).filter((r) => r.project === projectId || r.project === projectName);
