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
import { dirname, join, relative } from "node:path";
import { config } from "./config.ts";
import { missionConfigFor, type Landing, type MissionConfig } from "./project-config.ts";
import { FINISHED, backgroundAgents, changedFiles, claudeArgs, commitFile, commitsAhead, currentBranch, diffStat, ensureBranch, ensureWorktree, excludeLocally, mergeInto, openPullRequest, pushBranch, pushFastForward, removeWorktree, reposUnder, revParse, spawnBackgroundAgent, toplevelOf } from "./git.ts";
import { slug, verdictOf, type Verdict } from "./audits.ts";
import type { Project } from "./projects.ts";
import { createFormation, listFormations, updateFormation } from "./formations.ts";
import { patchSession, writeSession, type SessionRecord } from "./sessions.ts";
import { readRegistrySessions } from "./live.ts";
import { parentChain } from "./processes.ts";
import { WALKTHROUGH_DOC, documentsSince } from "./ships.ts";
import { listTerminals, openTerminal, type TerminalInfo } from "./terminal.ts";
import { FIELD_LINE, PRIORITY, allItems, documentHead, itemBlock, parseTracker, placeInGroup, setChecked, today } from "./trackers.ts";
import { planOnBranch, rioBrief, wingmanBrief, type BriefContext } from "./briefs.ts";

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
  /** The branch head when the Wingman stopped: the `commit:` line in the plan's ledger. */
  head?: string;
  /** The paths this task owns, relative to its repo, from the plan's `touches:` line. A file or a directory. */
  touches?: string[];
  /** The tasks this one builds on, by id, from the plan's `needs:` line. Validated at parse; not yet what the scheduler dispatches by. */
  needs?: string[];
  /** Files the Wingman changed outside `touches`, found when it stopped. The RIO is told; a stray is a finding unless the hand-back justified it. */
  strayed?: string[];
  /** How many RIOs this task has had. Only ever goes up, so their findings never share a path. */
  reviews?: number;
  /** The RIO in this Wingman's back seat: a separate session, never the Wingman, never the lead. */
  review?: { claudeId: string; file: string; started: string };
  verdict?: Verdict;
  /** Why this task stopped needing an agent, in words, when it did not simply pass. */
  note?: string;
}

/** Progress through the hosted walkthrough document, saved from the page as it is worked. */
export interface WalkthroughProgress {
  total: number;
  answered: number;
  /** Case id -> what the person said. The gate counts answers; the verdicts are the person's record of what they found. */
  verdicts: Record<string, string>;
  updatedAt: string;
}

/**
 * The milestone's walkthrough: the same gate the ship has, one level down. A session builds the
 * document in the integration worktree once the milestone has merged; the milestone is walked
 * when a person has answered every case in it, and the mission does not land until every
 * milestone that changed anything has been walked. Shaped like `resolve`: a milestone-level
 * record of one agent, settled by what it left on the branch rather than by what it said.
 */
export interface MilestoneWalkthrough {
  claudeId?: string;
  started?: string;
  /** The document, relative to the project, once the session has written it. */
  doc?: string;
  progress?: WalkthroughProgress;
  /** Why there is no document to walk, when the session did not produce one. */
  failed?: string;
  /** Cory let the milestone through without walking it, and said why. */
  waived?: { note: string; at: string };
}

export type WalkthroughState = "none" | "building" | "failed" | "walking" | "walked" | "waived";

/** What the page is told about a milestone's walkthrough, derived here so the page and the gate cannot disagree. */
export interface WalkView { state: WalkthroughState; needed: boolean }

export interface WalkthroughPatch { progress?: WalkthroughProgress; waive?: { note: string } }

export interface Milestone {
  n: number;
  title: string;
  /** One testable line: what "done" means for this milestone. */
  done: string;
  tasks: MissionTask[];
  dispatched?: string;
  merged?: string;
  walkthrough?: MilestoneWalkthrough;
  /** The merge commit per repo, since a milestone can land work in more than one. */
  mergeShas?: Record<string, string>;
  conflicts?: string[];
  /** The Strike Lead sent in to reconcile a conflict. One per milestone; after that it is Cory's. */
  resolve?: { claudeId: string; repo: string; branch: string; started: string; paths: string[] };
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
  /** The breakdown document this mission came out of, when a Strike Lead was handed a brainstorm's item rather than a line Cory typed. */
  from?: string;
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
  /** Bumped on every write. A write carrying a stale one is refused; see `writeMission`. */
  rev?: number;
  /** How many milestones this mission has had to reconcile. A plan whose tasks overlap shows up here. */
  conflictsSeen?: number;
  /**
   * What the mission could not settle on its own, for a person and eventually for the CAG. A
   * mission that keeps colliding is a planning problem, not a merge problem, and the level
   * that owns the plan is the one that can fix it.
   */
  escalation?: string;
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

/**
 * The whole record is read, changed and written back, and the sweep holds its copy across
 * minutes of `git merge` and `claude --bg`. Cory pressing a button in that window used to lose:
 * the sweep would finish and write its stale copy over the abandon, leaving dead agents and a
 * console insisting the mission was live.
 *
 * So every write carries the `rev` it was read at, and a write whose `rev` no longer matches
 * disk is refused. The two sides then differ in what they do about it, deliberately:
 *
 * - a person's action retries against the fresh record, because they asked for it and it is a
 *   handful of milliseconds' work to redo;
 * - the sweep drops its pass entirely, because everything it does is idempotent and the next
 *   pass sixty seconds later sees the truth. The machine yields to the person, always.
 */
export class StaleMissionError extends Error {}

const writeMission = async (mission: Mission): Promise<Mission> => {
  const onDisk = await readMission(mission.project, mission.id);
  if (onDisk && (onDisk.rev ?? 0) !== (mission.rev ?? 0)) {
    throw new StaleMissionError(`${mission.name} changed underneath this write (rev ${mission.rev ?? 0}, disk ${onDisk.rev ?? 0})`);
  }
  const next = { ...mission, rev: (mission.rev ?? 0) + 1 };
  await mkdir(missionsDir(next.project), { recursive: true });
  await writeFile(missionPath(next.project, next.id), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  // The caller keeps working with the object it already holds, so it has to move with it.
  mission.rev = next.rev;
  return mission;
};

const missionOr404 = async (projectId: string, id: string): Promise<Mission> => {
  const mission = await readMission(projectId, id);
  if (!mission) throw new Error(`no mission "${id}" in ${projectId}`);
  return mission;
};

/**
 * One person-driven change to a mission: read it fresh, change it, write it. If the sweep wrote
 * in between, the whole thing is done again against the new record rather than merged, because
 * a retry here is cheap and a half-applied change is not.
 */
const changeMission = async <T>(projectId: string, id: string, change: (mission: Mission) => Promise<T> | T): Promise<T> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const mission = await missionOr404(projectId, id);
    try {
      const result = await change(mission);
      await writeMission(mission);
      return result;
    } catch (err) {
      if (!(err instanceof StaleMissionError) || attempt === 3) throw err;
    }
  }
  throw new StaleMissionError(`${id} would not settle long enough to change; try again`);
};

