/**
 * Missions, led by a Strike Lead.
 *
 * A mission is a bounded multi-feature effort, the way a strike is one package off the deck.
 * The Strike Lead interviews Cory, writes a plan, and
 * flies it once he has blessed it: one Wingman per task in a worktree of its own, a separate
 * RIO on every finished Wingman, and a merge into the mission's own branch when a
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
 * RIO said, which gates opened — at `~/.claude/console-sessions/missions/<project>/<id>.json`,
 * the same named exception `ships/` already uses.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";
import { missionConfigFor, type Landing, type MissionConfig } from "./project-config.ts";
import { backgroundAgents, commitFile, commitsAhead, currentBranch, diffStat, ensureBranch, ensureWorktree, mergeInto, openPullRequest, pushBranch, pushFastForward, removeWorktree, reposUnder, revParse, spawnBackgroundAgent } from "./git.ts";
import { slug, verdictOf, type Verdict } from "./audits.ts";
import type { Project } from "./projects.ts";
import { createFormation, listFormations, updateFormation } from "./formations.ts";
import { patchSession, writeSession, type SessionRecord } from "./sessions.ts";
import { readRegistrySessions } from "./live.ts";
import { parentChain } from "./processes.ts";
import { listTerminals, openTerminal, type TerminalInfo } from "./terminal.ts";
import { addGroup, addItem, parseTracker, setChecked } from "./trackers.ts";

/** How many times a task is handed back to a fresh Wingman before it becomes Cory's problem. */
export const MAX_ATTEMPTS = 2;

export type MissionStatus = "interviewing" | "planned" | "flying" | "blocked" | "review" | "closed" | "abandoned";
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
  /** Which of the project's repos this task works in, by the label `reposUnder` gives it. */
  repo: string;
  worktree?: string;
  branch?: string;
  /** Where the branch was cut. Once a task is merged, the mission branch is no longer a base to diff against. */
  base?: string;
  started?: string;
  ended?: string;
  /** Commit subjects the Wingman actually produced; empty means it changed nothing. */
  commits?: string[];
  /** The RIO in this Wingman's back seat: a separate session, never the Wingman, never the lead. */
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
  /** The merge commit per repo, since a milestone can land work in more than one. */
  mergeShas?: Record<string, string>;
  conflicts?: string[];
}

/** One repo a mission touches. A single-repo project has exactly one of these, labelled "root". */
export interface MissionRepo {
  label: string;
  path: string;
  /** The branch this repo's work is cut from and lands against. */
  base: string;
  /** The mission's own branch here. Milestones merge into it; it is never the base. */
  branch: string;
  /** A worktree on `branch`, where this repo's milestones are merged together. */
  integration: string;
  /** What lands this repo. Usually the mission's, but a repo may override it (see `Landing`). */
  land: Landing;
  /** Set when the mission has landed this repo: a merge sha, or the pull request url. */
  landed?: string;
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
  /** The plan document, relative to the project. Written by the Strike Lead, frozen at approval. */
  plan: string;
  /** The interview is a conversation, so it runs in an embedded terminal, not a background agent. */
  interview?: { terminalId: string; started: string };
  formation?: string;
  /** Every repo the plan touches. Work never leaves these branches without a person. */
  repos: MissionRepo[];
  /** What "done" does with the work: merge onto the mission branches, or open a pull request per repo. */
  land: Landing;
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

/* ---------- the plan, as the Strike Lead must write it ---------- */

const PLAN_FORMAT = `# Mission: <name>

<One paragraph: what this mission is for, and what it is deliberately not.>

## Milestone 1 — <short title>

_done when: <one testable line>_

- [ ] **<task title>**
  - repo: <which repo this works in; omit it only when the project has one>
  <Everything a session with no other context needs to build this: the files, the shape, what
  it must not touch, and how it proves itself. Several lines is right; one line is not.>

- [ ] **<the next task in this milestone>**
  - repo: <...>
  <...>

## Milestone 2 — <short title>

_done when: <one testable line>_

- [ ] **<task title>**
  <...>`;

const MILESTONE_HEADING = /^Milestone\s+(\d+)\s*[—–:-]\s*(.+)$/;
const DONE_LINE = /^_*\s*done when:\s*(.+?)\s*_*$/i;

/** Parse the Strike Lead's plan document. Reuses the tracker parser, because the plan is written in its shape. */
export const parsePlan = (text: string, repos: string[] = []): { name: string; intro: string; milestones: Milestone[]; problems: string[] } => {
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
    const only = repos.length === 1 ? repos[0] : "";
    const tasks = section.groups.flatMap((g) => g.items).map((item, i) => ({
      id: `m${n}-t${i + 1}`,
      title: item.title,
      intent: item.description.trim(),
      repo: item.fields.repo?.trim() || only,
      status: "pending" as TaskStatus,
      attempts: 0,
    }));
    if (!tasks.length) problems.push(`milestone ${n} has no tasks`);
    for (const t of tasks) if (!t.intent) problems.push(`"${t.title}" in milestone ${n} says only its title; a Wingman gets no other context`);
    // Which repo a task works in is only guessable when the project has exactly one.
    for (const t of tasks) {
      if (!t.repo) problems.push(`"${t.title}" in milestone ${n} names no repo; this project has ${repos.length}, so every task needs "- repo: <name>"`);
      else if (repos.length && !repos.includes(t.repo)) problems.push(`"${t.title}" in milestone ${n} names repo "${t.repo}", which is not one of: ${repos.join(", ")}`);
    }
    milestones.push({ n, title: m[2].trim(), done, tasks });
  }
  if (!milestones.length) problems.push("the document has no milestones");
  return { name, intro, milestones: milestones.sort((a, b) => a.n - b.n), problems };
};

