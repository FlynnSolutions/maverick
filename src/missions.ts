/**
 * Missions, flown by a RIO.
 *
 * A mission is a bounded multi-feature effort. The RIO interviews Cory, writes a plan, and
 * flies it once he has blessed it: one Wingman per task in a worktree of its own, a separate
 * reviewer on every finished Wingman, and a merge into the mission's own branch when a
 * milestone passes. Nothing spawns before the blessing.
 *
 * Where the plan lives is the load-bearing decision (`docs/03-decisions.md` M1). The plan is
 * work, so it lives in the tracker as ordinary items carrying `mission` and `milestone`
 * fields. Membership is a field rather than a `###` group because an item's group is lost the
 * moment it moves lane, which is exactly what a task does while a mission flies; a release
 * slot is a field for the same reason. The frozen copy of the approved plan sits beside it in
 * the repo as a document, the artifact of the gate, and is never read back as state.
 *
 * What Maverick stores is only the run — which background session is on which task, what the
 * reviewer said, which gates opened — at `~/.claude/console-sessions/missions/<project>/<id>.json`,
 * the same named exception `ships/` already uses.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { backgroundAgents, commitFile, commitsAhead, ensureBranch, ensureWorktree, mergeInto, reposUnder } from "./git.ts";
import type { Verdict } from "./audits.ts";
import type { Project } from "./projects.ts";
import { createFormation, updateFormation } from "./formations.ts";
import { readRegistrySessions } from "./live.ts";
import { parentChain } from "./processes.ts";
import { listTerminals, openTerminal, type TerminalInfo } from "./terminal.ts";
import { addGroup, addItem, applyEdit, parseTracker } from "./trackers.ts";

const run = promisify(execFile);

/** How many times a task is handed back to a fresh Wingman before it becomes Cory's problem. */
export const MAX_ATTEMPTS = 2;

export type MissionStatus = "interviewing" | "planned" | "flying" | "blocked" | "review" | "closed";
export type TaskStatus = "pending" | "flying" | "built" | "reviewing" | "passed" | "handed-back";

export interface MissionTask {
  id: string;
  title: string;
  /** What the Wingman is told to build, verbatim from the plan. */
  intent: string;
  status: TaskStatus;
  attempts: number;
  /** The Wingman's `claude --bg` id, and its session uuid once the agent listing knows it. */
  claudeId?: string;
  sessionId?: string;
  worktree?: string;
  branch?: string;
  started?: string;
  ended?: string;
  /** Commit subjects the Wingman actually produced; empty means it changed nothing. */
  commits?: string[];
  /** The reviewer: a separate session, never the Wingman and never the RIO. */
  review?: { claudeId: string; file: string; started: string };
  verdict?: Verdict;
  /** Why this task stopped needing an agent, in words, when it did not simply pass. */
  note?: string;
}

export interface Milestone {
  n: number;
  title: string;
  /** One testable line: what "done" means for this milestone. */
  done: string;
  tasks: MissionTask[];
  dispatched?: string;
  merged?: string;
  mergeSha?: string;
  conflicts?: string[];
}

export interface Mission {
  id: string;
  project: string;
  name: string;
  /** The one line Cory opened the interview with. */
  brief: string;
  status: MissionStatus;
  created: string;
  approved?: string;
  finished?: string;
  /** The plan document, relative to the project. Written by the RIO, frozen at approval. */
  plan: string;
  /** The interview is a conversation, so it runs in an embedded terminal, not a background agent. */
  interview?: { terminalId: string; started: string };
  formation?: string;
  /** Every milestone merges here. Never main. */
  branch: string;
  repo: string;
  integration: string;
  /** Which of the project's trackers the plan goes into, chosen when the mission opens. */
  trackerIndex: number;
  /** The commit that wrote the plan into that tracker. */
  planCommit?: string;
  milestones: Milestone[];
  /** Anything the sweep could not do, kept so the page can say it rather than swallow it. */
  trouble?: string;
}

/* ---------- storage ---------- */

const missionsDir = (projectId: string): string => join(config.sessionsDir, "missions", projectId);
const missionPath = (projectId: string, id: string): string => join(missionsDir(projectId), `${id}.json`);

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);