/** Exposed for the store's tests, which need to write a deliberately stale copy. */
export const __writeMissionForTest = writeMission;

/* ---------- the plan, as the Strike Lead must write it ---------- */

const PLAN_FORMAT = `# Mission: <name>

<One paragraph: what this mission is for, and what it is deliberately not.>

## Milestone 1 — <short title>

_done when: <one testable line>_

- [ ] **<task title>**
  - repo: <which repo this works in; omit it only when the project has one>
  - touches: <the files and directories this task owns, relative to its repo, comma separated>
  - needs: <the ids of tasks this one builds on (m1-t2), if any>
  <Everything a session with no other context needs to build this: the files, the shape, what
  it must not touch, and how it proves itself. Several lines is right; one line is not.>
  <Once the mission flies, Maverick writes status, attempt, verdict and commit lines under each
  task and keeps a "## Log" section at the end: the plan on the mission branch is the ledger.>

- [ ] **<the next task in this milestone>**
  - repo: <...>
  <...>

## Milestone 2 — <short title>

_done when: <one testable line>_

- [ ] **<task title>**
  <...>`;

const MILESTONE_HEADING = /^Milestone\s+(\d+)\s*[—–:-]\s*(.+)$/;
const DONE_LINE = /^_*\s*done when:\s*(.+?)\s*_*$/i;
/** The section at the end of a flying plan where every transition and decision is appended. */
const LOG_HEADING = /^Log$/i;
const TASK_STATUSES: readonly string[] = ["pending", "flying", "built", "reviewing", "passed", "handed-back"];
const VERDICTS: readonly string[] = ["pass", "fail", "mixed"];
/** The fields Maverick writes under a task as it flies. A Strike Lead leaves them off; the ledger owns them. */
const STATE_FIELDS: readonly string[] = ["status", "attempt", "verdict", "commit"];