/* ---------- what it costs, before it runs ---------- */

export interface Cost {
  milestones: number;
  tasks: number;
  /** How many of the project's repos the plan touches. */
  repos: number;
  /** Two background sessions per task: the Wingman, then the RIO in its back seat. */
  sessions: number;
  /** Factory's published numbers for the equivalent feature, quoted as theirs, not measured here. */
  reference: string;
}

export const costOf = (milestones: Milestone[]): Cost => {
  const tasks = milestones.reduce((n, m) => n + m.tasks.length, 0);
  return {
    milestones: milestones.length,
    tasks,
    repos: new Set(milestones.flatMap((m) => m.tasks.map((t) => t.repo)).filter(Boolean)).size,
    sessions: tasks * 2,
    reference: "Factory's published numbers for a mission: a median of about 2 hours against 8 minutes for a normal session, roughly 12x the tokens, and 14% still running past 24 hours.",
  };
};

/* ---------- the Strike Lead's interview ---------- */

/** Every repo a mission could touch, with the base branch each one lands against. */
export const repoChoices = async (project: Project, cfg: MissionConfig): Promise<Array<{ label: string; path: string; base: string; land: Landing }>> => {
  const found = await reposUnder(project.path);
  if (!found.length) throw new Error(`${project.name} holds no git repository; a mission needs at least one`);
  return Promise.all(found.map(async (r) => ({
    ...r,
    // What the project says, else whatever that repo is actually on: a multi-repo project
    // rarely shares one base (a contract package on main, the services on develop).
    base: cfg.repos[r.label]?.base ?? (await currentBranch(r.path)),
    land: cfg.repos[r.label]?.land ?? cfg.land,
  })));
};

const missionRepo = (mission: Mission, task: MissionTask): MissionRepo => {
  const repo = mission.repos.find((r) => r.label === task.repo);
  if (!repo) throw new Error(`task ${task.id} names repo "${task.repo}", which this mission does not hold`);
  return repo;
};