export const readMission = async (projectId: string, id: string): Promise<Mission | null> => {
  try {
    return JSON.parse(await readFile(missionPath(projectId, id), "utf8")) as Mission;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

export const listMissions = async (projectId: string): Promise<Mission[]> => {
  let names: string[];
  try {
    names = await readdir(missionsDir(projectId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const all = await Promise.all(names.filter((n) => n.endsWith(".json")).map(async (n) => JSON.parse(await readFile(join(missionsDir(projectId), n), "utf8")) as Mission));
  return all.sort((a, b) => b.created.localeCompare(a.created));
};

const writeMission = async (mission: Mission): Promise<Mission> => {
  await mkdir(missionsDir(mission.project), { recursive: true });
  await writeFile(missionPath(mission.project, mission.id), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  return mission;
};

const missionOr404 = async (projectId: string, id: string): Promise<Mission> => {
  const mission = await readMission(projectId, id);
  if (!mission) throw new Error(`no mission "${id}" in ${projectId}`);
  return mission;
};

/* ---------- the plan, as the RIO must write it ---------- */

export const PLAN_FORMAT = `# Mission: <name>

<One paragraph: what this mission is for, and what it is deliberately not.>

## Milestone 1 — <short title>

_done when: <one testable line>_

- [ ] **<task title>**
  <Everything a session with no other context needs to build this: the files, the shape, what
  it must not touch, and how it proves itself. Several lines is right; one line is not.>

- [ ] **<the next task in this milestone>**
  <...>

## Milestone 2 — <short title>

_done when: <one testable line>_

- [ ] **<task title>**
  <...>`;

const MILESTONE_HEADING = /^Milestone\s+(\d+)\s*[—–:-]\s*(.+)$/;
const DONE_LINE = /^_*\s*done when:\s*(.+?)\s*_*$/i;

/** Parse the RIO's plan document. Reuses the tracker parser, because the plan is written in its shape. */
export const parsePlan = (text: string): { name: string; intro: string; milestones: Milestone[]; problems: string[] } => {
  const lines = text.split("\n");
  const name = text.match(/^#\s*Mission:\s*(.+)$/m)?.[1].trim() ?? "";
  const headingAt = lines.findIndex((l) => /^#\s/.test(l));
  const firstSection = lines.findIndex((l) => l.startsWith("## "));
  const intro = lines.slice(headingAt + 1, firstSection < 0 ? lines.length : firstSection).join("\n").trim();
  const problems: string[] = [];
  if (!name) problems.push('the document has no "# Mission: <name>" heading');

  const milestones: Milestone[] = [];
  for (const section of parseTracker(text).sections) {
    const m = section.heading.match(MILESTONE_HEADING);
    if (!m) {
      problems.push(`"## ${section.heading}" is not a milestone heading ("## Milestone 1 — title")`);
      continue;
    }
    const n = Number(m[1]);
    const done = (lines.slice(section.start + 1, section.end).map((l) => l.trim()).find((l) => DONE_LINE.test(l))?.match(DONE_LINE)?.[1] ?? "").trim().replace(/\.$/, "");
    if (!done) problems.push(`milestone ${n} has no "_done when: ..._" line`);
    const tasks = section.groups.flatMap((g) => g.items).map((item, i) => ({
      id: `m${n}-t${i + 1}`,
      title: item.title,
      intent: item.description.trim(),
      status: "pending" as TaskStatus,
      attempts: 0,
    }));
    if (!tasks.length) problems.push(`milestone ${n} has no tasks`);
    for (const t of tasks) if (!t.intent) problems.push(`"${t.title}" in milestone ${n} says only its title; a Wingman gets no other context`);
    milestones.push({ n, title: m[2].trim(), done, tasks });
  }
  if (!milestones.length) problems.push("the document has no milestones");
  return { name, intro, milestones: milestones.sort((a, b) => a.n - b.n), problems };
};

/* ---------- what it costs, before it runs ---------- */

export interface Cost {
  milestones: number;
  tasks: number;
  /** Two background sessions per task: the Wingman, then the reviewer that is not the Wingman. */
  sessions: number;
  /** Factory's published numbers for the equivalent feature, quoted as theirs, not measured here. */
  reference: string;
}

export const costOf = (milestones: Milestone[]): Cost => {
  const tasks = milestones.reduce((n, m) => n + m.tasks.length, 0);
  return {
    milestones: milestones.length,
    tasks,
    sessions: tasks * 2,
    reference: "Factory's published numbers for a mission: a median of about 2 hours against 8 minutes for a normal session, roughly 12x the tokens, and 14% still running past 24 hours.",
  };
};

/* ---------- the RIO's interview ---------- */

const rootRepo = async (project: Project): Promise<string> => {
  const repos = await reposUnder(project.path);
  const root = repos.find((r) => r.label === "root");
  if (!root) throw new Error(`${project.name} is not a git repository at its root; a mission needs one branch to merge into`);
  return root.path;
};

const interviewPrompt = (project: Project, mission: Mission, planPath: string): string => [
  `You are the RIO for a mission in the project at ${project.path}. A RIO plans the intercept and directs; it does not fly. Your entire job in this session is the interview and the plan.`,
  "",
  `Cory opened this mission with one line: "${mission.brief}"`,
  "",
  "That line is not a specification and you must not treat it as one. Interview him first, in the terminal, one or two questions at a time. Read the repo before you ask, so every question is informed rather than generic: its docs, its rulebook, the code the work would touch, and what already exists that this should build on rather than replace. Probe until you can answer, in his words:",
  "  - what is actually being asked for, as against what he first said",
  "  - what done looks like, in a form that can be tested rather than asserted",
  "  - what is deliberately out of scope",
  "  - which constraints are binding (the rulebook, the design contract, the decision log)",
  "  - what already exists that this grows out of, named by file",
  "  - where you disagree with his approach, said plainly before anything is planned",
  "",
  "This interview is where most of the value is. Do not shorten it into a formality, and do not present a plan until he has answered.",
  "",
  `When you and he have agreed, write the plan to ${planPath} in exactly this shape, then stop:`,
  "",
  PLAN_FORMAT,
  "",
  "Rules for the plan. Each task is one unit of work for one session with no other context, so its body must carry everything that session needs: the files, the shape, what it must not touch, and how it proves itself. Tasks inside one milestone run in parallel, so no task in a milestone may depend on another in the same milestone; sequence goes across milestones. Keep milestones small enough that a failure costs one milestone, not the mission.",
  "",
  "You may read anything and run anything read-only. You may not edit product code, create branches or worktrees, spawn any agent, or touch the trackers: the plan document is the only file you write. Maverick writes the plan into the tracker and dispatches the Wingmen itself, and only after Cory has approved it in the console.",
  "",
  `When the plan is written, tell Cory it is ready and that he approves it on the mission page in Maverick. Then stop.`,
].join("\n");

/** Open a mission: the record, and the RIO in an embedded terminal, because an interview is a conversation. */
export const startMission = async (project: Project, name: string, brief: string, trackerIndex = 0): Promise<{ mission: Mission; terminal: TerminalInfo }> => {
  if (!name.trim()) throw new Error("a mission needs a name");
  if (!brief.trim()) throw new Error("a mission needs the line you would have opened a session with");
  const id = slug(name);
  if (!id) throw new Error(`"${name}" does not reduce to a usable id`);
  if (await readMission(project.id, id)) throw new Error(`${project.name} already has a mission "${id}"`);
  const repo = await rootRepo(project);
  const plan = join("deliverables", "missions", `${id}.md`);
  const mission: Mission = {
    id,
    project: project.id,
    name: name.trim(),
    brief: brief.trim(),
    status: "interviewing",
    created: new Date().toISOString(),
    plan,
    branch: `mission/${id}`,
    repo,
    integration: join(project.path, ".claude", "worktrees", `${id}-integration`),
    trackerIndex,
    milestones: [],
  };
  if (!project.trackers[trackerIndex]) throw new Error(`project "${project.id}" has no tracker at index ${trackerIndex}`);
  await mkdir(join(project.path, "deliverables", "missions"), { recursive: true });
  const terminal = openTerminal(`RIO · ${mission.name}`, ["claude", interviewPrompt(project, mission, join(project.path, plan))], project.path, 120, 36);
  mission.interview = { terminalId: terminal.id, started: new Date().toISOString() };
  await writeMission(mission);
  return { mission, terminal };
};

/** Start the interview again after a server restart took the terminal with it. */
export const reopenInterview = async (project: Project, id: string): Promise<TerminalInfo> => {
  const mission = await missionOr404(project.id, id);
  if (mission.approved) throw new Error(`${mission.name} is already approved; the interview is over`);
  const terminal = openTerminal(`RIO · ${mission.name}`, ["claude", interviewPrompt(project, mission, join(project.path, mission.plan))], project.path, 120, 36);
  mission.interview = { terminalId: terminal.id, started: new Date().toISOString() };
  await writeMission(mission);
  return terminal;
};

/** Read the plan the RIO wrote, without committing to it. This is what the gate shows. */
export const previewPlan = async (project: Project, id: string): Promise<{ mission: Mission; found: boolean; text?: string; parsed?: ReturnType<typeof parsePlan>; cost?: Cost }> => {
  const mission = await missionOr404(project.id, id);
  let text: string;
  try {
    text = await readFile(join(project.path, mission.plan), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { mission, found: false };
  }
  const parsed = parsePlan(text);
  if (!parsed.problems.length && mission.status === "interviewing") {
    mission.status = "planned";
    mission.milestones = parsed.milestones;
    await writeMission(mission);
  }
  return { mission, found: true, text, parsed, cost: costOf(parsed.milestones) };
};

/* ---------- the blessing, and the tracker write ---------- */

const today = (): string => new Date().toISOString().slice(0, 10);

const headerBlock = (mission: Mission, intro: string): string => [
  `- [ ] \`[ENG]\` **Mission: ${mission.name}**`,
  `  - created: ${today()}`,
  `  - source: RIO interview, ${today()}`,
  "  - kind: mission",
  `  - mission: ${mission.id}`,
  `  - plan: ${mission.plan}`,
  ...intro.split("\n").filter(Boolean).map((l) => `  ${l.trim()}`),
  ...mission.milestones.map((m) => `  Milestone ${m.n} — ${m.title}: done when ${m.done}`),
].join("\n");

const taskBlock = (mission: Mission, m: Milestone, task: MissionTask): string => [
  `- [ ] \`[ENG]\` **${task.title}**`,
  `  - created: ${today()}`,
  `  - source: mission ${mission.id}, milestone ${m.n}`,
  `  - mission: ${mission.id}`,
  `  - milestone: ${String(m.n)}`,
  ...task.intent.split("\n").filter((l) => l.trim()).map((l) => `  ${l.trim()}`),
].join("\n");

const PRIORITY = /🔥/;

/** Write the whole plan into the tracker as items, in one commit, under its own group on the roadmap. */
const writePlanToTracker = async (project: Project, mission: Mission, intro: string, trackerIndex: number): Promise<string> => {
  const tracker = project.trackers[trackerIndex];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${trackerIndex}`);
  let text = await readFile(tracker.path, "utf8");
  const heading = parseTracker(text).sections.find((s) => PRIORITY.test(s.heading))?.heading;
  if (!heading) throw new Error(`${tracker.label} has no 🔥 Priority section to plan into`);
  const group = `Mission: ${mission.name}`;
  if (!parseTracker(text).sections.find((s) => s.heading === heading)?.groups.some((g) => g.name === group)) {
    text = addGroup(text, heading, group);
  }
  text = addItem(text, heading, group, headerBlock(mission, intro));
  for (const m of mission.milestones) for (const task of m.tasks) text = addItem(text, heading, group, taskBlock(mission, m, task));
  await writeFile(tracker.path, text, "utf8");
  return commitFile(tracker.path, `console: plan mission "${mission.name}" (${mission.milestones.length} milestones, ${mission.milestones.reduce((n, m) => n + m.tasks.length, 0)} tasks)`);
};

/**
 * Cory's one blessing. Everything that spawns, spawns after this: the plan becomes tracker
 * items, the mission gets a branch and a formation, and the first milestone goes out.
 */
export const approveMission = async (project: Project, id: string): Promise<Mission> => {
  const mission = await missionOr404(project.id, id);
  if (mission.approved) throw new Error(`${mission.name} was already approved at ${mission.approved}`);
  const text = await readFile(join(project.path, mission.plan), "utf8").catch(() => {
    throw new Error(`no plan at ${mission.plan}; the RIO has not written one yet`);
  });
  const parsed = parsePlan(text);
  if (parsed.problems.length) throw new Error(`the plan cannot be flown as written: ${parsed.problems.join("; ")}`);
  mission.milestones = parsed.milestones;
  mission.planCommit = await writePlanToTracker(project, mission, parsed.intro, mission.trackerIndex);
  await ensureBranch(mission.repo, mission.branch, "HEAD");
  await ensureWorktree(mission.repo, mission.integration, mission.branch, "HEAD");
  const formation = await createFormation(project.id, mission.name.slice(0, 40));
  mission.formation = formation.id;
  await seatTheRio(mission);
  mission.approved = new Date().toISOString();
  mission.status = "flying";
  await writeMission(mission);
  return dispatch(project, mission, mission.milestones[0]);
};

/* ---------- the flight ---------- */

const spawnBackground = async (cwd: string, name: string, prompt: string, agent?: string): Promise<string> => {
  const { stdout } = await run("claude", ["--bg", ...(agent ? ["--agent", agent] : []), "--name", name.slice(0, 60), "--permission-mode", "auto", prompt], { cwd });
  const claudeId = stdout.match(/backgrounded\s*·\s*([0-9a-f]+)/)?.[1];
  if (!claudeId) throw new Error(`could not read the background session id from:\n${stdout}`);
  return claudeId;
};

const wingmanPrompt = (project: Project, mission: Mission, m: Milestone, task: MissionTask, findings?: string): string => [
  `You are a Wingman on the mission "${mission.name}" in the project at ${project.path}. You own one task and nothing else.`,
  "",
  `Your worktree is ${task.worktree}, on branch ${task.branch}, branched from ${mission.branch}. Work there and only there. Do not touch the project's main worktree, do not switch branches, and do not merge anything.`,
  "",
  `Milestone ${m.n} — ${m.title}. That milestone is done when: ${m.done}`,
  "",
  `Your task: ${task.title}`,
  "",
  task.intent,
  "",
  findings ? `A reviewer who did not write this code rejected your predecessor's attempt. Its findings, verbatim:\n\n${findings}\n\nStart from the code that is already on your branch and fix what the findings name. Do not argue with the reviewer in the code; where you believe a finding is wrong, say so in your commit message and leave the evidence.` : "",
  findings ? "" : "",
  "Read the repo's own rules before you write anything: its rulebook, its decision log and its design contract if it has them. Match the code around you.",
  "",
  "Commit your work in your worktree, in small commits with plain lowercase subjects. Do not write to the project's trackers; Maverick owns those for this mission. Do not open a pull request. Do not spawn other agents.",
  "",
  "When you are done, stop. A reviewer that is not you will check the work, so do not grade yourself in the commit messages: say what you did and what you could not verify.",
].filter((l) => l !== "").join("\n");

const reviewPrompt = (project: Project, mission: Mission, m: Milestone, task: MissionTask, file: string): string => [
  `You are the reviewer for one task on the mission "${mission.name}" in the project at ${project.path}. You did not write this code and you will not fix it.`,
  "",
  `The work is on branch ${task.branch} in the worktree at ${task.worktree}. Read every commit on it that ${mission.branch} does not have (\`git -C ${task.worktree} log ${mission.branch}..HEAD -p\`).`,
  "",
  `The task it was given: ${task.title}`,
  "",
  task.intent,
  "",
  `The milestone it belongs to is done when: ${m.done}`,
  "",
  "Judge whether the work does what the task says, in the repo's own terms. Run the thing: its tests, its build, its checks, whatever the repo actually has. Where it has none, say so and verify by reading and by running the code by hand. Check it against the repo's binding rules, not only against the task.",
  "",
  `Write your findings to ${file}. The FIRST line must be exactly one of: "verdict: pass", "verdict: fail", "verdict: mixed". Then a markdown list of findings, each with a severity (blocker / major / minor / note), the evidence (file, line, command output), and whether it contradicts what the session claimed about itself. Say plainly what you could not verify.`,
  "",
  "Do not fix anything. Do not commit. Do not touch the trackers. Do not spawn other agents.",
].join("\n");

const reviewFile = (mission: Mission, task: MissionTask, attempt: number): string =>
  join(missionsDir(mission.project), `${mission.id}-${task.id}-review${attempt}.md`);

/** Send every task in a milestone out at once: parallelism is narrow, inside a milestone only. */
const dispatch = async (project: Project, mission: Mission, m: Milestone): Promise<Mission> => {
  for (const task of m.tasks) {
    if (task.status !== "pending") continue;
    try {
      task.worktree = join(project.path, ".claude", "worktrees", `${mission.id}-${task.id}`);
      task.branch = `${mission.branch}/${task.id}`;
      await ensureWorktree(mission.repo, task.worktree, task.branch, mission.branch);
      task.claudeId = await spawnBackground(task.worktree, `${mission.name} · ${task.title}`, wingmanPrompt(project, mission, m, task));
      task.status = "flying";
      task.started = new Date().toISOString();
      task.attempts = 1;
    } catch (err) {
      task.status = "handed-back";
      task.note = `could not launch: ${(err as Error).message}`;
    }
  }
  m.dispatched = new Date().toISOString();
  return writeMission(mission);
};

/** Put a task back out with the reviewer's findings, in the worktree it already has. */
const handBack = async (project: Project, mission: Mission, m: Milestone, task: MissionTask, findings: string): Promise<void> => {
  task.claudeId = await spawnBackground(task.worktree!, `${mission.name} · ${task.title} (retry ${task.attempts + 1})`, wingmanPrompt(project, mission, m, task, findings));
  task.sessionId = undefined;
  task.status = "flying";
  task.attempts += 1;
  task.started = new Date().toISOString();
  task.ended = undefined;
  task.verdict = undefined;
  task.review = undefined;
};

const FINISHED = /^(done|exited|stopped)$/;
/** An agent absent from the listing is only believed gone once it has had time to appear in it. */
const SETTLE_MS = 90_000;
const isOver = (state: Map<string, string>, claudeId: string, since?: string): boolean => {
  const seen = state.get(claudeId);
  if (seen !== undefined) return FINISHED.test(seen);
  return Date.now() - new Date(since ?? 0).getTime() > SETTLE_MS;
};

/**
 * One pass over every flying mission. Called on the server's timer, so it must be safe to run
 * often and must never throw: what it cannot do it records on the mission as trouble.
 */
export const sweepMissions = async (project: Project): Promise<void> => {
  const missions = (await listMissions(project.id)).filter((m) => m.status === "flying");
  if (!missions.length) return;
  const agents = await backgroundAgents(project.path);
  const state = new Map(agents.map((a) => [a.id, a.state ?? ""]));
  const uuid = new Map(agents.map((a) => [a.id, a.sessionId]));
  for (const mission of missions) {
    let changed = false;
    const waiting: string[] = [];
    mission.trouble = undefined;
    for (const m of mission.milestones) {
      if (!m.dispatched || m.merged) continue;
      for (const task of m.tasks) {
        // A session id only exists once the agent listing knows about it; the formation wants that one.
        if (task.claudeId && !task.sessionId && uuid.has(task.claudeId)) {
          task.sessionId = uuid.get(task.claudeId);
          changed = true;
          if (mission.formation) await updateFormation(mission.formation, { members: memberIds(mission) }).catch(() => undefined);
        }
        if (task.status === "flying" && task.claudeId && state.get(task.claudeId) === "blocked") {
          waiting.push(`${task.title} is waiting on you in its own session`);
        }
        if (task.status === "flying" && task.claudeId && isOver(state, task.claudeId, task.started)) {
          task.status = "built";
          task.ended = new Date().toISOString();
          task.commits = await commitsAhead(mission.repo, mission.branch, task.branch!).catch(() => []);
          changed = true;
        }
        if (task.status === "built") {
          const file = reviewFile(mission, task, task.attempts);
          try {
            const claudeId = await spawnBackground(project.path, `review · ${task.title}`, reviewPrompt(project, mission, m, task, file), "auditor");
            task.review = { claudeId, file, started: new Date().toISOString() };
            task.status = "reviewing";
          } catch (err) {
            task.status = "handed-back";
            task.note = `could not start the reviewer: ${(err as Error).message}`;
          }
          changed = true;
        }
        if (task.status === "reviewing" && task.review) {
          const findings = await readFile(task.review.file, "utf8").catch(() => null);
          const verdict = findings?.match(/^verdict:\s*(pass|fail|mixed)/i)?.[1].toLowerCase() as Verdict | undefined;
          if (!verdict) {
            // The reviewer is gone and wrote nothing: that is a failed review, not a pass.
            if (isOver(state, task.review.claudeId, task.review.started)) {
              task.status = "handed-back";
              task.note = "the reviewer finished without writing a verdict";
              changed = true;
            }
            continue;
          }
          task.verdict = verdict;
          if (verdict === "pass") {
            task.status = "passed";
          } else if (task.attempts < MAX_ATTEMPTS) {
            try {
              await handBack(project, mission, m, task, findings!);
            } catch (err) {
              task.status = "handed-back";
              task.note = `could not hand the task back: ${(err as Error).message}`;
            }
          } else {
            task.status = "handed-back";
            task.note = `the reviewer said ${verdict} after ${task.attempts} attempts; this one is yours`;
          }
          changed = true;
        }
      }
      if (m.tasks.every((t) => t.status === "passed")) {
        changed = true;
        for (const task of m.tasks) {
          if (!task.commits?.length) continue;
          const result = await mergeInto(mission.integration, task.branch!, `mission ${mission.id}: ${task.title}`);
          if (!result.merged) {
            m.conflicts = result.conflicts;
            mission.status = "blocked";
            mission.trouble = `milestone ${m.n} will not merge: ${(result.conflicts ?? []).join(", ") || "unknown conflict"}`;
            await writeMission(mission);
            return;
          }
          m.mergeSha = result.sha;
        }
        m.merged = new Date().toISOString();
        const next = mission.milestones.find((x) => x.n > m.n && !x.dispatched);
        if (next) await dispatch(project, mission, next);
        else if (mission.milestones.every((x) => x.merged)) {
          mission.status = "review";
          mission.finished = new Date().toISOString();
        }
      }
      // A milestone with any task that needs Cory stops the mission rather than flying past it.
      if (m.tasks.some((t) => t.status === "handed-back")) {
        mission.status = "blocked";
        mission.trouble = m.tasks.filter((t) => t.status === "handed-back").map((t) => `${t.title}: ${t.note ?? `reviewer said ${t.verdict}`}`).join(" · ");
        changed = true;
      }
    }
    if (waiting.length && mission.status === "flying") mission.trouble = waiting.join(" · ");
    if (changed || waiting.length) await writeMission(mission);
  }
};

const memberIds = (mission: Mission): string[] =>
  mission.milestones.flatMap((m) => m.tasks.map((t) => t.sessionId).filter((s): s is string => Boolean(s)));

/**
 * The RIO is the formation's lead, and a formation holds session uuids. The RIO runs in one of
 * our ptys, so its uuid is the registry session whose process descends from that pty, which is
 * how the workspace already matches a session to its dock terminal.
 */
const seatTheRio = async (mission: Mission): Promise<void> => {
  if (!mission.formation || !mission.interview) return;
  const pty = listTerminals().find((t) => t.id === mission.interview!.terminalId);
  if (!pty?.pid || pty.exitCode !== null) return;
  for (const session of await readRegistrySessions()) {
    if ((await parentChain(session.pid)).includes(pty.pid)) {
      await updateFormation(mission.formation, { lead: session.sessionId }).catch(() => undefined);
      return;
    }
  }
};

/* ---------- Cory's second and last gate ---------- */

/** Put a blocked task back in the air after Cory has had a look, with one more attempt. */
export const retryTask = async (project: Project, id: string, taskId: string): Promise<Mission> => {
  const mission = await missionOr404(project.id, id);
  const m = mission.milestones.find((x) => x.tasks.some((t) => t.id === taskId));
  const task = m?.tasks.find((t) => t.id === taskId);
  if (!m || !task) throw new Error(`no task "${taskId}" on ${mission.name}`);
  if (!task.worktree) throw new Error(`${task.title} never got a worktree; it cannot be retried`);
  const findings = task.review ? await readFile(task.review.file, "utf8").catch(() => "") : "";
  task.attempts = Math.max(0, MAX_ATTEMPTS - 1);
  await handBack(project, mission, m, task, findings);
  task.note = undefined;
  mission.status = "flying";
  mission.trouble = undefined;
  return writeMission(mission);
};

/** Accept a task Cory has looked at himself, so a milestone the reviewer failed can still merge. */
export const acceptTask = async (project: Project, id: string, taskId: string, note: string): Promise<Mission> => {
  const mission = await missionOr404(project.id, id);
  const task = mission.milestones.flatMap((m) => m.tasks).find((t) => t.id === taskId);
  if (!task) throw new Error(`no task "${taskId}" on ${mission.name}`);
  task.status = "passed";
  task.note = `accepted by Cory over the reviewer: ${note}`.trim();
  mission.status = "flying";
  mission.trouble = undefined;
  return writeMission(mission);
};

/**
 * Close the mission: tick every passed task's item in the tracker, in one commit, and hand the
 * branch to the ship wizard. Maverick does not merge a mission into main; that is the ship's job.
 */
export const closeMission = async (project: Project, id: string): Promise<{ mission: Mission; commit: string; ticked: string[] }> => {
  const mission = await missionOr404(project.id, id);
  const tracker = project.trackers[mission.trackerIndex];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${mission.trackerIndex}`);
  const passed = new Set(mission.milestones.flatMap((m) => m.tasks).filter((t) => t.status === "passed").map((t) => t.title));
  const ticked: string[] = [];
  // Re-find every item by its fields rather than by a stored line: other sessions move them.
  for (;;) {
    const text = await readFile(tracker.path, "utf8");
    const item = parseTracker(text).sections
      .flatMap((s) => s.groups.flatMap((g) => g.items))
      .find((i) => i.fields.mission === mission.id && !i.checked && passed.has(i.title));
    if (!item) break;
    await writeFile(tracker.path, applyEdit(text, item.start, item.firstLine, [item.firstLine.replace(/^- \[ \]/, "- [x]"), ...item.body.split("\n").slice(1)].join("\n")), "utf8");
    ticked.push(item.title);
  }
  const commit = ticked.length ? await commitFile(tracker.path, `console: mission "${mission.name}" done (${ticked.length} items)`) : "no change";
  mission.status = "closed";
  mission.finished = mission.finished ?? new Date().toISOString();
  await writeMission(mission);
  return { mission, commit, ticked };
};

/** What the review gate reads: every task with its commits, its verdict and its findings. */
export const missionView = async (project: Project, id: string): Promise<Mission & { cost: Cost; findings: Record<string, string>; diffstat: Record<string, string> }> => {
  const mission = await missionOr404(project.id, id);
  const findings: Record<string, string> = {};
  const diffstat: Record<string, string> = {};
  for (const task of mission.milestones.flatMap((m) => m.tasks)) {
    if (task.review) {
      const text = await readFile(task.review.file, "utf8").catch(() => null);
      if (text) findings[task.id] = text;
    }
    if (task.branch) {
      const { stdout } = await run("git", ["-C", mission.repo, "diff", "--stat", `${mission.branch}...${task.branch}`]).catch(() => ({ stdout: "" }));
      if (stdout.trim()) diffstat[task.id] = stdout.trim();
    }
  }
  return { ...mission, cost: costOf(mission.milestones), findings, diffstat };
};