const listField = (value: string | undefined): string[] => (value ?? "").split(/[,\s]+/).map((v) => v.trim().replace(/^\.\//, "").replace(/\/+$/, "")).filter(Boolean);

/** Whether two owned paths are the same file, or one is inside the other. */
const pathsOverlap = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Files a Wingman changed that none of its `touches` cover. Empty when the task owns nothing in particular. */
export const strays = (files: string[], touches: string[] | undefined): string[] =>
  touches?.length ? files.filter((f) => !touches.some((t) => f === t || f.startsWith(`${t}/`))) : [];

/** Tasks in one milestone whose `touches` overlap: they fly in parallel, so this is a collision planned in. */
export const overlapsIn = (milestones: Milestone[]): string[] =>
  milestones.flatMap((m) => m.tasks.flatMap((a, i) => m.tasks.slice(i + 1).flatMap((b) => {
    const shared = (a.touches ?? []).filter((x) => (b.touches ?? []).some((y) => pathsOverlap(x, y)));
    return shared.length ? [`milestone ${m.n}: ${a.id} and ${b.id} both touch ${shared.join(", ")}`] : [];
  })));

/** Parse the Strike Lead's plan document. Reuses the tracker parser, because the plan is written in its shape. */
export const parsePlan = (text: string, repos: string[] = []): { name: string; intro: string; milestones: Milestone[]; log: string[]; problems: string[]; overlaps: string[] } => {
  const lines = text.split("\n");
  const { title: name, intro } = documentHead(text, /^#\s*Mission:\s*(.+)$/m);
  const problems: string[] = [];
  if (!name) problems.push('the document has no "# Mission: <name>" heading');

  const milestones: Milestone[] = [];
  let log: string[] = [];
  for (const section of parseTracker(text).sections) {
    if (LOG_HEADING.test(section.heading)) {
      log = lines.slice(section.start + 1, section.end).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
      continue;
    }
    const m = section.heading.match(MILESTONE_HEADING);
    if (!m) {
      problems.push(`"## ${section.heading}" is not a milestone heading ("## Milestone 1 — title")`);
      continue;
    }
    const n = Number(m[1]);
    const done = (lines.slice(section.start + 1, section.end).map((l) => l.trim()).find((l) => DONE_LINE.test(l))?.match(DONE_LINE)?.[1] ?? "").trim().replace(/\.$/, "");
    if (!done) problems.push(`milestone ${n} has no "_done when: ..._" line`);
    const only = repos.length === 1 ? repos[0] : "";
    const tasks = section.groups.flatMap((g) => g.items).map((item, i) => {
      const { status, attempt, verdict, commit, touches, needs } = item.fields;
      if (status && !TASK_STATUSES.includes(status)) problems.push(`"${item.title}" in milestone ${n} has status "${status}", which is not one of: ${TASK_STATUSES.join(", ")}`);
      if (attempt && !/^\d+$/.test(attempt)) problems.push(`"${item.title}" in milestone ${n} has attempt "${attempt}", which is not a count`);
      if (verdict && !VERDICTS.includes(verdict)) problems.push(`"${item.title}" in milestone ${n} has verdict "${verdict}", which is not one of: ${VERDICTS.join(", ")}`);
      return {
        id: `m${n}-t${i + 1}`,
        title: item.title,
        intent: item.description.trim(),
        repo: item.fields.repo?.trim() || only,
        status: (TASK_STATUSES.includes(status ?? "") ? status : "pending") as TaskStatus,
        attempts: attempt && /^\d+$/.test(attempt) ? Number(attempt) : 0,
        ...(verdict && VERDICTS.includes(verdict) ? { verdict: verdict as Verdict } : {}),
        ...(commit ? { head: commit } : {}),
        ...(touches ? { touches: listField(touches) } : {}),
        ...(needs ? { needs: listField(needs) } : {}),
      };
    });
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
  milestones.sort((a, b) => a.n - b.n);
  // `needs` names tasks that exist, that are not the task itself, that are not in a later
  // milestone (it would never be there in time), and that do not need it back.
  const where = new Map(milestones.flatMap((m) => m.tasks.map((t) => [t.id, { m: m.n, t }] as const)));
  for (const m of milestones) for (const t of m.tasks) for (const need of t.needs ?? []) {
    const target = where.get(need);
    if (!target) problems.push(`"${t.title}" in milestone ${m.n} needs "${need}", which is not a task in this plan`);
    else if (need === t.id) problems.push(`"${t.title}" in milestone ${m.n} needs itself`);
    else if (target.m > m.n) problems.push(`"${t.title}" in milestone ${m.n} needs ${need}, which flies later, in milestone ${target.m}`);
    else if (target.t.needs?.includes(t.id)) problems.push(`${t.id} and ${need} need each other`);
  }
  return { name, intro, milestones, log, problems, overlaps: overlapsIn(milestones) };
};

/* ---------- the plan as the ledger ---------- */

const stateLines = (task: MissionTask): string[] => [
  `  - status: ${task.status}`,
  ...(task.attempts ? [`  - attempt: ${task.attempts}`] : []),
  ...(task.verdict && VERDICTS.includes(task.verdict) ? [`  - verdict: ${task.verdict}`] : []),
  ...(task.head ? [`  - commit: ${task.head}`] : []),
];

/**
 * Write the mission's state into its plan: the state fields under every task, the bullet's
 * marker, and new entries at the end of the log. Everything the Strike Lead wrote stays as it
 * was, so the document reads as the plan it was approved as, with where it got to underneath.
 * Pure, and the result parses back to the same state (there is a test).
 */
export const applyPlanState = (text: string, milestones: Milestone[], entries: string[] = []): string => {
  const lines = text.split("\n");
  const tracker = parseTracker(text);
  const byN = new Map(milestones.map((m) => [m.n, m.tasks]));
  const edits: Array<{ start: number; end: number; block: string[] }> = [];
  let logSection: { start: number; end: number } | undefined;
  for (const section of tracker.sections) {
    if (LOG_HEADING.test(section.heading)) {
      logSection = section;
      continue;
    }
    const tasks = byN.get(Number(section.heading.match(MILESTONE_HEADING)?.[1])) ?? [];
    section.groups.flatMap((g) => g.items).forEach((item, i) => {
      const task = tasks[i];
      if (!task) return;
      const kept = lines.slice(item.start + 1, item.end).filter((l) => !STATE_FIELDS.includes(l.match(FIELD_LINE)?.[1] ?? ""));
      // State goes after the fields the Lead wrote and before the prose.
      let at = 0;
      kept.forEach((l, j) => { if (FIELD_LINE.test(l)) at = j + 1; });
      const marker = task.status === "passed" ? "x" : task.status === "pending" ? " " : "~";
      const bullet = lines[item.start].replace(/^- \[[ x~!-]\]/, `- [${marker}]`);
      edits.push({ start: item.start, end: item.end, block: [bullet, ...kept.slice(0, at), ...stateLines(task), ...kept.slice(at)] });
    });
  }
  if (entries.length) {
    const bullets = entries.map((e) => `- ${e}`);
    if (logSection) {
      let at = logSection.end;
      while (at > logSection.start + 1 && !lines[at - 1].trim()) at -= 1;
      edits.push({ start: at, end: at, block: bullets });
    } else {
      edits.push({ start: lines.length, end: lines.length, block: ["", "## Log", "", ...bullets] });
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) lines.splice(edit.start, edit.end - edit.start, ...edit.block);
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
};

/**
 * The plan on the mission branch is the ledger. After every transition the state is written
 * into it and committed in the integration worktree, so a person, or a Strike Lead that has
 * lost its context, can read where the mission stands from the file alone. The record under
 * `console-sessions/` keeps only what markdown cannot hold: session ids, worktrees, revisions.
 */
const syncPlan = async (project: Project, mission: Mission, decisions: string[] = []): Promise<string | undefined> => {
  const source = join(project.path, mission.plan);
  let ledger = "";
  try {
    ledger = planOnBranch(project.path, mission.plan, mission.repos);
    // The commit lands wherever git finds a repo above the file, so the check is on the repo
    // and the branch that will take it, not on the path: the integration worktree must exist,
    // be the repo the file is in, and have the mission branch out. Anything else is a commit on
    // somebody's branch (M8), and a missing worktree is not something to mkdir into being.
    const repo = mission.repos.find((r) => ledger.startsWith(`${r.integration}/`));
    if (!repo) throw new Error(`${ledger} is not in an integration worktree`);
    const [top, branch] = await Promise.all([toplevelOf(repo.integration), currentBranch(repo.integration)]);
    if (top !== await toplevelOf(dirname(ledger)).catch(() => top)) throw new Error(`${ledger} is not inside the worktree at ${repo.integration}`);
    if (branch !== repo.branch) throw new Error(`${repo.integration} has ${branch || "a detached HEAD"} checked out, not ${repo.branch}`);
    const current = await readFile(ledger, "utf8").catch(() => readFile(source, "utf8"));
    const was = new Map(parsePlan(current).milestones.flatMap((m) => m.tasks).map((t) => [t.id, t]));
    const d = new Date();
    const stamp = `${today()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const moved = mission.milestones.flatMap((m) => m.tasks).filter((t) => {
      const before = was.get(t.id);
      return !before || before.status !== t.status || before.verdict !== t.verdict;
    }).map((t) => `${stamp} ${t.id} ${t.title}: ${was.get(t.id)?.status ?? "new"} to ${t.status}${t.verdict ? ` (RIO: ${t.verdict})` : ""}`);
    const entries = [...moved, ...decisions.map((d) => `${stamp} ${d}`)];
    if (!entries.length && (await readFile(ledger, "utf8").catch(() => null)) !== null) return undefined;
    await mkdir(dirname(ledger), { recursive: true });
    await writeFile(ledger, applyPlanState(current, mission.milestones, entries), "utf8");
    await commitFile(ledger, `mission ${mission.id}: ${entries[0]?.replace(/^\S+ \S+ /, "") ?? "state"}${entries.length > 1 ? ` (+${entries.length - 1})` : ""}`);
    return undefined;
  } catch (err) {
    const why = `the ledger ${ledger ? `at ${relative(project.path, ledger)} ` : ""}could not be written: ${(err as Error).message.split("\n")[0]}`;
    console.error(`mission ${mission.id}: ${why}`);
    return why;
  }
};

/**
 * The record is written first and the ledger follows it, so what the file says is what landed
 * (M11: a write the record refuses must not already be in the ledger). A ledger that could not
 * be written is noted on the record afterwards, in its own small write, so the page can say it.
 */
const recorded = async (project: Project, mission: Mission, decisions: string[] = []): Promise<Mission> => {
  const why = await syncPlan(project, mission, decisions);
  if (why) await changeMission(project.id, mission.id, (fresh) => { fresh.trouble = [fresh.trouble, why].filter(Boolean).join(" · "); }).catch(() => undefined);
  return mission;
};
const writeThenSync = async (project: Project, mission: Mission, decisions: string[] = []): Promise<void> => {
  await writeMission(mission);
  await recorded(project, mission, decisions);
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

/**
 * The repos a mission gets in this project, branched and checked out the way `approveMission`
 * does it. Only the repos the plan names: a project with eleven repos does not get eleven
 * mission branches because one task touches one of them. Exported so a mission flown from a
 * terminal (`bin/maverick`) uses the app's layout rather than a second one.
 */
export const missionLayout = (choices: Awaited<ReturnType<typeof repoChoices>>, project: Project, cfg: MissionConfig, id: string, named: Set<string>): MissionRepo[] =>
  choices.filter((r) => named.has(r.label)).map((r) => ({
    label: r.label,
    path: r.path,
    base: r.base,
    branch: `${cfg.branchPrefix}${id}`,
    integration: join(project.path, cfg.worktrees, `${id}-integration-${r.label}`),
    land: r.land,
  }));

/** Where one task works: a worktree of its own, on a sibling of the mission branch. */
export const taskLayout = (project: Project, cfg: MissionConfig, missionId: string, task: Pick<MissionTask, "id">, repo: MissionRepo): { worktree: string; branch: string } => ({
  worktree: join(project.path, cfg.worktrees, `${missionId}-${task.id}-${repo.label}`),
  // A sibling of the mission branch, never a child: git cannot hold both `mission/x` and
  // `mission/x/m1-t1`, because the first is a ref file where the second wants a directory.
  branch: `${repo.branch}-${task.id}`,
});

const missionRepo = (mission: Mission, task: MissionTask): MissionRepo => {
  const repo = mission.repos.find((r) => r.label === task.repo);
  if (!repo) throw new Error(`task ${task.id} names repo "${task.repo}", which this mission does not hold`);
  return repo;
};

/** What an interview has to be able to answer, in Cory's words, before anything is planned. The CAG asks the same of one item. */
export const INTERVIEW_PROBES = [
  "  - what is actually being asked for, as against what he first said",
  "  - what done looks like, in a form that can be tested rather than asserted",
  "  - what is deliberately out of scope",
  "  - which constraints are binding (the rulebook, the design contract, the decision log)",
  "  - what already exists that this grows out of, named by file",
  "  - where you disagree with his approach, said plainly before anything is planned",
];

const interviewPrompt = (project: Project, mission: Mission, planPath: string, repos: Array<{ label: string; base: string; land: Landing }>, land: Landing): string => [
  `You are the Strike Lead for a mission in the project at ${project.path}. A strike lead plans the package, briefs it and sends it; it does not fly every jet in it. Your entire job in this session is the interview and the plan.`,
  "",
  mission.from ? `This mission came out of the breakdown of ${join(project.path, mission.from)}, as the item "${mission.brief}". Read that document first; it holds the reasoning.` : `Cory opened this mission with one line: "${mission.brief}"`,
  "",
  "That line is not a specification and you must not treat it as one. Interview him first, in the terminal, one or two questions at a time. Read the repo before you ask, so every question is informed rather than generic: its docs, its rulebook, the code the work would touch, and what already exists that this should build on rather than replace. Probe until you can answer, in his words:",
  ...INTERVIEW_PROBES,
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
export const startMission = async (project: Project, name: string, brief: string, trackerIndex = 0, from?: string): Promise<{ mission: Mission; terminal: TerminalInfo }> => {
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
    ...(from ? { from } : {}),
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
  const terminal = openTerminal(`Strike Lead · ${mission.name}`, ["claude", ...claudeArgs({ prompt: interviewPrompt(project, mission, join(project.path, plan), choices, cfg.land) })], project.path, 120, 36);
  mission.interview = { terminalId: terminal.id, started: new Date().toISOString() };
  await writeMission(mission);
  return { mission, terminal };
};

/** Start the interview again after a server restart took the terminal with it. */
export const reopenInterview = async (project: Project, id: string): Promise<TerminalInfo> => {
  const mission = await missionOr404(project.id, id);
  if (mission.approved) throw new Error(`${mission.name} is already approved; the interview is over`);
  const cfg = await missionConfigFor(project.path);
  const terminal = openTerminal(`Strike Lead · ${mission.name}`, ["claude", ...claudeArgs({ prompt: interviewPrompt(project, mission, join(project.path, mission.plan), await repoChoices(project, cfg), cfg.land) })], project.path, 120, 36);
  mission.interview = { terminalId: terminal.id, started: new Date().toISOString() };
  await writeMission(mission);
  return terminal;
};

/** Read the plan the Strike Lead wrote, without committing to it. This is what the gate shows. */
export const previewPlan = async (project: Project, id: string): Promise<{ found: boolean; text?: string; parsed?: ReturnType<typeof parsePlan>; cost?: Cost; wingmanAgent?: string; repos?: Array<{ label: string; base: string; land: Landing }> }> => {
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
  return { found: true, text, parsed, wingmanAgent: cfg.wingmanAgent, cost: costOf(parsed.milestones), repos: choices.filter((r) => named.has(r.label)).map(({ label, base, land }) => ({ label, base, land })) };
};

/* ---------- the blessing, and the tracker write ---------- */


const headerBlock = (mission: Mission, intro: string): string =>
  itemBlock(`Mission: ${mission.name}`, { created: today(), source: `Strike Lead interview, ${today()}`, kind: "mission", mission: mission.id, plan: mission.plan },
    [intro, ...mission.milestones.map((m) => `Milestone ${m.n} — ${m.title}: done when ${m.done}`)]);

const taskBlock = (mission: Mission, m: Milestone, task: MissionTask): string =>
  itemBlock(task.title, { created: today(), source: `mission ${mission.id}, milestone ${m.n}`, mission: mission.id, milestone: String(m.n), ...(task.repo ? { repo: task.repo } : {}) }, [task.intent]);

/** Write the whole plan into the tracker as items, in one commit, under its own group on the roadmap. */
const writePlanToTracker = async (project: Project, mission: Mission, intro: string): Promise<string> => {
  const tracker = project.trackers[mission.trackerIndex];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${mission.trackerIndex}`);
  const blocks = [headerBlock(mission, intro), ...mission.milestones.flatMap((m) => m.tasks.map((task) => taskBlock(mission, m, task)))];
  const text = placeInGroup(await readFile(tracker.path, "utf8"), PRIORITY, tracker.label, `Mission: ${mission.name}`, blocks);
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
  mission.repos = missionLayout(choices, project, cfg, mission.id, named);
  mission.planCommit = await writePlanToTracker(project, mission, parsed.intro);
  // Before any worktree exists: the worktrees and the scratch folders inside them are ignored
  // locally in every repo the project holds (the worktrees live under the project root, which
  // may be a repo the plan does not name), so nothing on a base branch can sweep them in (M8).
  for (const repo of choices) await excludeLocally(repo.path, [`${cfg.worktrees.replace(/\/+$/, "")}/`, ".scratch/"]);
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

const briefContext = (project: Project, mission: Mission, m: Milestone, task: MissionTask, repo: MissionRepo): BriefContext => ({ projectPath: project.path, mission, milestone: m, task, repo });

const wingmanPrompt = (project: Project, mission: Mission, m: Milestone, task: MissionTask, repo: MissionRepo, findings?: string): string =>
  wingmanBrief(briefContext(project, mission, m, task, repo), findings ? { findings } : undefined);

const reviewPrompt = (project: Project, mission: Mission, m: Milestone, task: MissionTask, repo: MissionRepo, file: string): string =>
  rioBrief(briefContext(project, mission, m, task, repo), file);

/**
 * A review's findings file. Keyed on a counter that only ever goes up, never on `attempts`:
 * a hand-driven retry rewinds that, and a colliding path meant the sweep read the previous
 * RIO's "fail" the moment the new Wingman finished, before the new RIO had written a word.
 */
/**
 * A conflict is the Strike Lead's to answer, because a conflict is a fact about the plan it
 * wrote: two tasks it put in one milestone touched the same lines. It goes into the repo's
 * integration worktree, where the merge is already staged, and either finishes it or says it
 * cannot. It never touches a base branch and it never resolves by discarding a side.
 */
const resolvePrompt = (project: Project, mission: Mission, m: Milestone, repo: MissionRepo, branch: string, paths: string[]): string => [
  `You are the Strike Lead for the mission "${mission.name}" in the project at ${project.path}, and you are cleaning up after your own plan.`,
  "",
  `Milestone ${m.n} — ${m.title} — will not merge. Merging ${branch} into ${repo.branch} in the ${repo.label} repo conflicted on:`,
  ...paths.map((f) => `  - ${f}`),
  "",
  `Work in ${repo.integration}, which is checked out on ${repo.branch}. Re-run the merge yourself (\`git merge --no-ff ${branch}\`), resolve every conflict, and commit it.`,
  "",
  "Both sides are work this mission asked for, so keep both behaviours. Do not resolve by taking one side wholesale, do not `git checkout --ours` or `--theirs` to make it go away, and do not revert either task's commits. If the two genuinely cannot coexist, abort the merge (`git merge --abort`), change nothing, and say so plainly: that is a fact about the plan and Cory needs it, not a guess.",
  "",
  `Do not touch ${repo.base} or any other repo. Do not push. Do not open a pull request. Do not spawn anything.`,
  "",
  "When the merge is committed, or when you have aborted it, stop.",
].join("\n");

/**
 * The walkthrough builder works where the milestone's work has been merged together, so the
 * document describes what a person will actually find on the mission branch. It commits the
 * document there and nothing else.
 */
const walkthroughPrompt = (project: Project, mission: Mission, m: Milestone, repo: MissionRepo, file: string): string => [
  `You are writing the test walkthrough for milestone ${m.n} of the mission "${mission.name}" in the project at ${project.path}.`,
  "",
  `The milestone's work is merged on branch ${repo.branch} of the ${repo.label} repo, checked out at ${repo.integration}. Work there and only there. Read what the milestone changed (\`git -C ${repo.integration} log ${repo.base}..HEAD --stat\`) before you write a word.`,
  "",
  `Milestone ${m.n} — ${m.title}. It is done when: ${m.done}`,
  "",
  "The tasks that went into it:",
  ...m.tasks.map((t) => `  - ${t.title}`),
  "",
  `Run the /ship-test-walkthrough skill for this milestone, treating the milestone as the batch, and write the document to ${file}. If that skill is not available to you, write the same kind of document by hand, and it must keep the contract the console reads: a \`KEY = "..."\` string that names its localStorage key, an \`<h2>\` per pillar, and one \`.tc\` element with a \`data-id\` per test case. A person walks it in the browser and answers every case; those answers are the gate.`,
  "",
  "Cases are what a person does with the real thing and what they should see, not unit tests. Fewer, sharper cases beat a long list.",
  "",
  `Commit the document in ${repo.integration} with a plain lowercase subject. Do not change any other file, do not touch the trackers, do not push, do not open a pull request, do not spawn other agents. When the document is committed, stop.`,
].join("\n");

const walkthroughFile = (mission: Mission, m: Milestone): string => join("deliverables", "testing", `${mission.id}-m${m.n}-walkthrough.html`);

export const walkthroughState = (m: Milestone): WalkthroughState => {
  const w = m.walkthrough;
  if (!w) return "none";
  if (w.waived) return "waived";
  if (w.failed) return "failed";
  if (!w.doc) return "building";
  return w.progress && w.progress.total > 0 && w.progress.answered >= w.progress.total ? "walked" : "walking";
};

/** A milestone that changed nothing has nothing to walk; every other one is walked or waived before the mission lands. */
export const needsWalking = (m: Milestone): boolean =>
  m.tasks.some((t) => t.commits?.length) && !["walked", "waived"].includes(walkthroughState(m));

/** The repo a milestone's walkthrough is built in: the one it landed in, which for one repo is the only one. */
const walkRepo = (mission: Mission, m: Milestone): MissionRepo | undefined => mission.repos.find((r) => m.mergeShas?.[r.label]) ?? mission.repos[0];

/** A builder still out: it was sent and has neither left a document nor been found to have failed. */
const building = (m: Milestone): boolean => Boolean(m.walkthrough?.claudeId && !m.walkthrough.doc && !m.walkthrough.failed);

/** Sent the moment a milestone has merged, into the integration worktree of the repo it landed in. */
const commissionWalkthrough = async (project: Project, mission: Mission, m: Milestone): Promise<void> => {
  if (!m.tasks.some((t) => t.commits?.length)) return;
  const repo = walkRepo(mission, m);
  if (!repo) return;
  const started = new Date().toISOString();
  try {
    const claudeId = await spawnBackgroundAgent(repo.integration, `walkthrough · m${m.n} ${m.title}`, walkthroughPrompt(project, mission, m, repo, walkthroughFile(mission, m)));
    m.walkthrough = { claudeId, started };
    agentCache.delete(project.path);
  } catch (err) {
    m.walkthrough = { started, failed: `could not start the walkthrough builder: ${(err as Error).message}` };
  }
};

/** A builder that has finished either left a document on the branch or it did not. Returns whether anything changed. */
const settleWalkthroughs = async (project: Project, mission: Mission, state: Map<string, string>): Promise<boolean> => {
  let changed = false;
  for (const m of mission.milestones) {
    const w = m.walkthrough;
    if (!building(m) || !isOver(state, w!.claudeId!, w!.started)) continue;
    const repo = walkRepo(mission, m);
    const doc = repo && (await documentsSince(repo.integration, w!.started ?? "")).find((d) => WALKTHROUGH_DOC.test(d));
    if (doc) w!.doc = relative(project.path, join(repo.integration, doc));
    else w!.failed = "the session finished without writing a walkthrough document";
    changed = true;
  }
  return changed;
};

const reviewFile = (mission: Mission, task: MissionTask): string =>
  join(missionsDir(mission.project), `${mission.id}-${task.id}-review${task.reviews ?? 1}.md`);

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
      ({ worktree: task.worktree, branch: task.branch } = taskLayout(project, cfg, mission.id, task, repo));
      await ensureWorktree(repo.path, task.worktree, task.branch, repo.branch);
      task.base = bases.get(repo.label);
      task.claudeId = await spawnBackgroundAgent(task.worktree, `${mission.name} · ${task.title}`, wingmanPrompt(project, mission, m, task, repo), cfg.wingmanAgent);
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
  await writeThenSync(project, mission);
  return mission;
};

/** Put a task back out with the RIO's findings, in the worktree it already has. */
const handBack = async (project: Project, mission: Mission, m: Milestone, task: MissionTask, findings: string): Promise<void> => {
  const previous = task.claudeId;
  const cfg = await missionConfigFor(project.path);
  task.claudeId = await spawnBackgroundAgent(task.worktree!, `${mission.name} · ${task.title} (retry ${task.attempts + 1})`, wingmanPrompt(project, mission, m, task, missionRepo(mission, task), findings), cfg.wingmanAgent);
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
export const agentsFor = async (path: string): Promise<Awaited<ReturnType<typeof backgroundAgents>>> => {
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
  // A mission that has stopped flying (at the review gate, or blocked) may still have a walkthrough being written.
  const missions = (await listMissions(project.id)).filter((m) => m.status === "flying" || m.milestones.some(building));
  if (!missions.length) return;
  const cfg = await missionConfigFor(project.path);
  const agents = new Map((await agentsFor(project.path)).map((a) => [a.id, a]));
  const state = new Map([...agents].map(([id, a]) => [id, a.state ?? ""]));
  for (const mission of missions) {
    const settled = await settleWalkthroughs(project, mission, state);
    if (mission.status !== "flying") {
      if (settled) await writeMission(mission).catch((err) => { if (!(err instanceof StaleMissionError)) throw err; });
      continue;
    }
    const waiting: string[] = [];
    let seated = false;
    mission.trouble = undefined;
    for (const m of mission.milestones) {
      if (!m.dispatched || m.merged) continue;
      for (const task of m.tasks) {
        // Between two expensive steps Cory may have pulled the brake; nothing more is spawned
        // for a mission that is no longer flying, whatever this pass still believes.
        if ((await readMission(mission.project, mission.id))?.status !== "flying") return;
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
          task.head = await revParse(missionRepo(mission, task).path, task.branch!).then((sha) => sha.slice(0, 7)).catch(() => undefined);
          task.strayed = strays(await changedFiles(missionRepo(mission, task).path, missionRepo(mission, task).branch, task.branch!).catch(() => []), task.touches);
        }
        if (task.status === "built") {
          task.reviews = (task.reviews ?? 0) + 1;
          const file = reviewFile(mission, task);
          try {
            // The agent is installed in `~/.claude/agents/` (`rio.md` from this repo, by default); the brief says what to do, the tool list says what it cannot.
            const claudeId = await spawnBackgroundAgent(project.path, `RIO · ${task.title}`, reviewPrompt(project, mission, m, task, missionRepo(mission, task), file), cfg.rioAgent);
            task.review = { claudeId, file, started: new Date().toISOString() };
            task.status = "reviewing";
            agentCache.delete(project.path);
            await patchSession(config.sessionsDir, `bg-${task.claudeId}`, { audit: task.review });
          } catch (err) {
            task.status = "handed-back";
            task.note = `could not start the RIO: ${(err as Error).message}`;
          }
        }
        else if (task.status === "reviewing" && task.review) {
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
      // A Strike Lead sent in to reconcile a collision: wait for it, then look at the branch
      // rather than at what it said about itself. Either the merge is committed or it is not.
      if (m.resolve) {
        if (!isOver(state, m.resolve.claudeId, m.resolve.started)) continue;
        const repo = mission.repos.find((r) => r.label === m.resolve!.repo);
        const settled = repo ? await commitsAhead(repo.path, m.resolve.branch, repo.branch).catch(() => []) : [];
        if (settled.length) {
          // The branch it was merging is now an ancestor of the mission branch: it landed.
          m.mergeShas = { ...(m.mergeShas ?? {}), [m.resolve.repo]: await revParse(repo!.path, repo!.branch).then((sha) => sha.slice(0, 7)).catch(() => "merged") };
          m.conflicts = undefined;
          m.resolve = undefined;
          mission.trouble = undefined;
        } else {
          mission.status = "blocked";
          mission.trouble = `milestone ${m.n} collided in ${m.resolve.repo} and the Strike Lead could not reconcile it: ${(m.resolve.paths ?? []).join(", ")}. Both sides are work the plan asked for, so this is a question about the plan.`;
          m.resolve = undefined;
          await writeThenSync(project, mission, [mission.trouble]).catch(() => undefined);
          return;
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
            const paths = result.conflicts ?? [];
            m.conflicts = paths.map((f) => `${repo.label}/${f}`);
            mission.conflictsSeen = (mission.conflictsSeen ?? 0) + 1;
            // One attempt by the Strike Lead per milestone. A second is not more likely to work
            // and a loop of agents on a collision is exactly what nobody asked for.
            if (!m.resolve) {
              try {
                const claudeId = await spawnBackgroundAgent(repo.integration, `Strike Lead · resolve m${m.n}`, resolvePrompt(project, mission, m, repo, task.branch!, paths));
                m.resolve = { claudeId, repo: repo.label, branch: task.branch!, started: new Date().toISOString(), paths: m.conflicts };
                agentCache.delete(project.path);
                mission.trouble = `milestone ${m.n} collided in ${repo.label}; the Strike Lead is reconciling it`;
              } catch (err) {
                mission.status = "blocked";
                mission.trouble = `milestone ${m.n} will not merge into ${repo.label} and the Strike Lead could not be sent in: ${(err as Error).message}`;
              }
            } else {
              mission.status = "blocked";
              mission.trouble = `milestone ${m.n} still will not merge into ${repo.label} after the Strike Lead tried: ${m.conflicts.join(", ") || "unknown conflict"}`;
            }
            // Three collisions is a plan whose milestones overlap, which is a level up from here.
            if ((mission.conflictsSeen ?? 0) >= 3) {
              mission.escalation = `${mission.conflictsSeen} milestones of this mission have collided. That is the plan putting work that touches the same lines into one milestone, not a merge that needs redoing. The plan is the thing to change.`;
            }
            await writeThenSync(project, mission, [mission.trouble ?? `milestone ${m.n} collided`]).catch(() => undefined);
            return;
          }
          if (result.sha) m.mergeShas[repo.label] = result.sha;
        }
        m.merged = new Date().toISOString();
        await commissionWalkthrough(project, mission, m);
        // A repo with nothing left to do gets its pull request now rather than at the close, so
        // an earlier repo can be reviewed and merged while the later ones are still flying.
        if (mission.repos.some((r) => r.land !== "merge")) {
          const { failed } = await landTheWork(mission);
          if (failed.length) {
            // The next milestone is very often the one that consumes what this one just made:
            // a contract package pushed to its base, a service that reads it. Sending its
            // Wingmen out against a base that never received the push would have them build
            // against the old thing and look correct doing it. It waits for a person instead.
            mission.status = "blocked";
            mission.trouble = `could not land: ${failed.join(" · ")}. The next milestone is held until this does land, in case it depends on it.`;
            await writeThenSync(project, mission, [mission.trouble]).catch(() => undefined);
            return;
          }
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
    // Everything above is idempotent, so losing this write costs one pass, not the work.
    if (waiting.length && mission.status === "flying") mission.trouble = waiting.join(" · ");
    // One formation write per pass rather than one per task that gained a session id.
    if (seated && mission.formation) await updateFormation(mission.formation, { members: memberIds(mission) }).catch(() => undefined);
    // The Strike Lead only reaches Claude Code's session registry once its session has done something,
    // which can be well after the formation was made; keep offering it the lead seat.
    await seatTheLead(mission).catch(() => undefined);
    try {
      await writeThenSync(project, mission);
    } catch (err) {
      if (!(err instanceof StaleMissionError)) throw err;
      console.log(`mission sweep yielded ${mission.id} to a change made while it ran; the next pass picks it up`);
    }
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
  let stopped: string[] = [];
  const mission = await changeMission(project.id, id, async (mission) => {
    // Rebuilt per attempt: a retry against a fresher record must not count a session twice.
    stopped = [];
    for (const task of mission.milestones.flatMap((m) => m.tasks)) {
      const live = task.status === "reviewing" ? task.review?.claudeId : task.status === "flying" ? task.claudeId : undefined;
      if (live) await stop(live).then(() => stopped.push(live)).catch(() => undefined);
      if (task.status === "flying" || task.status === "reviewing" || task.status === "built") {
        task.status = "handed-back";
        task.note = "stopped when the mission was abandoned";
      }
    }
    mission.status = "abandoned";
    mission.finished = mission.finished ?? new Date().toISOString();
    // The branches and their worktrees are deliberately left: whatever was built is still there.
    mission.trouble = `abandoned; ${stopped.length} session(s) stopped. The branches and worktrees are untouched.`;
    return mission;
  });
  await recorded(project, mission, [`abandoned by Cory; ${stopped.length} session(s) stopped`]);
  return { mission, stopped };
};

/**
 * Take back the worktrees the tasks were built in, once their work is merged and landed. The
 * branches stay, so nothing is lost; it is the directories that pile up, three repos deep.
 */
export const tidyWorktrees = async (project: Project, id: string): Promise<string[]> => {
  const mission = await missionOr404(project.id, id);
  // `git worktree remove --force` discards uncommitted changes, which is the only thing in a
  // mission that can destroy work. It runs when the mission is over and not before.
  if (mission.status !== "closed" && mission.status !== "abandoned") {
    throw new Error(`${mission.name} is ${mission.status}; its worktrees are still being worked in`);
  }
  const gone: string[] = [];
  for (const task of mission.milestones.flatMap((m) => m.tasks)) {
    if (!task.worktree || task.status !== "passed") continue;
    const repo = mission.repos.find((r) => r.label === task.repo);
    if (!repo) continue;
    const at = task.worktree;
    await removeWorktree(repo.path, at).then(() => { gone.push(at); task.worktree = undefined; }).catch(() => undefined);
  }
  // The record stops pointing at directories that are no longer there.
  if (gone.length) await writeMission(mission);
  return gone;
};

/**
 * Try the outstanding landings again. A `push` refuses when its base has moved, which is a
 * person's job to reconcile, and until now that left the mission blocked with no way back in.
 * Once the rebase is done, this picks it up from where it stopped.
 */
export const landAgain = async (project: Project, id: string): Promise<{ mission: Mission; landed: string[]; failed: string[] }> => {
  let landed: string[] = [];
  let failed: string[] = [];
  const mission = await changeMission(project.id, id, async (mission) => {
    if (mission.status === "closed" || mission.status === "abandoned") throw new Error(`${mission.name} is ${mission.status}; there is nothing left to land`);
    ({ landed, failed } = await landTheWork(mission));
    if (failed.length) {
      mission.trouble = `still could not land: ${failed.join(" · ")}`;
    } else if (!landed.length) {
      // Nothing landed and nothing failed: every repo either has work still moving or has
      // already landed. Saying "recovered" here would be a lie that puts the mission back in
      // the air on the strength of having done nothing.
      throw new Error(`nothing was waiting to land on ${mission.name}: every repo either still has work in the air or has already landed`);
    } else {
      mission.trouble = undefined;
      // Back in the air: the sweep picks up the milestone that was waiting behind the landing.
      mission.status = mission.milestones.every((x) => x.merged) ? "review" : "flying";
    }
    return mission;
  });
  return { mission, landed, failed };
};

/** Put a blocked task back in the air after Cory has had a look, with one more attempt. */
export const retryTask = async (project: Project, id: string, taskId: string): Promise<Mission> =>
  changeMission(project.id, id, async (mission) => {
    const m = mission.milestones.find((x) => x.tasks.some((t) => t.id === taskId));
    const task = m?.tasks.find((t) => t.id === taskId);
    if (!m || !task) throw new Error(`no task "${taskId}" on ${mission.name}`);
    if (mission.status === "closed" || mission.status === "abandoned") throw new Error(`${mission.name} is ${mission.status}; it cannot be put back in the air`);
    if (!task.worktree) throw new Error(`${task.title} never got a worktree; it cannot be retried`);
    const findings = task.review ? await readFile(task.review.file, "utf8").catch(() => "") : "";
    task.attempts = MAX_ATTEMPTS - 1;
    // Back in the air means what was remembered about the last attempt is no longer the truth.
    forget(task);
    await handBack(project, mission, m, task, findings);
    task.note = undefined;
    mission.status = "flying";
    mission.trouble = undefined;
    return mission;
  }).then((mission) => recorded(project, mission, [`${taskId} sent back out by Cory`]));

/** Accept a task Cory has looked at himself, so a milestone its RIO failed can still merge. */
export const acceptTask = async (project: Project, id: string, taskId: string, note: string): Promise<Mission> =>
  changeMission(project.id, id, async (mission) => {
    const task = mission.milestones.flatMap((m) => m.tasks).find((t) => t.id === taskId);
    if (!task) throw new Error(`no task "${taskId}" on ${mission.name}`);
    if (mission.status === "closed" || mission.status === "abandoned") throw new Error(`${mission.name} is ${mission.status}; accepting a task now would resurrect it`);
    task.status = "passed";
    task.note = `accepted by Cory over the RIO: ${note}`.trim();
    if (task.claudeId) await patchSession(config.sessionsDir, `bg-${task.claudeId}`, { decision: "accepted" });
    mission.status = "flying";
    mission.trouble = undefined;
    return mission;
  }).then((mission) => recorded(project, mission, [`${taskId} accepted by Cory over the RIO: ${note}`.trim()]));

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
const landTheWork = async (mission: Mission): Promise<{ landed: string[]; failed: string[] }> => {
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
    // A repo lands only when nothing of its own is still moving, at the close as much as
    // mid-flight: landing half a repo's work is the same mistake whenever it happens.
    if (!mine.length || mine.some((t) => t.status !== "passed")) continue;
    const tasks = mine;
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
  // The page only offers this at the review gate, but the page is not the guard: a stale tab
  // or a second request must not land half a mission's work or tick a board that is still live.
  if (mission.status !== "review") throw new Error(`${mission.name} is ${mission.status}, not ready to close; only a mission whose every milestone has merged can be closed`);
  // The walkthrough is the gate: a milestone is not done because its RIO said so, it is done
  // because a person went through it. Nothing lands and nothing is ticked before that.
  const unwalked = mission.milestones.filter(needsWalking);
  if (unwalked.length) throw new Error(`not walked yet: ${unwalked.map((m) => `milestone ${m.n} (${walkthroughState(m)})`).join(", ")}. Walk each one on its page, or waive it and say why.`);
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
  const mine = allItems(parseTracker(text))
    .filter((i) => i.fields.mission === mission.id && !i.checked)
    .filter((i) => (whole && i.fields.kind === "mission") || passed.has(`${i.fields.milestone ?? ""}\u0000${i.title}`));
  for (const item of [...mine].sort((a, b) => b.start - a.start)) text = setChecked(text, item.start, item.firstLine, true);
  const ticked = mine.map((i) => i.title);
  if (ticked.length) await writeFile(tracker.path, text, "utf8");
  const commit = ticked.length ? await commitFile(tracker.path, `console: mission "${mission.name}" done (${ticked.length} items)`) : "no change";
  mission.status = "closed";
  mission.finished = mission.finished ?? new Date().toISOString();
  await writeThenSync(project, mission, [`closed by Cory: ${ticked.length} item(s) ticked${pullRequests.length ? `, ${pullRequests.join(", ")}` : ""}`]);
  return { mission, commit, ticked, pullRequests };
};

/** The page saving where the person has got to in a milestone's walkthrough, or waiving it. */
export const recordWalkthrough = async (project: Project, id: string, n: number, patch: WalkthroughPatch): Promise<Mission> =>
  changeMission(project.id, id, (mission) => {
    const m = mission.milestones.find((x) => x.n === n);
    if (!m) throw new Error(`no milestone ${n} in ${mission.name}`);
    if (patch.waive) {
      if (!patch.waive.note.trim()) throw new Error("say why the walkthrough is being waived; it is kept on the milestone");
      m.walkthrough = { ...m.walkthrough, waived: { note: patch.waive.note.trim(), at: new Date().toISOString() } };
    } else if (patch.progress) {
      if (!m.walkthrough?.doc) throw new Error(`milestone ${n} has no walkthrough document to record progress in`);
      m.walkthrough.progress = patch.progress;
    }
    return mission;
  });

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

export const missionView = async (project: Project, id: string): Promise<Mission & { findings: Record<string, string>; diffstat: Record<string, string>; walk: Record<number, WalkView> }> => {
  const mission = await missionOr404(project.id, id);
  const findings: Record<string, string> = {};
  const diffstat: Record<string, string> = {};
  const walk = Object.fromEntries(mission.milestones.map((m) => [m.n, { state: walkthroughState(m), needed: needsWalking(m) }]));
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
  return { ...mission, findings, diffstat, walk };
};
