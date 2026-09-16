/**
 * Audit parents. A parent is a session record with role "audit" that owns a group of task
 * sessions (their records point at it via `parent`). When a supervised task session
 * finishes, the console runs the project's `auditor` agent against it in a background
 * session; the auditor writes a findings file whose first line is its verdict. Cory then
 * accepts or rejects the findings from the console. The auditor never fixes anything.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { backgroundAgents } from "./git.ts";
import type { Project } from "./projects.ts";
import { readSessions, type SessionRecord } from "./sessions.ts";

const run = promisify(execFile);

export interface AuditInfo {
  /** The background session running the audit. */
  claudeId: string;
  started: string;
  /** Where the auditor writes its findings. */
  file: string;
}

export type Verdict = "pass" | "fail" | "mixed" | "pending" | "none";

export interface AuditView {
  verdict: Verdict;
  decision?: "accepted" | "rejected";
  findings?: string;
  agentState?: string;
}

const auditsDir = (): string => join(config.sessionsDir, "audits");
const recordPath = (id: string): string => join(config.sessionsDir, `${id}.json`);

const readRecord = async (id: string): Promise<SessionRecord & { audit?: AuditInfo; decision?: string }> =>
  JSON.parse(await readFile(recordPath(id), "utf8"));

const writeRecord = async (record: SessionRecord): Promise<void> => {
  await mkdir(config.sessionsDir, { recursive: true });
  await writeFile(recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
};

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);

export const createParent = async (project: Project, name: string): Promise<SessionRecord> => {
  const record: SessionRecord = {
    id: `audit-${slug(name)}-${Date.now().toString(36)}`,
    role: "audit",
    loop: name,
    status: "open",
    started: new Date().toISOString(),
    project: project.id,
  };
  await writeRecord(record);
  return record;
};

export const assignParent = async (childId: string, parentId: string | null): Promise<SessionRecord> => {
  const child = await readRecord(childId);
  if (parentId) {
    const parent = await readRecord(parentId);
    if (parent.role !== "audit") throw new Error(`${parentId} is not an audit parent`);
    child.parent = parentId;
  } else {
    delete child.parent;
  }
  await writeRecord(child);
  return child;
};

const transcriptPath = (cwd: string, sessionId: string): string =>
  join(process.env.HOME ?? "", ".claude", "projects", cwd.replace(/\//g, "-"), `${sessionId}.jsonl`);

/** Start the auditor on one task session. Returns the audit's background id. */
export const runAudit = async (project: Project, childId: string): Promise<AuditInfo> => {
  const child = await readRecord(childId);
  if (child.audit) throw new Error(`${childId} already has an audit running or done (${child.audit.claudeId})`);
  const agents = await backgroundAgents(project.path);
  const agent = child.claudeId ? agents.find((a) => a.id === child.claudeId) : undefined;
  await mkdir(auditsDir(), { recursive: true });
  const file = join(auditsDir(), `${childId}.md`);
  const prompt = [
    `You are the auditor for a task session you did not run, in the project at ${project.path}.`,
    `The session's loop was: ${child.loop}`,
    `It started at ${child.started}.`,
    agent ? `Its transcript, which is its own self-report and therefore a set of claims, not findings: ${transcriptPath(agent.cwd, agent.sessionId)}` : "No transcript is available; work from the commits alone.",
    `Find what it actually changed: in every git repo and worktree under the project (\`git worktree list\` in each), look at commits since ${child.started}, read the diffs, and run the thing where a test or build exists.`,
    `Write your findings to ${file}. The FIRST line must be exactly one of: "verdict: pass", "verdict: fail", "verdict: mixed". Then a markdown list of findings, each with a severity (blocker / major / minor / note), the evidence (file, line, command output), and whether it contradicts the session's self-report. Say plainly what you could not verify.`,
    `Do not fix anything. Do not commit. Do not touch the trackers.`,
  ].join("\n");
  const { stdout } = await run(
    "claude",
    ["--bg", "--agent", "auditor", "--name", `audit: ${child.loop.slice(0, 50)}`, "--permission-mode", "auto", prompt],
    { cwd: project.path },
  );
  const claudeId = stdout.match(/backgrounded\s*·\s*([0-9a-f]+)/)?.[1];
  if (!claudeId) throw new Error(`could not read the audit session id from:\n${stdout}`);
  const audit: AuditInfo = { claudeId, started: new Date().toISOString(), file };
  await writeRecord({ ...child, audit } as SessionRecord);
  return audit;
};

/** The auditor's contract: the first line of a findings file is its verdict. */
export const verdictOf = (findings: string | undefined): Verdict =>
  (findings?.match(/^verdict:\s*(pass|fail|mixed)/i)?.[1].toLowerCase() as Verdict | undefined) ?? "pending";

export const auditView = async (record: SessionRecord & { audit?: AuditInfo; decision?: string }, agentStates: Map<string, string>): Promise<AuditView> => {
  if (!record.audit) return { verdict: "none" };
  let findings: string | undefined;
  try {
    findings = await readFile(record.audit.file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return { verdict: verdictOf(findings), findings, decision: record.decision as AuditView["decision"], agentState: agentStates.get(record.audit.claudeId) };
};

export const recordDecision = async (childId: string, decision: "accepted" | "rejected"): Promise<void> => {
  const child = await readRecord(childId);
  await writeRecord({ ...child, decision } as SessionRecord);
};

/**
 * Supervised task sessions whose background agent has finished get audited without anyone
 * asking. Called on a timer by the server; safe to call often.
 */
export const sweep = async (project: Project): Promise<string[]> => {
  const records = await readSessions(config.sessionsDir);
  const parents = new Set(records.filter((r) => r.role === "audit" && (r.project === project.id || r.project === project.name)).map((r) => r.id));
  if (!parents.size) return [];
  const agents = await backgroundAgents(project.path);
  const started: string[] = [];
  for (const r of records as Array<SessionRecord & { audit?: AuditInfo }>) {
    if (!r.parent || !parents.has(r.parent) || r.audit || !r.claudeId) continue;
    const agent = agents.find((a) => a.id === r.claudeId);
    if (!agent || !/^(done|exited|stopped|blocked)$/.test(agent.state ?? "")) continue;
    try {
      await runAudit(project, r.id);
      started.push(r.id);
    } catch (err) {
      console.error(`auto-audit of ${r.id} failed:`, (err as Error).message);
    }
  }
  return started;
};