const interviewPrompt = (project: Project, mission: Mission, planPath: string, repos: Array<{ label: string; base: string; land: Landing }>, land: Landing): string => [
  `You are the Strike Lead for a mission in the project at ${project.path}. A strike lead plans the package, briefs it and sends it; it does not fly every jet in it. Your entire job in this session is the interview and the plan.`,
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
  repos.length > 1
    ? [
        `This project holds ${repos.length} git repositories, so every task must carry a \`  - repo: <name>\` line naming the one it works in. They are:`,
        ...repos.map((r) => `  - ${r.label} (lands against ${r.base})`),
        "",
        "A task works in exactly one repo. Where a change spans repos, that is more than one task, and if one has to land before another can start, they belong in different milestones, because tasks inside one milestone run at the same time.",
      ].join("\n")
    : `This project is one git repository, so a task's \`repo\` line is optional; everything lands against ${repos[0]?.base ?? "its current branch"}.`,
  "",
  [
    "What happens to the work when a repo is done, which the project decides per repo:",
    ...repos.map((r) => `  - ${r.label}: ${r.land === "pr" ? `a pull request against ${r.base}, merged by nobody but Cory` : r.land === "push" ? `${r.base} is advanced to it and pushed, because this repo's own process says its work lands there directly` : `left on the mission branch for Cory to take from there`}`),
    "Plan for that. Work that ends in a pull request has to stand up as a reviewable one, not just as a green branch.",
  ].join("\n"),
  "",
  "You may read anything and run anything read-only. You may not edit product code, create branches or worktrees, spawn any agent, or touch the trackers: the plan document is the only file you write. Maverick writes the plan into the tracker and dispatches the Wingmen itself, and only after Cory has approved it in the console.",
  "",
  `When the plan is written, tell Cory it is ready and that he approves it on the mission page in Maverick. Then stop.`,
].join("\n");

/** Open a mission: the record, and the Strike Lead in an embedded terminal, because an interview is a conversation. */
export const startMission = async (project: Project, name: string, brief: string, trackerIndex = 0): Promise<{ mission: Mission; terminal: TerminalInfo }> => {
  if (!name.trim()) throw new Error("a mission needs a name");
  if (!brief.trim()) throw new Error("a mission needs the line you would have opened a session with");
  const id = slug(name);
  if (!id) throw new Error(`"${name}" does not reduce to a usable id`);
  if (await readMission(project.id, id)) throw new Error(`${project.name} already has a mission "${id}"`);
  const cfg = await missionConfigFor(project.path);
  const choices = await repoChoices(project, cfg);
  const plan = join("deliverables", "missions", `${id}.md`);
  const mission: Mission = {
    id,
    project: project.id,
    name: name.trim(),
    brief: brief.trim(),
    status: "interviewing",
    created: new Date().toISOString(),
    plan,
    repos: [],
    land: cfg.land,
    trackerIndex,
    milestones: [],
  };
  if (!project.trackers[trackerIndex]) throw new Error(`project "${project.id}" has no tracker at index ${trackerIndex}`);
  await mkdir(join(project.path, "deliverables", "missions"), { recursive: true });
  const terminal = openTerminal(`Strike Lead · ${mission.name}`, ["claude", interviewPrompt(project, mission, join(project.path, plan), choices, cfg.land)], project.path, 120, 36);
  mission.interview = { terminalId: terminal.id, started: new Date().toISOString() };
  await writeMission(mission);
  return { mission, terminal };
};

/** Start the interview again after a server restart took the terminal with it. */
export const reopenInterview = async (project: Project, id: string): Promise<TerminalInfo> => {
  const mission = await missionOr404(project.id, id);
  if (mission.approved) throw new Error(`${mission.name} is already approved; the interview is over`);
  const cfg = await missionConfigFor(project.path);
  const terminal = openTerminal(`Strike Lead · ${mission.name}`, ["claude", interviewPrompt(project, mission, join(project.path, mission.plan), await repoChoices(project, cfg), cfg.land)], project.path, 120, 36);
  mission.interview = { terminalId: terminal.id, started: new Date().toISOString() };
  await writeMission(mission);
  return terminal;
};

/** Read the plan the Strike Lead wrote, without committing to it. This is what the gate shows. */
export const previewPlan = async (project: Project, id: string): Promise<{ found: boolean; text?: string; parsed?: ReturnType<typeof parsePlan>; cost?: Cost; repos?: Array<{ label: string; base: string; land: Landing }> }> => {
  const mission = await missionOr404(project.id, id);
  let text: string;
  try {
    text = await readFile(join(project.path, mission.plan), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { found: false };
  }
  const cfg = await missionConfigFor(project.path);
  const choices = await repoChoices(project, cfg);
  const parsed = parsePlan(text, choices.map((r) => r.label));
  if (!parsed.problems.length && mission.status === "interviewing") {
    mission.status = "planned";
    mission.milestones = parsed.milestones;
    await writeMission(mission);
  }
  // Only the repos the plan names, so the gate shows what this mission will actually touch.
  const named = new Set(parsed.milestones.flatMap((m) => m.tasks.map((t) => t.repo)));
  return { found: true, text, parsed, cost: costOf(parsed.milestones), repos: choices.filter((r) => named.has(r.label)).map(({ label, base, land }) => ({ label, base, land })) };
};

/* ---------- the blessing, and the tracker write ---------- */

const today = (): string => new Date().toISOString().slice(0, 10);

/** One item block, in the shape `src/trackers.ts` parses: a bullet, its fields, then its prose. */
const itemBlock = (title: string, fields: Record<string, string>, body: string[]): string => [
  `- [ ] \`[ENG]\` **${title}**`,
  ...Object.entries(fields).map(([k, v]) => `  - ${k}: ${v}`),
  ...body.flatMap((line) => line.split("\n")).map((l) => l.trim()).filter(Boolean).map((l) => `  ${l}`),
].join("\n");

const headerBlock = (mission: Mission, intro: string): string =>
  itemBlock(`Mission: ${mission.name}`, { created: today(), source: `Strike Lead interview, ${today()}`, kind: "mission", mission: mission.id, plan: mission.plan },
    [intro, ...mission.milestones.map((m) => `Milestone ${m.n} — ${m.title}: done when ${m.done}`)]);

const taskBlock = (mission: Mission, m: Milestone, task: MissionTask): string =>
  itemBlock(task.title, { created: today(), source: `mission ${mission.id}, milestone ${m.n}`, mission: mission.id, milestone: String(m.n), ...(task.repo ? { repo: task.repo } : {}) }, [task.intent]);

const PRIORITY = /🔥/;

/** Write the whole plan into the tracker as items, in one commit, under its own group on the roadmap. */
const writePlanToTracker = async (project: Project, mission: Mission, intro: string): Promise<string> => {
  const tracker = project.trackers[mission.trackerIndex];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${mission.trackerIndex}`);
  let text = await readFile(tracker.path, "utf8");
  const section = parseTracker(text).sections.find((s) => PRIORITY.test(s.heading));
  if (!section) throw new Error(`${tracker.label} has no 🔥 Priority section to plan into`);
  const { heading } = section;
  const group = `Mission: ${mission.name}`;
  if (!section.groups.some((g) => g.name === group)) text = addGroup(text, heading, group);
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
    throw new Error(`no plan at ${mission.plan}; the Strike Lead has not written one yet`);
  });
  const cfg = await missionConfigFor(project.path);
  const choices = await repoChoices(project, cfg);
  const parsed = parsePlan(text, choices.map((r) => r.label));
  if (parsed.problems.length) throw new Error(`the plan cannot be flown as written: ${parsed.problems.join("; ")}`);
  mission.milestones = parsed.milestones;
  mission.land = cfg.land;
  // Only the repos the plan actually names get a branch. A project with eleven repos does not
  // get eleven mission branches because one task touches one of them.
  const named = new Set(parsed.milestones.flatMap((m) => m.tasks.map((t) => t.repo)));
  mission.repos = choices.filter((r) => named.has(r.label)).map((r) => ({
    label: r.label,
    path: r.path,
    base: r.base,
    branch: `${cfg.branchPrefix}${mission.id}`,
    integration: join(project.path, cfg.worktrees, `${mission.id}-integration-${r.label}`),
    land: r.land,
  }));
  mission.planCommit = await writePlanToTracker(project, mission, parsed.intro);
  for (const repo of mission.repos) {
    await ensureBranch(repo.path, repo.branch, repo.base);
    await ensureWorktree(repo.path, repo.integration, repo.branch, repo.base);
  }
  const formation = await createFormation(project.id, mission.name.slice(0, 40));
  mission.formation = formation.id;
  await seatTheLead(mission);
  mission.approved = new Date().toISOString();
  mission.status = "flying";
  await writeMission(mission);
  return dispatch(project, mission, mission.milestones[0]);
};

/* ---------- the flight ---------- */

const wingmanPrompt = (project: Project, mission: Mission, m: Milestone, task: MissionTask, repo: MissionRepo, findings?: string): string => [
  `You are a Wingman on the mission "${mission.name}" in the project at ${project.path}. You own one task and nothing else.`,
  "",
  `Your repo is ${repo.label}, at ${repo.path}. Your worktree is ${task.worktree}, on branch ${task.branch}, branched from ${repo.branch}. Work there and only there: do not touch the project's other repos, do not touch their main worktrees, do not switch branches, and do not merge anything.`,
  ...(mission.repos.length > 1
    ? ["", [
        "This mission spans more than one repo, and the milestones before yours have already landed their work on their own branches. **None of it has been merged to a base branch**, so do not expect to find it on main or develop. Where you need to read what an earlier milestone did, read it there:",
        ...mission.repos.filter((r) => r.label !== repo.label).map((r) => `  - ${r.label}: branch ${r.branch} in ${r.path}, checked out at ${r.integration}`),
        "If your task depends on something upstream that is not on that branch either, stop and say so rather than inventing it.",
      ].join("\n")]
    : []),
  "",
  `Milestone ${m.n} — ${m.title}. That milestone is done when: ${m.done}`,
  "",
  `Your task: ${task.title}`,
  "",
  task.intent,
  "",
  ...(findings ? [`A RIO who did not write this code rejected your predecessor's attempt. Its findings, verbatim:\n\n${findings}\n\nStart from the code that is already on your branch and fix what the findings name. Do not argue with the RIO in the code; where you believe a finding is wrong, say so in your commit message and leave the evidence.`, ""] : []),
  "Read the repo's own rules before you write anything: its rulebook, its decision log and its design contract if it has them. Match the code around you.",
  "",
  "Commit your work in your worktree, in small commits with plain lowercase subjects. Do not write to the project's trackers; Maverick owns those for this mission. Do not open a pull request. Do not spawn other agents.",
  "",
  "When you are done, stop. A RIO that is not you will check the work, so do not grade yourself in the commit messages: say what you did and what you could not verify.",
].join("\n");

const reviewPrompt = (project: Project, mission: Mission, m: Milestone, task: MissionTask, repo: MissionRepo, file: string): string => [
  `You are the RIO for one Wingman on the mission "${mission.name}" in the project at ${project.path}. You fly in its back seat: you read what it did and you call it. You did not write this code and you will not fix it.`,
  "",
  `The work is in the ${repo.label} repo, on branch ${task.branch}, in the worktree at ${task.worktree}. Read every commit on it that ${repo.branch} does not have (\`git -C ${task.worktree} log ${repo.branch}..HEAD -p\`).`,
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

/**
 * A Wingman gets the same session record any other spawned task session gets, so it appears in
 * the rack and in the ship's release review instead of in a parallel universe. Its `audit` is
 * set to the mission's own RIO, which is also what stops the ship auditing it a second
 * time: `ships.ts` skips a develop record that already has one.
 */
const recordWingman = async (mission: Mission, task: MissionTask): Promise<void> => {
  const record: SessionRecord = {
    id: `bg-${task.claudeId}`,
    role: "develop",
    loop: `${mission.name}: ${task.title}`,
    exit: task.intent.split("\n")[0].slice(0, 200),
    status: "open",
    started: task.started ?? new Date().toISOString(),
    project: mission.project,
    claudeId: task.claudeId,
    mission: mission.id,
    repo: task.repo,
    ...(task.worktree ? { worktree: task.worktree } : {}),
  };
  await writeSession(config.sessionsDir, record);
};

/** Send every task in a milestone out at once: parallelism is narrow, inside a milestone only. */
const dispatch = async (project: Project, mission: Mission, m: Milestone): Promise<Mission> => {
  const cfg = await missionConfigFor(project.path);
  // A repo's mission branch does not move while a milestone goes out, so every task in that
  // repo is cut from the same commit; resolving it once is what makes the bases comparable.
  const bases = new Map(await Promise.all(mission.repos.map(async (r) => [r.label, await revParse(r.path, r.branch)] as const)));
  for (const task of m.tasks) {
    if (task.status !== "pending") continue;
    try {
      const repo = missionRepo(mission, task);
      task.worktree = join(project.path, cfg.worktrees, `${mission.id}-${task.id}-${repo.label}`);
      // A sibling of the mission branch, never a child: git cannot hold both `mission/x` and
      // `mission/x/m1-t1`, because the first is a ref file where the second wants a directory.
      task.branch = `${repo.branch}-${task.id}`;
      await ensureWorktree(repo.path, task.worktree, task.branch, repo.branch);
      task.base = bases.get(repo.label);
      task.claudeId = await spawnBackgroundAgent(task.worktree, `${mission.name} · ${task.title}`, wingmanPrompt(project, mission, m, task, repo));
      task.status = "flying";
      task.started = new Date().toISOString();
      task.attempts = 1;
      agentCache.delete(project.path);
      await recordWingman(mission, task);
    } catch (err) {
      task.status = "handed-back";
      task.note = `could not launch: ${(err as Error).message}`;
    }
    // Saved per task, not once at the end: a spawn that is not on disk is an agent nobody owns.
    await writeMission(mission);
  }
  m.dispatched = new Date().toISOString();
  return writeMission(mission);
};

/** Put a task back out with the RIO's findings, in the worktree it already has. */
const handBack = async (project: Project, mission: Mission, m: Milestone, task: MissionTask, findings: string): Promise<void> => {
  const previous = task.claudeId;
  task.claudeId = await spawnBackgroundAgent(task.worktree!, `${mission.name} · ${task.title} (retry ${task.attempts + 1})`, wingmanPrompt(project, mission, m, task, missionRepo(mission, task), findings));
  task.sessionId = undefined;
  task.status = "flying";
  task.attempts += 1;
  task.started = new Date().toISOString();
  task.ended = undefined;
  task.verdict = undefined;
  task.review = undefined;
  if (previous) await patchSession(config.sessionsDir, `bg-${previous}`, { status: "handed-off", ended: new Date().toISOString(), handoff: findings.split("\n")[0] });
  await recordWingman(mission, task);
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
 * One pass over every flying mission. Called on the server's timer and on every read of the
 * mission page, which polls: two passes overlapping would each see the same finished Wingman
 * and each spawn a RIO for it, so a project sweeps one at a time.
 */
const sweeping = new Set<string>();

/** `claude agents` is a subprocess and the page polls; well inside SETTLE_MS, so it changes nothing. */
const AGENTS_TTL_MS = 20_000;
const agentCache = new Map<string, { at: number; agents: Awaited<ReturnType<typeof backgroundAgents>> }>();
const agentsFor = async (path: string): Promise<Awaited<ReturnType<typeof backgroundAgents>>> => {
  const hit = agentCache.get(path);
  if (hit && Date.now() - hit.at < AGENTS_TTL_MS) return hit.agents;
  const agents = await backgroundAgents(path);
  agentCache.set(path, { at: Date.now(), agents });
  return agents;
};

export const sweepMissions = async (project: Project): Promise<void> => {
  if (sweeping.has(project.id)) return;
  sweeping.add(project.id);
  try {
    await sweepOnce(project);
  } finally {
    sweeping.delete(project.id);
  }
};

const sweepOnce = async (project: Project): Promise<void> => {
  const missions = (await listMissions(project.id)).filter((m) => m.status === "flying");
  if (!missions.length) return;
  const agents = new Map((await agentsFor(project.path)).map((a) => [a.id, a]));
  const state = new Map([...agents].map(([id, a]) => [id, a.state ?? ""]));
  for (const mission of missions) {
    const waiting: string[] = [];
    let seated = false;
    mission.trouble = undefined;
    for (const m of mission.milestones) {
      if (!m.dispatched || m.merged) continue;
      for (const task of m.tasks) {
        // A session id only exists once the agent listing knows about it; the formation wants
        // that one. An agent can be listed without one, so read it rather than test for the key.
        const sessionId = task.claudeId ? agents.get(task.claudeId)?.sessionId : undefined;
        if (sessionId && !task.sessionId) {
          task.sessionId = sessionId;
          seated = true;
        }
        if (task.status === "flying" && task.claudeId && state.get(task.claudeId) === "blocked") {
          waiting.push(`${task.title} is waiting on you in its own session`);
        }
        if (task.status === "flying" && task.claudeId && isOver(state, task.claudeId, task.started)) {
          task.status = "built";
          task.ended = new Date().toISOString();
          task.commits = await commitsAhead(missionRepo(mission, task).path, missionRepo(mission, task).branch, task.branch!).catch(() => []);
        }
        if (task.status === "built") {
          const file = reviewFile(mission, task, task.attempts);
          try {
            // "auditor" is Claude Code's own agent name (`~/.claude/agents/auditor.md`), not our word for the role.
            const claudeId = await spawnBackgroundAgent(project.path, `RIO · ${task.title}`, reviewPrompt(project, mission, m, task, missionRepo(mission, task), file), "auditor");
            task.review = { claudeId, file, started: new Date().toISOString() };
            task.status = "reviewing";
            agentCache.delete(project.path);
            await patchSession(config.sessionsDir, `bg-${task.claudeId}`, { audit: task.review });
          } catch (err) {
            task.status = "handed-back";
            task.note = `could not start the RIO: ${(err as Error).message}`;
          }
        }
        if (task.status === "reviewing" && task.review) {
          const findings = await readFile(task.review.file, "utf8").catch(() => null);
          const verdict = findings ? verdictOf(findings) : undefined;
          if (!verdict || verdict === "pending") {
            // The RIO is gone and wrote nothing: that is a failed review, not a pass.
            if (isOver(state, task.review.claudeId, task.review.started)) {
              task.status = "handed-back";
              task.note = "the RIO finished without writing a verdict";
            }
            continue;
          }
          task.verdict = verdict;
          await patchSession(config.sessionsDir, `bg-${task.claudeId}`, { status: "closed", ended: new Date().toISOString() });
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
            task.note = `the RIO said ${verdict} after ${task.attempts} attempts; this one is yours`;
          }
        }
      }
      if (m.tasks.length && m.tasks.every((t) => t.status === "passed")) {
        // Each task lands on its own repo's mission branch: a milestone can span repos, and
        // a conflict in one must not leave another half-applied.
        m.mergeShas = m.mergeShas ?? {};
        for (const task of m.tasks) {
          if (!task.commits?.length) continue;
          const repo = missionRepo(mission, task);
          const result = await mergeInto(repo.integration, task.branch!, `mission ${mission.id}: ${task.title}`);
          if (!result.merged) {
            m.conflicts = (result.conflicts ?? []).map((f) => `${repo.label}/${f}`);
            mission.status = "blocked";
            mission.trouble = `milestone ${m.n} will not merge into ${repo.label}: ${m.conflicts.join(", ") || "unknown conflict"}`;
            await writeMission(mission);
            return;
          }
          if (result.sha) m.mergeShas[repo.label] = result.sha;
        }
        m.merged = new Date().toISOString();
        // A repo with nothing left to do gets its pull request now rather than at the close, so
        // an earlier repo can be reviewed and merged while the later ones are still flying.
        if (mission.repos.some((r) => r.land !== "merge")) {
          const { failed } = await landTheWork(mission, true);
          if (failed.length) mission.trouble = `could not land: ${failed.join(" · ")}`;
        }
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
        mission.trouble = m.tasks.filter((t) => t.status === "handed-back").map((t) => `${t.title}: ${t.note ?? `the RIO said ${t.verdict}`}`).join(" · ");
      }
    }
    if (waiting.length && mission.status === "flying") mission.trouble = waiting.join(" · ");
    // One formation write per pass rather than one per task that gained a session id.
    if (seated && mission.formation) await updateFormation(mission.formation, { members: memberIds(mission) }).catch(() => undefined);
    // The Strike Lead only reaches Claude Code's session registry once its session has done something,
    // which can be well after the formation was made; keep offering it the lead seat.
    await seatTheLead(mission).catch(() => undefined);
    await writeMission(mission);
  }
};

const memberIds = (mission: Mission): string[] =>
  mission.milestones.flatMap((m) => m.tasks.map((t) => t.sessionId).filter((s): s is string => Boolean(s)));

/**
 * The Strike Lead is the formation's lead, which is the same word twice on purpose: a formation
 * is one lead plus its flight, and a mission makes one. A formation holds session uuids, and the
 * lead runs in one of our ptys, so its uuid is the registry session whose process descends from
 * that pty, the way the workspace already matches a session to its dock terminal.
 */
const seatTheLead = async (mission: Mission): Promise<void> => {
  if (!mission.formation || !mission.interview) return;
  if ((await listFormations(mission.project)).find((f) => f.id === mission.formation)?.lead) return;
  const pty = listTerminals().find((t) => t.id === mission.interview!.terminalId);
  if (!pty?.pid || pty.exitCode !== null) return;
  const sessions = await readRegistrySessions();
  // Asked of every session at once: `parentChain` reads one cached process table, so the cost
  // of this is one `ps` rather than one per session.
  const chains = await Promise.all(sessions.map((s) => parentChain(s.pid)));
  const lead = sessions.find((_, i) => chains[i].includes(pty.pid!));
  if (lead) await updateFormation(mission.formation, { lead: lead.sessionId }).catch(() => undefined);
};

/* ---------- Cory's second and last gate ---------- */

/**
 * Every live session a mission owns: its Wingmen and the RIOs reviewing them. The brake on a
 * thing that costs twelve times a normal session has to be one call, not one per agent.
 */
export const abandonMission = async (project: Project, id: string, stop: (claudeId: string) => Promise<void>): Promise<{ mission: Mission; stopped: string[] }> => {
  const mission = await missionOr404(project.id, id);
  const stopped: string[] = [];
  for (const task of mission.milestones.flatMap((m) => m.tasks)) {
    for (const live of [task.status === "flying" ? task.claudeId : undefined, task.status === "reviewing" ? task.review?.claudeId : undefined]) {
      if (!live) continue;
      await stop(live).then(() => stopped.push(live)).catch(() => undefined);
    }
    if (task.status === "flying" || task.status === "reviewing" || task.status === "built") {
      task.status = "handed-back";
      task.note = "stopped when the mission was abandoned";
    }
  }
  mission.status = "abandoned";
  mission.finished = mission.finished ?? new Date().toISOString();
  // The branches and their worktrees are deliberately left: whatever was built is still there.
  mission.trouble = `abandoned; ${stopped.length} session(s) stopped. The branches and worktrees are untouched.`;
  return { mission: await writeMission(mission), stopped };
};

/**
 * Take back the worktrees the tasks were built in, once their work is merged and landed. The
 * branches stay, so nothing is lost; it is the directories that pile up, three repos deep.
 */
export const tidyWorktrees = async (project: Project, id: string): Promise<string[]> => {
  const mission = await missionOr404(project.id, id);
  const gone: string[] = [];
  for (const task of mission.milestones.flatMap((m) => m.tasks)) {
    if (!task.worktree || task.status !== "passed") continue;
    const repo = mission.repos.find((r) => r.label === task.repo);
    if (!repo) continue;
    await removeWorktree(repo.path, task.worktree).then(() => gone.push(task.worktree!)).catch(() => undefined);
  }
  return gone;
};

/** Put a blocked task back in the air after Cory has had a look, with one more attempt. */
export const retryTask = async (project: Project, id: string, taskId: string): Promise<Mission> => {
  const mission = await missionOr404(project.id, id);
  const m = mission.milestones.find((x) => x.tasks.some((t) => t.id === taskId));
  const task = m?.tasks.find((t) => t.id === taskId);
  if (!m || !task) throw new Error(`no task "${taskId}" on ${mission.name}`);
  if (!task.worktree) throw new Error(`${task.title} never got a worktree; it cannot be retried`);
  const findings = task.review ? await readFile(task.review.file, "utf8").catch(() => "") : "";
  task.attempts = MAX_ATTEMPTS - 1;
  await handBack(project, mission, m, task, findings);
  task.note = undefined;
  mission.status = "flying";
  mission.trouble = undefined;
  return writeMission(mission);
};

/** Accept a task Cory has looked at himself, so a milestone its RIO failed can still merge. */
export const acceptTask = async (project: Project, id: string, taskId: string, note: string): Promise<Mission> => {
  const mission = await missionOr404(project.id, id);
  const task = mission.milestones.flatMap((m) => m.tasks).find((t) => t.id === taskId);
  if (!task) throw new Error(`no task "${taskId}" on ${mission.name}`);
  task.status = "passed";
  task.note = `accepted by Cory over the RIO: ${note}`.trim();
  if (task.claudeId) await patchSession(config.sessionsDir, `bg-${task.claudeId}`, { decision: "accepted" });
  mission.status = "flying";
  mission.trouble = undefined;
  return writeMission(mission);
};

/**
 * Close the mission: tick every passed task's item in the tracker, in one commit, and hand the
 * branch to the ship wizard. Maverick does not merge a mission into main; that is the ship's job.
 */
/**
 * Land the work the way the project says. `merge` leaves it on each repo's mission branch, for
 * Cory to check out and merge himself. `pr` pushes and opens one pull request per repo against
 * that repo's base, and that is as far as Maverick goes: a project whose own rules say never
 * self-merge (Realtime's `CLAUDE.md` says exactly that) must not have a tool merge for it.
 */
const landTheWork = async (mission: Mission, onlyFinished = false): Promise<{ landed: string[]; failed: string[] }> => {
  const opened: string[] = [];
  const failed: string[] = [];
  const all = mission.milestones.flatMap((m) => m.tasks);
  for (const repo of mission.repos) {
   try {
    if (repo.land === "merge") continue;
    if (repo.landed) {
      opened.push(repo.landed);
      continue;
    }
    const mine = all.filter((t) => t.repo === repo.label);
    // Mid-flight, a repo is only ready when nothing of its own is still moving.
    if (onlyFinished && mine.some((t) => t.status !== "passed")) continue;
    const tasks = mine.filter((t) => t.status === "passed");
    if (!tasks.length) continue;
    if (repo.land === "push") {
      repo.landed = `${repo.base}@${await pushFastForward(repo.path, repo.branch, repo.base)}`;
      opened.push(repo.landed);
      continue;
    }
    await pushBranch(repo.path, repo.branch);
    const body = [
      `Mission **${mission.name}**, planned and flown from Maverick.`,
      "",
      `The plan: \`${mission.plan}\``,
      "",
      "## What is in it",
      ...tasks.map((t) => `- **${t.title}** — ${t.commits?.length ?? 0} commit(s), reviewed by a RIO that did not write it: ${t.verdict ?? "unrecorded"}`),
      "",
      "Every task was built in its own worktree with fresh context and reviewed by a separate session before it was merged onto this branch. Nothing here has been merged to a base branch by a tool.",
    ].join("\n");
    repo.landed = await openPullRequest(repo.path, repo.branch, repo.base, `${mission.name} (${repo.label})`, body);
    opened.push(repo.landed);
   } catch (err) {
     // One repo's remote is not the others' problem: land what can land and name what could not.
     failed.push(`${repo.label}: ${(err as Error).message.split("\n")[0]}`);
   }
  }
  return { landed: opened, failed };
};

export const closeMission = async (project: Project, id: string): Promise<{ mission: Mission; commit: string; ticked: string[]; pullRequests: string[] }> => {
  const mission = await missionOr404(project.id, id);
  // Opened before the tracker is touched: a failure to push or open must not leave the board
  // saying done while nothing is up for review.
  const { landed: pullRequests, failed } = await landTheWork(mission);
  if (failed.length) throw new Error(`the work is built and merged onto the mission branches, but landing it failed and nothing has been ticked: ${failed.join(" · ")}`);
  const tracker = project.trackers[mission.trackerIndex];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${mission.trackerIndex}`);
  const tasks = mission.milestones.flatMap((m) => m.tasks.map((t) => ({ milestone: m.n, task: t })));
  const passed = new Set(tasks.filter(({ task }) => task.status === "passed").map(({ milestone, task }) => `${milestone}\u0000${task.title}`));
  // The mission's own row is done when every task under it is; leaving it open after the last
  // one ticks would leave a mission on the board that nothing is working.
  const whole = tasks.length > 0 && tasks.every(({ task }) => task.status === "passed");

  // Found by its fields rather than by a line stored at approval, because other sessions move
  // items between lanes while a mission flies. Read and written once, ticking from the bottom
  // up so the earlier items' line numbers are still good when their turn comes.
  let text = await readFile(tracker.path, "utf8");
  const mine = parseTracker(text).sections
    .flatMap((s) => s.groups.flatMap((g) => g.items))
    .filter((i) => i.fields.mission === mission.id && !i.checked)
    .filter((i) => (whole && i.fields.kind === "mission") || passed.has(`${i.fields.milestone ?? ""}\u0000${i.title}`));
  for (const item of [...mine].sort((a, b) => b.start - a.start)) text = setChecked(text, item.start, item.firstLine, true);
  const ticked = mine.map((i) => i.title);
  if (ticked.length) await writeFile(tracker.path, text, "utf8");
  const commit = ticked.length ? await commitFile(tracker.path, `console: mission "${mission.name}" done (${ticked.length} items)`) : "no change";
  mission.status = "closed";
  mission.finished = mission.finished ?? new Date().toISOString();
  await writeMission(mission);
  return { mission, commit, ticked, pullRequests };
};

/** What the review gate reads: every task with its commits, its verdict and its findings. */
/**
 * What the review gate reads. A task that has passed will not change again — its range is
 * frozen and its findings file is written once — so both are remembered against keys that
 * cannot go stale. Without this the page's eight-second poll shells out to git once per task,
 * forever, for a mission that finished hours ago.
 */
const frozen = new Map<string, string>();
const remembered = async (key: string, read: () => Promise<string>, keep: boolean): Promise<string> => {
  const hit = frozen.get(key);
  if (hit !== undefined) return hit;
  const value = await read();
  if (keep) frozen.set(key, value);
  return value;
};

export const missionView = async (project: Project, id: string): Promise<Mission & { findings: Record<string, string>; diffstat: Record<string, string> }> => {
  const mission = await missionOr404(project.id, id);
  const findings: Record<string, string> = {};
  const diffstat: Record<string, string> = {};
  const settled = (task: MissionTask) => task.status === "passed" || task.status === "handed-back";
  await Promise.all(mission.milestones.flatMap((m) => m.tasks).map(async (task) => {
    if (task.review) {
      const text = await remembered(`findings:${task.review.file}`, () => readFile(task.review!.file, "utf8").catch(() => ""), settled(task));
      if (text) findings[task.id] = text;
    }
    if (task.branch) {
      const repo = mission.repos.find((r) => r.label === task.repo);
      const from = task.base ?? repo?.branch;
      if (!repo || !from) return;
      const stat = await remembered(`diff:${repo.path}:${from}..${task.branch}`, () => diffStat(repo.path, from, task.branch!), settled(task) && Boolean(task.base));
      if (stat) diffstat[task.id] = stat;
    }
  }));
  return { ...mission, findings, diffstat };
};
