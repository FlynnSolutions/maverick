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
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { config } from "./config.ts";
import { landFor, missionConfigFor, type Landing, type MissionConfig } from "./project-config.ts";
import { FINISHED, assertCheckedOut, backgroundAgents, changedFiles, claudeArgs, commitFile, commitsAhead, currentBranch, diffStat, ensureBranch, ensureWorktree, excludeLocally, mergeInto, openPullRequest, pushBranch, pushFastForward, removeWorktree, reposUnder, revParse, spawnBackgroundAgent, stopAgent, toplevelOf, underPath, whyFailed, type BackgroundAgent } from "./git.ts";
import { findingsOf, slug, verdictOf, type Verdict } from "./audits.ts";
import type { Project } from "./projects.ts";
import { createFormation, listFormations, updateFormation } from "./formations.ts";
import { patchSession, writeSession, type SessionRecord } from "./sessions.ts";
import { readRegistrySessions } from "./live.ts";
import { parentChain } from "./processes.ts";
import { WALKTHROUGH_DOC, documentsSince } from "./ships.ts";
import { listTerminals, openTerminal, type TerminalInfo } from "./terminal.ts";
import { CHAT_RULES, LEAD_SCHEMA, answersText, flightRules, parseTurn, snapshot, unheard, type ChatEntry } from "./strike-lead.ts";
import { BACKLOG, FIELD_LINE, MARKER, PRIORITY, addItem, allItems, documentHead, itemBlock, parseTracker, placeInGroup, setChecked, today } from "./trackers.ts";
import { DECISION_WORDS, RIO_TOOLS, componentsOver, planOnBranch, rioBrief, screenshotsDir, summaryBrief, wingmanBrief, type BriefContext } from "./briefs.ts";
import { parseRequirements, preflight, refuses, type Check, type Requirement } from "./preflight.ts";
import { reportFor } from "./report.ts";
import { failingCases, lastCleared, needsWalking, openFix, openRound, over, questionsOf, statusWord, walkthroughState, type Question, type StatusWord } from "./questions.ts";
import { feedOf, updatesOf, type FeedEntry } from "./feed.ts";
import { threeBullets } from "./summary.ts";
import { countCarried, keyOf, parseFinding, triage, type Finding } from "./findings.ts";

/** How many times a task is handed back to a fresh Wingman before it becomes Cory's problem. */
export const MAX_ATTEMPTS = 2;

export type MissionStatus = "interviewing" | "planned" | "flying" | "blocked" | "paused" | "review" | "closed" | "abandoned";
/**
 * The statuses the sweep keeps working. `blocked` means a person is needed somewhere, not that
 * everything stops: tasks that do not need the blocked one keep flying and starting, and the
 * milestone that holds it waits. `paused` is a person's call: nothing new is spawned, what is
 * running finishes and is recorded, and the ledger says why. On the first mission a credential
 * expiring ended the mission at milestone 6 and cut the central feature, whose own tasks needed
 * none of it.
 */
const SWEPT: ReadonlySet<MissionStatus> = new Set(["flying", "blocked", "paused"]);
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
  /** The tasks this one builds on, by id, from the plan's `needs:` line. The task starts when every one of them has passed. */
  needs?: string[];
  /** Files the Wingman changed outside `touches`, found when it stopped. The RIO is told; a stray is a finding unless the hand-back justified it. */
  strayed?: string[];
  /** The stacks this task alone deploys, from the plan's `deploys:` line. One deployer per stack per milestone; a shared environment is nobody's. */
  deploys?: string[];
  /** How many RIOs this task has had. Only ever goes up, so their findings never share a path. */
  reviews?: number;
  /** The RIO in this Wingman's back seat: a separate session, never the Wingman, never the lead. */
  review?: { claudeId: string; file: string; started: string };
  verdict?: Verdict;
  /** Why this task stopped needing an agent, in words, when it did not simply pass. */
  note?: string;
  /** The approved mockup cells this task builds, by number, from the plan's `cells:` line. A task with cells is held to them by screenshots and by its RIO. */
  cells?: number[];
  /** NOTE-level findings the task passed with, or merged with when it ran out of retries. They ride to the result page and the report. */
  carried?: string[];
  /** What Cory did with each finding, by its key (`keyOf`): read it, or put it on the checklist for later. */
  readings?: Record<string, "read" | "later">;
}

/** Progress through the hosted walkthrough document, saved from the page as it is worked. */
export interface WalkthroughProgress {
  total: number;
  answered: number;
  /** Case id -> what the person said. The gate counts answers; the verdicts are the person's record of what they found. */
  verdicts: Record<string, string>;
  /** Case id -> what the person wrote beside the verdict: kept with the verdicts so a note survives another browser, and what a fix task is told about a failed case. */
  notes?: Record<string, string>;
  /** Sent by the page, not kept to: the last fix round it has dropped the cleared answers for. A save that has not seen the latest round has those cases' answers stripped. */
  round?: number;
  updatedAt: string;
}

/**
 * One round of fixing what a walk found (M29): every case the walk failed, handed to one task.
 * `cleared` is set once that task has merged and been proved, when the failed cases' answers are
 * taken off so a person walks those cases again, and only those.
 */
export interface WalkFix {
  round: number;
  task: string;
  cases: string[];
  filed: string;
  cleared?: string;
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
  /** Each round of fixing what the walk failed, oldest first. */
  fixes?: WalkFix[];
}

export type WalkthroughState = "none" | "building" | "failed" | "walking" | "fixing" | "walked" | "waived";

/** What the page is told about a milestone's walkthrough, derived here so the page and the gate cannot disagree. */
export interface WalkView { state: WalkthroughState; needed: boolean }

export interface WalkthroughPatch { progress?: WalkthroughProgress; waive?: { note: string } }

/** What holds a milestone for a person: a collision nobody could reconcile, a landing that failed, a proof that failed on the merged tree. */
export type HoldKind = "collision" | "landing" | "proof";
export interface Hold { kind: HoldKind; reason: string; at: string }

/**
 * What a mockup element is built with, decided by Cory per component before the plan is
 * written, never by a blanket "reuse what exists": reuse the existing component as it is,
 * restyle the shared one everywhere, or build a new one for this feature.
 */
export type ComponentDecision = "reuse" | "restyle" | "new";
export interface Component {
  name: string;
  owner: string;
  decision: ComponentDecision;
  cells: number[];
  note: string;
}

/** A thing one task makes and another uses: a type, an id, a codec, an env flag, a function. Named before fan-out, with its owner and its shape. */
export interface Contract {
  name: string;
  /** The task that writes it; everyone else reads it from that task's branch, or stubs it in a file of their own. */
  owner: string;
  shape: string;
}

export interface Milestone {
  n: number;
  title: string;
  /** One testable line: what "done" means for this milestone. */
  done: string;
  /** The cases Cory walks at the milestone's end, from its `_walk:_` line. Absent on records from before the line existed. */
  walk?: string[];
  tasks: MissionTask[];
  dispatched?: string;
  merged?: string;
  walkthrough?: MilestoneWalkthrough;
  /** The merge commit per repo, since a milestone can land work in more than one. */
  mergeShas?: Record<string, string>;
  conflicts?: string[];
  /** Why this milestone waits for a person, and since when. Kept until they act, so the reason survives the pass; the kind says what release means. */
  hold?: Hold;
  /** The one Strike Lead attempt a collision gets has been spent. */
  resolveTried?: boolean;
  /** The project's proof command, run in the integration worktree after this milestone merged. */
  proof?: { ok: boolean; at: string; output: string };
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
  /** Where an interview ran in an embedded terminal, before the Strike Lead was a chat. Kept so older records still read. */
  interview?: { terminalId: string; started: string };
  /** The Strike Lead's own Claude session, resumed for every turn of the chat. */
  lead?: { sessionId: string; started: string };
  /** The conversation with the Strike Lead, oldest first: the interview, then the flight. */
  chat?: ChatEntry[];
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
  /** What the tasks share, from the plan's `## Contracts` section, frozen at approval. */
  contracts?: Contract[];
  /** Every element the mockups draw and what it is built with, from the plan's `## Components` section, frozen at approval. */
  components?: Component[];
  /** Where the approved mockups live, relative to the project, from the `mockups:` line of `## Components`. */
  mockups?: string;
  /** What the mission needs of the host and the person, from the plan's `## Preflight` section. */
  requirements?: Requirement[];
  /** The project sets a proof command, so a merged milestone is not done until its proof passed. Frozen at approval. */
  proofRequired?: boolean;
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
  /** Why a person paused the mission; the pause's own line, apart from whatever else is open. */
  pausedFor?: string;
  /** The three bullets Cory must read, asked of a read-only session: running while `started` has neither `at` nor `failed`. `raw` is what the session wrote, before it was held to three. */
  summary?: { started?: string; claudeId?: string; at?: string; text?: string; raw?: string; failed?: string };
}

/* ---------- storage ---------- */

const missionsDir = (projectId: string): string => join(config.sessionsDir, "missions", projectId);
export const missionPath = (projectId: string, id: string): string => join(missionsDir(projectId), `${id}.json`);

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
_walk: <a case Cory will walk at the end>; <the next case>; <...>_

- [ ] **<task title>**
  - repo: <which repo this works in; omit it only when the project has one>
  - touches: <the files and directories this task owns, relative to its repo, comma separated>
  - needs: <the ids of tasks this one builds on (m1-t2), if any>
  - deploys: <a stack this task alone deploys, if any; never a shared environment, which only the merged mission branch deploys>
  - cells: <the approved mockup cells this task builds, by number (12, 14, 20-23), if any>
  <Everything a session with no other context needs to build this: the files, the shape, what
  it must not touch, and how it proves itself. Several lines is right; one line is not.>
  <Once the mission flies, Maverick writes status, attempt, verdict and commit lines under each
  task and keeps a "## Log" section at the end: the plan on the mission branch is the ledger.>

- [ ] **<the next task in this milestone>**
  - repo: <...>
  <...>

## Milestone 2 — <short title>

_done when: <one testable line>_
_walk: <case>; <case>_

- [ ] **<task title>**
  <...>

## Contracts

- **<a type, an id, a codec, an env flag, a function one task makes and another uses>** (owner: m1-t1): <its signature or shape, one line>
- **<the next one>** (owner: <task id>): <...>

## Components

- mockups: <where the approved mockups are, relative to the project; omit the section when the mission draws no UI>
- **<an element the mockups draw>** (owner: m1-t2): <reuse | restyle | new>; cells <12, 14>; <one line: which existing component it is or replaces, and what differs>
- **<the next element>** (owner: <task id>): <...>

## Preflight

- duration: <how long the mission is expected to run, like 8h>
- tool: <a binary every task will shell out to, like docker>
- runtime: <a runtime a repo pins, like node, checked against the host>
- credential: <aws, or the name of a sign-in>, <what it is for>
- secret: <the name of a secret the plan reads>, <where>
- human: <a step only a person can do: an inbox, a passkey, a real sign-in>, <what the plan does instead>`;

const MILESTONE_HEADING = /^Milestone\s+(\d+)\s*[—–:-]\s*(.+)$/;
const DONE_LINE = /^_*\s*done when:\s*(.+?)\s*_*$/i;
const WALK_LINE = /^_*\s*walk:\s*(.+?)\s*_*$/i;
/** The section at the end of a flying plan where every transition and decision is appended. */
const LOG_HEADING = /^Log$/i;
/** The section where what tasks share is named before any of them starts. */
const CONTRACTS_HEADING = /^Contracts$/i;
/** The section where the Strike Lead says what the mission needs of the host and of the person. */
const PREFLIGHT_HEADING = /^Preflight$/i;
const COMPONENTS_HEADING = /^Components$/i;
const MOCKUPS_LINE = /^mockups:\s*`?([^`]+?)`?\s*$/i;
/** What follows a component's `(owner: <task>):`, the same prefix a contract has. */
const COMPONENT_TAIL = /^(reuse|restyle|new)\s*;\s*cells?\s+([\d\s,–-]+?)\s*(?:;\s*(.*))?$/i;
/** Wider than any mockup round; a range past it is a typo, not a page of cells. */
const MAX_CELL_SPAN = 500;

/** `12, 14, 20-23` as the cells it names. */
const cellsOf = (value: string): number[] => [...new Set(listField(value, /[,\s]+/).flatMap((part) => {
  const [from, to] = part.split(/[–-]/).map(Number);
  return to >= from && to - from <= MAX_CELL_SPAN ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : [from];
}).filter((n) => Number.isInteger(n) && n > 0))];
const CONTRACT_LINE = /^(?:\*\*([^*]+)\*\*|`([^`]+)`|([^*`(]+?))\s*\(owner:\s*([a-z0-9-]+)\)\s*:?\s*(.*)$/i;
const TASK_STATUSES: readonly string[] = ["pending", "flying", "built", "reviewing", "passed", "handed-back"];
const VERDICTS: readonly string[] = ["pass", "pass with notes", "fail", "mixed"];
/** The fields Maverick writes under a task as it flies. A Strike Lead leaves them off; the ledger owns them. */
const STATE_FIELDS: readonly string[] = ["status", "attempt", "verdict", "commit"];

/** `touches` is comma separated (a path may hold a space); `needs` is ids, so any separator. Duplicates dropped. */
const listField = (value: string | undefined, by: RegExp): string[] => [...new Set((value ?? "").split(by).map((v) => v.trim().replace(/^\.\//, "").replace(/\/+$/, "")).filter(Boolean))];

/** A path a task may own: relative, plain, inside the repo. Anything a diff cannot be checked against is refused. */
const PATH_RULES: Array<[test: (p: string) => boolean, why: string]> = [
  [(p) => p.startsWith("/") || p.startsWith("~"), "is absolute"],
  [(p) => /[*?[\]{}]/.test(p), "is a glob"],
  [(p) => p.includes("\\"), "uses backslashes"],
  [(p) => p.split("/").some((seg) => seg === "." || seg === ".."), "steps through . or .."],
  // Two paths with a space between them and no comma: a list written the wrong way, not one file with a space in it.
  [(p) => p.split(/\s+/).filter((part) => part.includes("/")).length > 1, "looks like several paths; separate them with commas"],
];
const badPath = (p: string): string | undefined => PATH_RULES.find(([bad]) => bad(p))?.[1];

/** Whether two owned paths are the same file, or one is inside the other. */
const pathsOverlap = (a: string, b: string): boolean => underPath(a, b) || underPath(b, a);

/** Files a Wingman changed that none of its `touches` cover. Empty when the task owns nothing in particular. */
export const strays = (files: string[], touches: string[] | undefined): string[] =>
  touches?.length ? files.filter((f) => !touches.some((t) => underPath(f, t))) : [];

/**
 * `needs` names tasks that exist, are not the task itself, are not in a later milestone (it
 * would never be there in time), and do not lead back round to it. The loop check is one
 * depth-first pass over the edges, reporting each back edge once, so a dense plan costs
 * milliseconds rather than one walk per path.
 */
const needProblems = (milestones: Milestone[]): string[] => {
  const problems: string[] = [];
  const where = new Map(milestones.flatMap((m) => m.tasks.map((t) => [t.id, { m: m.n, t }] as const)));
  for (const m of milestones) for (const t of m.tasks) for (const need of t.needs ?? []) {
    const target = where.get(need);
    if (!target) problems.push(`"${t.title}" in milestone ${m.n} needs "${need}", which is not a task in this plan`);
    else if (need === t.id) problems.push(`"${t.title}" in milestone ${m.n} needs itself`);
    else if (target.m > m.n) problems.push(`"${t.title}" in milestone ${m.n} needs ${need}, which flies later, in milestone ${target.m}`);
  }
  const colour = new Map<string, "in" | "done">();
  const stack: string[] = [];
  const walk = (id: string): void => {
    colour.set(id, "in");
    stack.push(id);
    for (const next of where.get(id)?.t.needs ?? []) {
      if (next === id || !where.has(next)) continue;
      const seen = colour.get(next);
      if (seen === "in") problems.push(`${[...stack.slice(stack.indexOf(next)), next].join(" needs ")}: a loop, so none of them could ever start`);
      else if (!seen) walk(next);
    }
    stack.pop();
    colour.set(id, "done");
  };
  for (const id of where.keys()) if (!colour.has(id)) walk(id);
  return problems;
};

/**
 * Paths that are not product code: a task touching only these changes nothing a person uses.
 * Documents only at a repo's root (a `src/pages/docs/` is product); test code at any depth, by
 * its folder or by its file name, since a repo puts its tests wherever its framework does.
 */
const NOT_PRODUCT_ROOTS = ["deliverables", "docs"];
const TEST_DIRS = new Set(["test", "tests", "__tests__", "e2e", "cypress", "playwright"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const isProduct = (path: string): boolean =>
  !NOT_PRODUCT_ROOTS.some((dir) => underPath(path, dir)) && !path.split("/").some((part) => TEST_DIRS.has(part)) && !TEST_FILE.test(path);

/**
 * A milestone is a foundation, not a layer (M28). A milestone whose tasks all work in one repo,
 * in a plan where another works in a different one, was cut by repo; a milestone none of whose
 * tasks touches product code is a walkthrough, which is never a milestone. Judged from
 * `touches`: a task that says nothing about what it owns is not called a walkthrough.
 */
const shapeProblems = (milestones: Milestone[]): string[] => {
  const reposOf = (m: Milestone): Set<string> => new Set(m.tasks.map((t) => t.repo).filter(Boolean));
  const all = new Set(milestones.flatMap((m) => [...reposOf(m)]));
  return milestones.flatMap((m) => {
    const mine = reposOf(m);
    const problems: string[] = [];
    if (mine.size === 1 && all.size > 1) problems.push(`milestone ${m.n} works only in ${[...mine][0]} while another milestone works in ${[...all].filter((r) => !mine.has(r)).join(", ")}: a milestone is a foundation, cut by what builds on what, never by repo or layer`);
    if (m.tasks.length && m.tasks.every((t) => t.touches?.length && !t.touches.some(isProduct))) problems.push(`milestone ${m.n} changes no product code (its tasks touch only documents and test code): the walkthrough is never a milestone; it is how every milestone ends`);
    return problems;
  });
};

/** The longest run of tasks inside one milestone that each need the one before, by id. A loop (already a problem) stops the walk rather than spinning it. */
export const longestChain = (m: Pick<Milestone, "tasks">): string[] => {
  const byId = new Map(m.tasks.map((t) => [t.id, t]));
  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();
  const longest = (chains: string[][]): string[] => chains.reduce((a, b) => (b.length > a.length ? b : a), []);
  const from = (id: string): string[] => {
    const known = memo.get(id);
    if (known) return known;
    visiting.add(id);
    const best = [...longest((byId.get(id)?.needs ?? []).filter((x) => byId.has(x) && !visiting.has(x)).map(from)), id];
    visiting.delete(id);
    memo.set(id, best);
    return best;
  };
  return longest(m.tasks.map((t) => from(t.id)));
};

/** Tasks in one milestone whose `touches` overlap: they fly in parallel, so this is a collision planned in. */
export const overlapsIn = (milestones: Milestone[]): string[] =>
  milestones.flatMap((m) => m.tasks.flatMap((a, i) => m.tasks.slice(i + 1).flatMap((b) => {
    const shared = (a.touches ?? []).filter((x) => (b.touches ?? []).some((y) => pathsOverlap(x, y)));
    return shared.length ? [`milestone ${m.n}: ${a.id} and ${b.id} both touch ${shared.join(", ")}`] : [];
  })));

/** Parse the Strike Lead's plan document. Reuses the tracker parser, because the plan is written in its shape. */
export const parsePlan = (text: string, repos: string[] = [], shared: string[] = []): { name: string; intro: string; milestones: Milestone[]; contracts: Contract[]; components: Component[]; mockups?: string; requirements: Requirement[]; log: string[]; problems: string[]; overlaps: string[]; warnings: string[] } => {
  const lines = text.split("\n");
  const { title: name, intro } = documentHead(text, /^#\s*Mission:\s*(.+)$/m);
  const problems: string[] = [];
  if (!name) problems.push('the document has no "# Mission: <name>" heading');

  const milestones: Milestone[] = [];
  const contracts: Contract[] = [];
  const components: Component[] = [];
  let mockups: string | undefined;
  let requirements: Requirement[] = [];
  let log: string[] = [];
  const bulletsOf = (section: { start: number; end: number }): string[] => lines.slice(section.start + 1, section.end).filter((l) => /^[-*] /.test(l)).map((l) => l.slice(2).trim());
  for (const section of parseTracker(text).sections) {
    if (PREFLIGHT_HEADING.test(section.heading)) {
      const parsed = parseRequirements(bulletsOf(section));
      requirements = parsed.requirements;
      problems.push(...parsed.problems);
      continue;
    }
    if (LOG_HEADING.test(section.heading)) {
      log = bulletsOf(section);
      continue;
    }
    if (CONTRACTS_HEADING.test(section.heading)) {
      for (const line of bulletsOf(section)) {
        const m = line.match(CONTRACT_LINE);
        if (m) contracts.push({ name: (m[1] ?? m[2] ?? m[3]).trim(), owner: m[4].toLowerCase(), shape: m[5].trim() });
        else problems.push(`contract "${line.slice(0, 60)}" is not "**name** (owner: <task id>): <shape>"`);
      }
      continue;
    }
    if (COMPONENTS_HEADING.test(section.heading)) {
      for (const line of bulletsOf(section)) {
        const at = line.match(MOCKUPS_LINE);
        if (at) {
          mockups = at[1].trim();
          continue;
        }
        const named = line.match(CONTRACT_LINE);
        const c = named?.[5].match(COMPONENT_TAIL);
        if (named && c) components.push({ name: (named[1] ?? named[2] ?? named[3]).trim(), owner: named[4].toLowerCase(), decision: c[1].toLowerCase() as ComponentDecision, cells: cellsOf(c[2]), note: (c[3] ?? "").trim() });
        else problems.push(`component "${line.slice(0, 60)}" is not "**name** (owner: <task id>): reuse | restyle | new; cells <n, n>; <one line>"`);
      }
      continue;
    }
    const m = section.heading.match(MILESTONE_HEADING);
    if (!m) {
      problems.push(`"## ${section.heading}" is not a milestone heading ("## Milestone 1 — title")`);
      continue;
    }
    const n = Number(m[1]);
    const body = lines.slice(section.start + 1, section.end).map((l) => l.trim());
    const lineOf = (re: RegExp): string => (body.find((l) => re.test(l))?.match(re)?.[1] ?? "").trim().replace(/\.$/, "");
    const done = lineOf(DONE_LINE);
    if (!done) problems.push(`milestone ${n} has no "_done when: ..._" line`);
    const walk = listField(lineOf(WALK_LINE), /;/);
    if (!walk.length) problems.push(`milestone ${n} has no "_walk: <case>; <case>_" line: the cases walked at its end`);
    const only = repos.length === 1 ? repos[0] : "";
    const tasks = section.groups.flatMap((g) => g.items).map((item, i) => {
      const { status, attempt, verdict, commit, touches, needs, deploys, repo, cells } = item.fields;
      const okStatus = !status || TASK_STATUSES.includes(status);
      const okAttempt = !attempt || /^\d+$/.test(attempt);
      const okVerdict = !verdict || VERDICTS.includes(verdict);
      if (!okStatus) problems.push(`"${item.title}" in milestone ${n} has status "${status}", which is not one of: ${TASK_STATUSES.join(", ")}`);
      if (!okAttempt) problems.push(`"${item.title}" in milestone ${n} has attempt "${attempt}", which is not a count`);
      if (!okVerdict) problems.push(`"${item.title}" in milestone ${n} has verdict "${verdict}", which is not one of: ${VERDICTS.join(", ")}`);
      const cellList = cells ? cellsOf(cells) : [];
      return {
        id: `m${n}-t${i + 1}`,
        title: item.title,
        intent: item.description.trim(),
        repo: repo?.trim() || only,
        status: (okStatus && status ? status : "pending") as TaskStatus,
        attempts: okAttempt && attempt ? Number(attempt) : 0,
        ...(okVerdict && verdict ? { verdict: verdict as Verdict } : {}),
        ...(commit ? { head: commit } : {}),
        ...(touches ? { touches: listField(touches, /,/) } : {}),
        ...(needs ? { needs: listField(needs, /[,\s]+/) } : {}),
        ...(deploys ? { deploys: listField(deploys.replace(/[`*]/g, ""), /[,;]/) } : {}),
        ...(cellList.length ? { cells: cellList } : {}),
      };
    });
    // One deployer per stack per milestone: two tasks flying together deploying one stack raced on the first mission.
    const deployers = new Map<string, string[]>();
    for (const t of tasks) for (const stack of t.deploys ?? []) deployers.set(stack.toLowerCase(), [...(deployers.get(stack.toLowerCase()) ?? []), t.id]);
    for (const [stack, ids] of deployers) if (ids.length > 1) problems.push(`milestone ${n}: ${ids.join(" and ")} both deploy ${stack}; one deployer per stack per milestone`);
    for (const t of tasks) for (const p of t.touches ?? []) {
      const why = badPath(p);
      if (why) problems.push(`"${t.title}" in milestone ${n} touches "${p}", which ${why}`);
    }
    if (!tasks.length) problems.push(`milestone ${n} has no tasks`);
    for (const t of tasks) if (!t.intent) problems.push(`"${t.title}" in milestone ${n} says only its title; a Wingman gets no other context`);
    // Which repo a task works in is only guessable when the project has exactly one.
    for (const t of tasks) {
      if (!t.repo) problems.push(`"${t.title}" in milestone ${n} names no repo; this project has ${repos.length}, so every task needs "- repo: <name>"`);
      else if (repos.length && !repos.includes(t.repo)) problems.push(`"${t.title}" in milestone ${n} names repo "${t.repo}", which is not one of: ${repos.join(", ")}`);
    }
    milestones.push({ n, title: m[2].trim(), done, walk, tasks });
  }
  if (!milestones.length) problems.push("the document has no milestones");
  milestones.sort((a, b) => a.n - b.n);
  problems.push(...needProblems(milestones), ...shapeProblems(milestones));
  const ids = new Set(milestones.flatMap((m) => m.tasks.map((t) => t.id)));
  // A shared environment is deployed by the merged mission branch and by nothing that flies in parallel.
  const sharedLower = shared.map((s) => s.toLowerCase());
  for (const m of milestones) for (const t of m.tasks) for (const stack of t.deploys ?? []) if (sharedLower.includes(stack.toLowerCase())) problems.push(`"${t.title}" in milestone ${m.n} deploys ${stack}, which this project lists as shared; only the merged mission branch deploys there`);
  // The same thing written in two markdown styles is the same thing, and the check exists to catch two owners for it.
  const plain = (name: string): string => name.replace(/[`*]/g, "").trim().toLowerCase();
  const owned = (kind: string, all: Array<{ name: string; owner: string }>) => all.forEach((c, i) => {
    if (!ids.has(c.owner)) problems.push(`${kind} "${c.name}" is owned by ${c.owner}, which is not a task in this plan`);
    if (all.findIndex((x) => plain(x.name) === plain(c.name)) !== i) problems.push(`${kind} "${c.name}" is named twice`);
  });
  owned("contract", contracts);
  for (const c of contracts) if (!c.shape) problems.push(`contract "${c.name}" has no shape: say what it looks like, in one line`);
  // The reuse-or-new call is made per component, by Cory, in the plan: a task that builds cells nobody decided
  // is the item-files redesign, where approved mockups were built with the old components.
  const decided = new Set(components.flatMap((c) => c.cells));
  let anyCells = false;
  for (const m of milestones) for (const t of m.tasks) {
    anyCells ||= Boolean(t.cells?.length);
    const open = (t.cells ?? []).filter((c) => !decided.has(c));
    if (open.length) problems.push(`"${t.title}" in milestone ${m.n} builds ${open.length === 1 ? "cell" : "cells"} ${open.join(", ")}, which no "## Components" entry decides: say per element whether it reuses, restyles or replaces an existing component`);
  }
  if (anyCells && !mockups) problems.push(`tasks build mockup cells and "## Components" has no "mockups: <path>" line saying where they are`);
  owned("component", components);
  for (const c of components) if (!c.cells.length) problems.push(`component "${c.name}" names no cells: say which mockup cells draw it`);
  // Not a refusal: a plan whose tasks build on each other and names nothing they share is the
  // plan the first mission had, where parallel Wingmen invented the shared conventions apart.
  const warnings: string[] = [];
  const dependent = milestones.flatMap((m) => m.tasks).filter((t) => t.needs?.length);
  if (dependent.length && !contracts.length) warnings.push(`${dependent.length} ${dependent.length === 1 ? "task builds" : "tasks build"} on others and the plan names no contracts: what they share (types, ids, codecs, env flags, functions) has no owner or shape yet`);
  for (const m of milestones) {
    const chain = longestChain(m);
    if (m.tasks.length >= 4 && chain.length > m.tasks.length / 2) warnings.push(`milestone ${m.n} is mostly one chain: ${chain.join(", ")} run one after another, so at most ${m.tasks.length - chain.length + 1} of its ${m.tasks.length} tasks can fly at once`);
  }
  return { name, intro, milestones, contracts, components, mockups, requirements, log, problems, overlaps: overlapsIn(milestones), warnings };
};

/** The preflight for a plan in this project: what a machine can check, and what is a person's. */
export const preflightFor = (project: Project, cfg: MissionConfig, choices: Array<{ label: string; path: string; land: Landing }>, parsed: ReturnType<typeof parsePlan>): Promise<Check[]> => {
  const named = new Set(parsed.milestones.flatMap((m) => m.tasks.map((t) => t.repo)));
  const mine = choices.filter((r) => named.has(r.label));
  return preflight({ projectPath: project.path, repoPaths: mine.map((r) => r.path), requirements: parsed.requirements, wingmanAgent: cfg.wingmanAgent, rioAgent: cfg.rioAgent, remote: mine.filter((r) => r.land !== "merge").map(({ label, path }) => ({ label, path })) });
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
      const at = kept.findLastIndex((l) => FIELD_LINE.test(l)) + 1;
      const marker = task.status === "passed" ? "x" : task.status === "pending" ? " " : "~";
      const bullet = lines[item.start].replace(MARKER, `- [${marker}]`);
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
 * What a pass carried, as the ledger counts it: ` with N notes carried`, then `, M unverified`
 * when any line is an unverified claim. The lines themselves stay on `task.carried` and in the
 * findings file, where the report and the Result read them; the ledger says only how many.
 */
const carriedCounts = (carried: string[]): string => {
  const { notes, unverified } = countCarried(carried);
  return ` with ${notes} notes carried${unverified ? `, ${unverified} unverified` : ""}`;
};

/**
 * The log lines for what changed between the ledger's last state and the mission's. A line
 * says what it is after its stamp: `auto:` for a transition the merge-with-notes rule settled
 * without a person, `held:` for a milestone held for one, `decision:` (written by `recorded`)
 * for what a person did, and nothing for a plain pass or retry. The report reads those words,
 * not the prose after them. A pass with notes says how many right after its verdict.
 */
/** A ledger stamp: local date and time to the minute, as every line of the log carries. */
const stampOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const transitions = (before: ReturnType<typeof parsePlan>, mission: Mission, stamp: string): string[] => {
  const was = new Map(before.milestones.flatMap((m) => m.tasks).map((t) => [t.id, t]));
  const heldLogged = new Set(before.log.filter((l) => /^\S+ \S+ held: /.test(l)).map((l) => l.match(/\(since ([^)]+)\)/)?.[1]));
  // Once per milestone, stamped when it merged rather than when the line was written: a merge is
  // the moment a person most wants to hear about, and it used to leave no line.
  const mergedLogged = new Set(before.log.map((l) => l.match(/^\S+ \S+ merged: milestone (\d+)\b/)?.[1]).filter(Boolean).map(Number));
  return [
    ...mission.milestones.flatMap((m) => m.tasks).filter((t) => {
      const prior = was.get(t.id);
      return !prior || prior.status !== t.status || prior.verdict !== t.verdict;
    }).map((t) => `${stamp} ${t.status === "passed" && t.note?.startsWith("the RIO said") ? "auto: " : ""}${t.id} ${t.title}: ${was.get(t.id)?.status ?? "new"} to ${t.status}${t.verdict ? ` (RIO: ${t.verdict})` : ""}${t.carried?.length ? carriedCounts(t.carried) : ""}${t.note ? `: ${t.note}` : ""}`),
    ...mission.milestones.filter((m) => m.hold && !heldLogged.has(m.hold.at)).map((m) => `${stamp} held: milestone ${m.n} (since ${m.hold!.at}): ${m.hold!.reason}`),
    ...mission.milestones.filter((m) => m.merged && !mergedLogged.has(m.n)).map((m) => `${stampOf(new Date(m.merged!))} merged: milestone ${m.n} (${m.title}) is on the mission branch`),
  ];
};

/**
 * The checkout the ledger may be committed in, or an error. The commit lands wherever git
 * finds a repo above the file, so the check is on the repo and the branch that will take it,
 * not on the path: the integration worktree must exist, be the checkout the file is in, and
 * have the mission branch out. Anything else is a commit on somebody's branch (M8), and a
 * missing worktree is not something to mkdir into being.
 */
const ledgerRepoFor = async (mission: Mission, ledger: string): Promise<MissionRepo> => {
  const repo = mission.repos.find((r) => underPath(ledger, r.integration));
  if (!repo) throw new Error(`${ledger} is not in an integration worktree`);
  const top = await assertCheckedOut(repo.integration, repo.branch);
  if (top !== await toplevelOf(dirname(ledger)).catch(() => top)) throw new Error(`${ledger} is not inside the worktree at ${repo.integration}`);
  return repo;
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
    // Read and diff first: a pass that changed nothing costs one read and no git.
    const existing = await readFile(ledger, "utf8").catch(() => null);
    const current = existing ?? await readFile(source, "utf8");
    const before = parsePlan(current);
    const stamp = stampOf(new Date());
    const entries = [...transitions(before, mission, stamp), ...decisions.map((x) => `${stamp} decision: ${x}`)];
    if (!entries.length && existing !== null) return undefined;
    await ledgerRepoFor(mission, ledger);
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

const noteTrouble = (project: Project, id: string, why: string) =>
  changeMission(project.id, id, (fresh) => { fresh.trouble = [fresh.trouble, why].filter(Boolean).join(" · "); }).catch(() => undefined);

/**
 * The record is written first and the ledger follows it, so what the file says is what landed
 * (M11: a write the record refuses must not already be in the ledger). A ledger that could not
 * be written is noted on the record afterwards, in its own small write, so the page can say it.
 */
const recorded = async (project: Project, mission: Mission, decisions: string[] = []): Promise<Mission> => {
  const why = await syncPlan(project, mission, decisions);
  if (why) await noteTrouble(project, mission.id, why);
  return mission;
};
const writeThenSync = async (project: Project, mission: Mission, decisions: string[] = []): Promise<Mission> => {
  await writeMission(mission);
  return recorded(project, mission, decisions);
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

/** What a task has taken, measured from past missions: build plus review per task, and how often a task went out twice. */
export interface Pace { minutesPerTask: number; retryRate: number; tasks: number }

/** The fixed figure the estimate falls back on with no history: minutes per link of a `needs` chain. */
export const DEFAULT_LINK_MINUTES = 15;

/**
 * Measured from the mission records under `config.sessionsDir/missions/`: every passed task's
 * last attempt, its Wingman from `started` to `ended` and its RIO from `review.started` to when
 * the RIO's findings file was last written. The retry rate is the share of those tasks that
 * took more than one attempt. Null with nothing measured. The gate polls and the answer moves only
 * when a task passes, so a reading is kept for a few minutes per records folder.
 */
const PACE_TTL_MS = 5 * 60_000;
const paceRead = new Map<string, { at: number; pace: Promise<Pace | null> }>();
export const measuredPace = (maxAgeMs = PACE_TTL_MS): Promise<Pace | null> => {
  const hit = paceRead.get(config.sessionsDir);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.pace;
  const pace = readPace();
  paceRead.set(config.sessionsDir, { at: Date.now(), pace });
  return pace;
};
const readPace = async (): Promise<Pace | null> => {
  const projects = await readdir(join(config.sessionsDir, "missions"), { withFileTypes: true }).catch(() => []);
  const missions = (await Promise.all(projects.filter((d) => d.isDirectory()).map((d) => listMissions(d.name)))).flat();
  const done = missions.flatMap((m) => m.milestones.flatMap((x) => x.tasks)).filter((t) => t.status === "passed" && t.started && t.ended && t.review?.started);
  const took = (await Promise.all(done.map(async (t) => {
    const reviewed = await stat(t.review!.file).then((s) => s.mtimeMs, () => null);
    const ms = reviewed === null ? 0 : Date.parse(t.ended!) - Date.parse(t.started!) + reviewed - Date.parse(t.review!.started);
    return ms > 0 ? [{ minutes: ms / 60_000, retried: t.attempts > 1 }] : [];
  }))).flat();
  if (!took.length) return null;
  return { minutesPerTask: took.reduce((n, x) => n + x.minutes, 0) / took.length, retryRate: took.filter((x) => x.retried).length / took.length, tasks: took.length };
};

/** Minutes to the nearest 5, never under 5: an estimate, not a stopwatch. */
const roughly = (minutes: number): number => Math.max(5, Math.round(minutes / 5) * 5);

export interface Estimate {
  milestones: Array<{ n: number; title: string; walk: string[]; buildsOn: number[]; chain: string[]; minutes: number }>;
  /** Every milestone one after another, since each waits on the walk of the one before. Agent time; the walks are not in it. */
  minutes: number;
  /** Where the minutes came from: measured history, or the fixed default with none. */
  basis: { measured: true; tasks: number; minutesPerTask: number; retryRate: number } | { measured: false; linkMinutes: number };
}

/**
 * What the briefing says each milestone takes (M28), computed rather than guessed: the longest
 * `needs` chain inside it times the measured minutes per task, plus the measured retry rate
 * times those minutes. With no history, a fixed figure per chain link, said to be a default.
 * A milestone builds on the one before it, which it waits to see walked, and on any earlier
 * milestone a task of it names in `needs`.
 */
export const estimateOf = (milestones: Milestone[], pace: Pace | null): Estimate => {
  const home = new Map(milestones.flatMap((m) => m.tasks.map((t) => [t.id, m.n] as const)));
  const rows = milestones.map((m, i) => {
    const chain = longestChain(m);
    const links = Math.max(1, chain.length);
    const needed = m.tasks.flatMap((t) => (t.needs ?? []).map((id) => home.get(id))).filter((n): n is number => n !== undefined && n !== m.n);
    const buildsOn = [...new Set([...(i > 0 ? [milestones[i - 1].n] : []), ...needed])].sort((a, b) => a - b);
    const raw = pace ? (links + pace.retryRate) * pace.minutesPerTask : links * DEFAULT_LINK_MINUTES;
    return { n: m.n, title: m.title, walk: m.walk ?? [], buildsOn, chain, minutes: roughly(raw) };
  });
  return {
    milestones: rows,
    minutes: rows.reduce((n, r) => n + r.minutes, 0),
    basis: pace ? { measured: true, tasks: pace.tasks, minutesPerTask: Math.round(pace.minutesPerTask), retryRate: Math.round(pace.retryRate * 100) / 100 } : { measured: false, linkMinutes: DEFAULT_LINK_MINUTES },
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
    land: landFor(cfg, r.label),
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
  "  - for every element the mockups draw, the existing component it resembles (or none, found by searching the code) and whether it is reused as it is, the shared component restyled everywhere, or a new one built for this; asked per element, citing the cells, for every one the mockup rounds did not already settle",
];

export const interviewPrompt = (project: Project, mission: Mission, planPath: string, repos: Array<{ label: string; base: string; land: Landing }>, land: Landing): string => [
  `You are the Strike Lead for a mission in the project at ${project.path}. A strike lead plans the package, briefs it and sends it; it does not fly every jet in it. Your entire job in this session is the interview and the plan.`,
  "",
  mission.from ? `This mission came out of the breakdown of ${join(project.path, mission.from)}, as the item "${mission.brief}". Read that document first; it holds the reasoning.` : `Cory opened this mission with one line: "${mission.brief}"`,
  "",
  "That line is not a specification and you must not treat it as one. Interview him first, in rounds of questions. Read the repo before you ask, so every question is informed rather than generic: its docs, its rulebook, the code the work would touch, and what already exists that this should build on rather than replace. Probe until you can answer, in his words:",
  ...INTERVIEW_PROBES,
  "",
  "This interview is where most of the value is. Do not shorten it into a formality, and do not present a plan until he has answered.",
  "",
  "When the mission has mockups or changes a screen, read the mockups before you ask anything about it. Go through every cell and list every element it draws, the chrome as much as the content: toolbars and the controls in them, headers, search fields, buttons, rows, panels, badges, menus, dialogs, empty and loading states. An element drawn in several cells is one question. For each element, find the component in the code it resembles, and ask him the component question in three options: reuse it as it is (what ships is the component's real look, not the mockup's), restyle the shared component (the new look replaces the old one everywhere it appears, so name those other screens), or build a new one for this feature (the old one stays elsewhere). Cite the cells. A pick recorded in the mockup round's closing rules is already settled; do not ask it again. Never write \"reuse existing components\" or anything like it as a blanket instruction: every element goes in `## Components` with his decision and its cells, and every task that builds cells names them on its `cells:` line.",
  "",
  `When you and he have agreed, write the plan to ${planPath} in exactly this shape, then stop:`,
  "",
  PLAN_FORMAT,
  "",
  "Rules for the plan. Each task is one unit of work for one session with no other context, so its body must carry everything that session needs: the files, the shape, what it must not touch, and how it proves itself. Say what each task owns (`touches`) and what it builds on (`needs`): a task starts when what it needs has passed, so a dependency inside a milestone is allowed and means after. Before any fan-out, every type, id, codec, env flag and function one task makes and another uses goes in `## Contracts` with its owner and its shape. A milestone is a foundation: work that what comes after it builds on, so it is finished and walked before the next one starts. Everything that can be built at the same time belongs in one milestone: the contract first, then the backend and the frontend in parallel against it. Never cut milestones by layer or by repo, and never make the walkthrough a milestone. Most missions are one milestone; add another only when its work cannot begin until the first is built and confirmed. Every milestone ends in a walkthrough Cory can see, and work with no screen (a migration, a backfill) shows its dry run on the preview, before and after. Before the plan is fired, brief Cory on every milestone: what it builds, what he will walk through at its end (the cases), what it builds on, a rough time to build, and when he will be needed. Then give the total: how many milestones, the time end to end, and how many times he is needed. In `## Preflight`, say what the mission needs of the host (tools, runtimes, credentials and how long the mission runs so their lifetime can be checked, secrets by name) and what only a person can do (an inbox, a passkey, a real sign-in), with what the plan does instead; Maverick checks what a machine can before Cory approves and leaves.",
  "",
  repos.length > 1
    ? [
        `This project holds ${repos.length} git repositories, so every task must carry a \`  - repo: <name>\` line naming the one it works in. They are:`,
        ...repos.map((r) => `  - ${r.label} (lands against ${r.base})`),
        "",
        "A task works in exactly one repo. Where a change spans repos, that is more than one task, each naming what it needs from the other.",
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
  CHAT_RULES,
].join("\n");

/** Open a mission: the record, and the Strike Lead's first turn, which reads the repo and asks its first round. */
export const startMission = async (project: Project, name: string, brief: string, trackerIndex = 0, from?: string): Promise<{ mission: Mission }> => {
  if (!name.trim()) throw new Error("a mission needs a name");
  if (!brief.trim()) throw new Error("a mission needs the line you would have opened a session with");
  const id = slug(name);
  if (!id) throw new Error(`"${name}" does not reduce to a usable id`);
  if (await readMission(project.id, id)) throw new Error(`${project.name} already has a mission "${id}"`);
  const cfg = await missionConfigFor(project.path);
  // Refused here rather than on the first turn: a project with no repository cannot hold a mission.
  await repoChoices(project, cfg);
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
  await writeMission(mission);
  hearLead(project, mission.id);
  return { mission };
};

/**
 * The Strike Lead's session in a terminal of its own, for typing to it freely. The same session
 * the chat resumes: what is said here the next turn of the chat already knows.
 */
export const openLeadTerminal = async (project: Project, id: string): Promise<TerminalInfo> => {
  const mission = await missionOr404(project.id, id);
  if (!mission.lead) throw new Error(`${mission.name}'s Strike Lead has not started yet; say something to it first`);
  if (leadBusy(mission)) throw new Error("the Strike Lead is busy, in the chat or in a terminal already; open its session once it is free");
  const terminal = openTerminal(`Strike Lead · ${mission.name}`, ["claude", ...claudeArgs({ resume: mission.lead.sessionId })], project.path, 120, 36);
  leadTerminals.set(leadKey(mission), terminal.id);
  return terminal;
};

/** Read the plan the Strike Lead wrote, without committing to it. This is what the gate shows. */
export const previewPlan = async (project: Project, id: string): Promise<{ found: boolean; text?: string; parsed?: ReturnType<typeof parsePlan>; cost?: Cost; estimate?: Estimate; wingmanAgent?: string; repos?: Array<{ label: string; base: string; land: Landing }>; preflight?: Check[] }> => {
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
  const parsed = parsePlan(text, choices.map((r) => r.label), cfg.shared);
  if (!parsed.problems.length && mission.status === "interviewing") {
    mission.status = "planned";
    mission.milestones = parsed.milestones;
    await writeMission(mission);
  }
  // Only the repos the plan names, so the gate shows what this mission will actually touch.
  const named = new Set(parsed.milestones.flatMap((m) => m.tasks.map((t) => t.repo)));
  return { found: true, text, parsed, wingmanAgent: cfg.wingmanAgent, cost: costOf(parsed.milestones), estimate: estimateOf(parsed.milestones, await measuredPace()), repos: choices.filter((r) => named.has(r.label)).map(({ label, base, land }) => ({ label, base, land })), preflight: parsed.problems.length ? [] : await preflightFor(project, cfg, choices, parsed) };
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
const approving = new Set<string>();

/**
 * One approval at a time per mission. `approved` is only written once the tracker, the branches,
 * the worktrees and the formation exist, which takes seconds, so a second press in that window
 * (the gate's and the chat's both fire) would otherwise go through the whole thing again.
 */
export const approveMission = async (project: Project, id: string): Promise<Mission> => {
  const key = `${project.id}/${id}`;
  if (approving.has(key)) throw new Error("this mission is already being approved");
  approving.add(key);
  try {
    return await approveOnce(project, id);
  } finally {
    approving.delete(key);
  }
};

const approveOnce = async (project: Project, id: string): Promise<Mission> => {
  const mission = await missionOr404(project.id, id);
  if (mission.approved) throw new Error(`${mission.name} was already approved at ${mission.approved}`);
  const text = await readFile(join(project.path, mission.plan), "utf8").catch(() => {
    throw new Error(`no plan at ${mission.plan}; the Strike Lead has not written one yet`);
  });
  const cfg = await missionConfigFor(project.path);
  const choices = await repoChoices(project, cfg);
  const parsed = parsePlan(text, choices.map((r) => r.label), cfg.shared);
  if (parsed.problems.length) throw new Error(`the plan cannot be flown as written: ${parsed.problems.join("; ")}`);
  // A tool or an agent the mission cannot run without is refused here; a credential, a pin or a
  // human step is shown at the gate for the person to settle, and approving is their answer.
  const failing = (await preflightFor(project, cfg, choices, parsed)).filter((c) => refuses(c));
  if (failing.length) throw new Error(`preflight: ${failing.map((c) => `${c.name}: ${c.detail}`).join("; ")}`);
  mission.milestones = ownScreenshots(mission, parsed.milestones);
  mission.contracts = parsed.contracts;
  mission.components = parsed.components;
  mission.mockups = parsed.mockups;
  mission.requirements = parsed.requirements;
  mission.proofRequired = Boolean(cfg.proof);
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

const briefContext = (project: Project, mission: Mission, m: Milestone, task: MissionTask, repo: MissionRepo, cfg: Pick<MissionConfig, "shared" | "proof">): BriefContext => ({ projectPath: project.path, shared: cfg.shared, proof: cfg.proof, mission, milestone: m, task, repo });

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
  "Both sides are work this mission asked for, so keep both behaviours. Do not resolve by taking one side wholesale, do not `git checkout --ours` or `--theirs` to make it go away, and do not revert either task's commits. The union holds for rules too: a lint rule, a test or a check one side added stays. If the two genuinely cannot coexist, abort the merge (`git merge --abort`), change nothing, and say so plainly: that is a fact about the plan and Cory needs it, not a guess.",
  "",
  "You write no product code. The resolution is the merge and nothing else: no glue, no fixture repair, no wiring up what the two sides left apart. If making them coexist needs code, that is a task for a Wingman and a RIO, so abort and say what the task is.",
  "",
  `Do not touch ${repo.base} or any other repo. Do not push. Do not open a pull request. Do not spawn anything.`,
  "",
  "When the merge is committed, or when you have aborted it, stop.",
].join("\n");

/** The document every walkthrough starts from: the console's contract, its four pillars and the design system, in one file (web/walkthrough-template.html). */
export const WALKTHROUGH_TEMPLATE = fileURLToPath(new URL("../web/walkthrough-template.html", import.meta.url));

/**
 * The template, placed where the milestone's document goes with its key already set, before the
 * session that fills it starts: the session never needs to reach Maverick's install, and the key the
 * console reads is the one Maverick chose, not one a session had to type correctly.
 */
export const placeWalkthrough = async (dir: string, file: string, key: string): Promise<void> => {
  const template = await readFile(WALKTHROUGH_TEMPLATE, "utf8");
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), template.replace(/const KEY = "[^"]*";/, `const KEY = ${JSON.stringify(key)};`), "utf8");
};
export const walkKey = (mission: Pick<Mission, "id">, m: Pick<Milestone, "n">): string => `${mission.id}-m${m.n}`;

/**
 * The walkthrough builder works where the milestone's work has been merged together, so the
 * document describes what a person will actually find on the mission branch. It commits the
 * document there and nothing else.
 */
export const walkthroughPrompt = (project: Project, mission: Mission, m: Milestone, repo: MissionRepo, file: string): string => [
  `You are writing the test walkthrough for milestone ${m.n} of the mission "${mission.name}" in the project at ${project.path}.`,
  "",
  `The milestone's work is merged on branch ${repo.branch} of the ${repo.label} repo, checked out at ${repo.integration}. Work there and only there. Read what the milestone changed (\`git -C ${repo.integration} log ${repo.base}..HEAD --stat\`) before you write a word.`,
  "",
  `Milestone ${m.n} — ${m.title}. It is done when: ${m.done}`,
  "",
  "The tasks that went into it:",
  ...m.tasks.map((t) => `  - ${t.title}`),
  "",
  `The document is already at ${file}: Maverick's walkthrough template, with its key set. Fill it in. Do not touch its <script> or <style>; keep one <h2> per pillar and one \`.tc\` with a unique \`data-id\` per case. Replace every element marked \`data-example\` (the title, the meta line, the lede, the run command and the example cases) with this milestone's own, and drop the attribute. Cases use the template's markup: a \`.tc-title\`, then Setup, Steps and Expected, and a \`.cmd\` block for anything to run.`,
  "",
  "The four pillars, in the template's order. A pillar with nothing to walk keeps its heading and says why in one `.tc-none` line; it is never dropped.",
  "  1. Journeys: what a person does across the whole stack, start to end (a screen, what the server does, what is stored, and the screen again). One case per journey.",
  "  2. Look and feel: every screen the milestone touched, at 390 and 1280, light and dark, named by what to look at.",
  "  3. At scale: the same screens under a large data set. Give the command that seeds it from invented data (never client data) and the one that clears it; write that seed script into the repo if none exists.",
  "  4. Before and after: work with no screen (a migration, a backfill, a script) shown as its dry run before the change and after it, both outputs pasted into the case's `.ba` pair from real runs.",
  ...(m.walk?.length ? ["", "The plan named the cases walked at this milestone's end; each must be a case in the document:", ...m.walk.map((c) => `  - ${c}`)] : []),
  "",
  "Cases are what a person does with the real thing and what they should see, not unit tests. Fewer, sharper cases beat a long list.",
  ...looksLike(mission, m),
  "",
  `Commit the document in ${repo.integration} with a plain lowercase subject, with the seed script if you wrote one. Do not change any other file, do not touch the trackers, do not push, do not open a pull request, do not spawn other agents. When the document is committed, stop.`,
].join("\n");

/**
 * A task that builds cells owns the folder its screenshots go in, added to its `touches` once at
 * approval, so every check that reads what a task owns (its brief, its strays, its RIO) agrees.
 * A task with no `touches` owns everything already.
 */
export const ownScreenshots = (mission: Pick<Mission, "id">, milestones: Milestone[]): Milestone[] => {
  for (const t of milestones.flatMap((m) => m.tasks)) if (t.cells?.length && t.touches?.length) t.touches.push(screenshotsDir(mission, t));
  return milestones;
};

/** A milestone that built mockup cells is walked for its look as well as its behaviour: one case per screen, the cell beside it. */
const looksLike = (mission: Mission, m: Milestone): string[] => {
  const cells = [...new Set(m.tasks.flatMap((t) => t.cells ?? []))].sort((a, b) => a - b);
  if (!cells.length || !mission.mockups) return [];
  return ["",
    `This milestone builds approved mockup cells ${cells.join(", ")}, from ${mission.mockups}. In the look and feel pillar, add one case per screen, titled "Looks like cell N", with that cell embedded beside the link to the built screen (an <iframe> of the mockup page at the cell, by its anchor where it has one), so the person checks the look in this round and not at the end. Say in the case what to compare: the components the plan decided for it, ${componentsOver(mission.components, cells).map((c) => `${c.name}, ${DECISION_WORDS[c.decision]}`).join("; ") || "as the plan's Components section says"}.`];
};

const walkthroughFile = (mission: Mission, m: Milestone): string => join("deliverables", "testing", `${mission.id}-m${m.n}-walkthrough.html`);

/** The repo a milestone's walkthrough is built in: the one it landed in, which for one repo is the only one. */
const walkRepo = (mission: Mission, m: Milestone): MissionRepo | undefined => mission.repos.find((r) => m.mergeShas?.[r.label]) ?? mission.repos[0];

/** A builder still out: it was sent and has neither left a document nor been found to have failed. */
// A claim whose id is still empty counts: the sweep judges it on time alone, so a spawn that died does not hold the milestone.
const building = (m: Milestone): boolean => m.walkthrough?.claudeId !== undefined && !m.walkthrough.doc && !m.walkthrough.failed;

/** Sent the moment a milestone has merged, into the integration worktree of the repo it landed in. */
const commissionWalkthrough = async (project: Project, mission: Mission, m: Milestone): Promise<void> => {
  if (!m.tasks.some((t) => t.commits?.length)) return;
  const repo = walkRepo(mission, m);
  if (!repo) return;
  const started = new Date().toISOString();
  if (m.walkthrough?.claudeId) await stopAgent(m.walkthrough.claudeId);
  const on = (x: Mission) => x.milestones.find((y) => y.n === m.n);
  if (await claimed(mission,
    () => { m.walkthrough = { claudeId: "", started }; },
    async () => {
      await placeWalkthrough(repo.integration, walkthroughFile(mission, m), walkKey(mission, m));
      return spawnBackgroundAgent(repo.integration, `walkthrough · m${m.n} ${m.title}`, walkthroughPrompt(project, mission, m, repo, walkthroughFile(mission, m)));
    },
    (x, claudeId) => { const w = on(x)?.walkthrough; if (w) w.claudeId = claudeId; },
    (x, err) => { const y = on(x); if (y) y.walkthrough = { started, failed: `could not start the walkthrough builder: ${err.message}` }; })) agentCache.delete(project.path);
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

/** What the fix task is told: every failed case at once, by its id in the document, with what the person wrote. */
const walkFixIntent = (m: Milestone, doc: string, progress: WalkthroughProgress, cases: string[]): string => [
  `The walkthrough of milestone ${m.n} (${m.title}) failed ${casesWord(cases)}. Fix all of them in this one task; there is no second task for the rest.`,
  `The document is ${doc}: each case is the \`.tc\` element with that \`data-id\`, and says what a person does and what they should see.`,
  ...cases.map((id) => `- ${id}: ${progress.verdicts[id]}${progress.notes?.[id]?.trim() ? `. ${progress.notes[id].trim()}` : ""}`),
  "Reproduce each one before you change anything, fix the cause rather than the symptom, and prove each fix with a test that fails without it. Then run the project's proof once over the whole set. A case you cannot reproduce or cannot fix inside this milestone's paths is said in your hand-back, not skipped quietly.",
].join("\n");

const casesWord = (cases: string[]): string => `${cases.length} case${cases.length === 1 ? "" : "s"}`;

/**
 * A merged milestone taking more work: everything its merge, proof and landing settled is
 * unsettled, so it merges, proves and lands again through the same steps as the first time. Its
 * walkthrough document stays. Refused on a mission that has ended.
 */
const reopenMilestone = (mission: Mission, m: Milestone): void => {
  if (over(mission)) throw new Error(`${mission.name} is ${mission.status}; an ended mission takes no more work`);
  m.merged = undefined;
  m.proof = undefined;
  m.resolveTried = undefined;
  // A repo that already landed would never receive the new work: a push lands it again, a pull request is pushed to again.
  for (const r of mission.repos) if (m.tasks.some((t) => t.repo === r.label)) r.landed = undefined;
  mission.finished = undefined;
  mission.summary = undefined;
};

/**
 * A walk that comes back with failed cases opens one fix task on its milestone (M29), rather than
 * a build and a review per bug. Filed once every case has an answer, so the walk runs to the end
 * first, and only while no earlier round is still open. The milestone reopens: the task flies, is
 * reviewed and merges like any other, the proof runs again, and nothing builds on the milestone
 * until its failed cases are walked again and pass. Returns the round, if it filed one.
 */
export const fileWalkFix = (mission: Mission, m: Milestone): WalkFix | undefined => {
  const w = m.walkthrough;
  const p = w?.progress;
  if (walkthroughState(m) !== "walking" || !w?.doc || !p || p.answered < p.total) return undefined;
  const cases = failingCases(p);
  if (!cases.length) return undefined;
  const repo = walkRepo(mission, m)?.label ?? "root";
  const round = (w.fixes?.length ?? 0) + 1;
  const task: MissionTask = {
    id: `m${m.n}-fix${round}`,
    title: `fix the ${casesWord(cases)} walk ${round} of milestone ${m.n} failed`,
    intent: walkFixIntent(m, w.doc, p, cases),
    status: "pending",
    attempts: 0,
    repo,
    touches: [...new Set(m.tasks.filter((t) => t.repo === repo).flatMap((t) => t.touches ?? []))],
  };
  reopenMilestone(mission, m);
  const fix: WalkFix = { round, task: task.id, cases, filed: new Date().toISOString() };
  m.tasks.push(task);
  w.fixes = [...(w.fixes ?? []), fix];
  return fix;
};

/**
 * A note written after the last answer still reaches the fix, as long as its Wingman has not
 * been sent: the open round's task is told again from what the walk now says.
 */
const retellWalkFix = (m: Milestone): void => {
  const w = m.walkthrough;
  const fix = openFix(w);
  const task = fix && m.tasks.find((t) => t.id === fix.task && t.status === "pending");
  if (task && w?.doc && w.progress) task.intent = walkFixIntent(m, w.doc, w.progress, fix.cases);
};

/**
 * Once a round's task has merged and been proved, its failed cases lose their answers, so the
 * walk asks for those cases again and only those. The page drops the same answers from the
 * document when it sees the round. Returns whether it cleared anything.
 */
export const clearWalkFix = (m: Milestone): boolean => {
  const w = m.walkthrough;
  const fix = openFix(w);
  if (!w || !fix) return false;
  if (w.progress) {
    const verdicts = Object.fromEntries(Object.entries(w.progress.verdicts).filter(([id]) => !fix.cases.includes(id)));
    w.progress = { ...w.progress, verdicts, answered: Object.keys(verdicts).length };
  }
  fix.cleared = new Date().toISOString();
  return true;
};

/** The summary file beside the record: `<record dir>/<id>-summary.md`. */
const summaryFile = (mission: Mission): string => join(missionsDir(mission.project), `${mission.id}-summary.md`);

/** Where the summary stands, the one reading the page and the sweep share: nothing merged to read, never asked, running, failed, or written. */
export const summaryState = (mission: Mission): "unmerged" | "none" | "running" | "failed" | "written" => {
  const s = mission.summary;
  if (s?.at) return "written";
  if (s?.failed) return "failed";
  if (s?.started) return "running";
  return mission.milestones.some((m) => m.merged) ? "none" : "unmerged";
};

/** A summary asked for and not yet answered either way. */
const summarizing = (mission: Mission): boolean => summaryState(mission) === "running";

/**
 * A summarizer that has finished either left its file or it did not. A claim whose id never
 * landed (the server died mid-spawn) is judged on time alone, so it cannot hold the button for
 * good. Returns whether anything changed.
 */
const settleSummary = async (mission: Mission, state: Map<string, string>): Promise<boolean> => {
  const s = mission.summary;
  if (!s || !summarizing(mission) || !isOver(state, s.claudeId ?? "", s.started)) return false;
  const file = summaryFile(mission);
  const text = await readFile(file, "utf8").catch(() => null);
  const raw = text?.trim();
  if (raw) mission.summary = { at: new Date().toISOString(), text: threeBullets(raw) || raw, raw };
  else s.failed = text === null ? `the session finished without writing ${file}` : `the session wrote an empty ${file}`;
  return true;
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

/** Whether two tasks could collide in the air: a stack both deploy, or a path both own. */
/** What two tasks would both own in the air: the stacks they both deploy and the paths they both touch. Empty when they can fly together. */
const clashOn = (a: MissionTask, b: MissionTask): string[] => {
  const fold = (s: string): string => s.toLowerCase().replace(/\/+$/, "");
  return [
    ...(a.deploys ?? []).filter((d) => (b.deploys ?? []).some((e) => fold(d) === fold(e))).map((d) => `the ${d} stack`),
    ...(a.touches ?? []).filter((x) => (b.touches ?? []).some((y) => pathsOverlap(fold(x), fold(y)))),
  ];
};

/** The statuses of a task with an agent in the air: what a task about to start must not clash with. */
const AIRBORNE = new Set<TaskStatus>(["flying", "built", "reviewing"]);

/** A passed task is a base to build on unless its milestone is held, or merged and not yet proved and walked. */
const isBase = (mission: Pick<Mission, "proofRequired">, m: Milestone): boolean => !m.hold && (!m.merged || done(mission, m));

/** The first milestone before this one that is not done: what a milestone is sent, and merged, after. */
const undoneBefore = (mission: Pick<Mission, "milestones" | "proofRequired">, m: Milestone): Milestone | undefined =>
  mission.milestones.find((x) => x.n < m.n && !done(mission, x));

/** What a milestone that is not done still owes, as the thing waited for: its merge (and proof), then its walk. */
const holdback = (mission: Pick<Mission, "proofRequired">, m: Milestone): string => `milestone ${m.n} ${proved(mission, m) ? "is walked" : "has merged"}`;

/** Whether a pending task may start, and if not, what holds it, in the terms `waitingOn` says it in. */
type Gate =
  | { go: true }
  | { paused: true }
  | { needs: Array<{ id: string; title?: string; why: string }> }
  | { milestone: Milestone; after?: string }
  | { clash: MissionTask; on: string[] };

/**
 * The one rule for starting a task, as a verdict per pending task. A task with no `needs` starts
 * with its milestone. A task with `needs` starts when every task it names has passed, wherever
 * that task is: a sibling in the same milestone, or a task in an earlier milestone that has not
 * merged yet. So the plan's dependencies, not its milestone boundaries, decide when work can
 * begin, and one straggler no longer idles everything behind it. The milestone still merges as
 * one, once all its tasks pass. A need in a held milestone (a landing that failed, a collision
 * nobody reconciled) is not a base to build on, and a task that would deploy a stack or own a
 * path a task in the air has waits its turn: one deployer per stack in the air, whatever the
 * milestones say. A task let through here is in the air for every task after it, so two of one
 * pass cannot clash either. `startable` keeps the ones that go and `waitingOn` says why the rest
 * wait, so what the page says and what starts cannot drift apart.
 */
const gates = (mission: Pick<Mission, "milestones" | "status" | "proofRequired">): Array<{ milestone: Milestone; task: MissionTask; gate: Gate }> => {
  const home = new Map(mission.milestones.flatMap((m) => m.tasks.map((t) => [t.id, { task: t, m }] as const)));
  const airborne = mission.milestones.flatMap((m) => m.tasks).filter((t) => AIRBORNE.has(t.status));
  const out: Array<{ milestone: Milestone; task: MissionTask; gate: Gate }> = [];
  for (const milestone of mission.milestones) for (const task of milestone.tasks) {
    if (task.status !== "pending") continue;
    const gate = ((): Gate => {
      if (mission.status === "paused") return { paused: true };
      if (task.needs?.length) {
        const needs = task.needs.flatMap((id) => {
          const at = home.get(id);
          if (!at) return [{ id, why: "not in the plan" }];
          if (at.task.status !== "passed") return [{ id, title: at.task.title, why: at.task.status === "handed-back" ? "waiting for you" : at.task.status }];
          if (!isBase(mission, at.m)) return [{ id, why: at.m.hold ? "its milestone is held" : proved(mission, at.m) ? "its milestone is not walked yet" : "its milestone is still being proved" }];
          return [];
        });
        if (needs.length) return { needs };
      } else if (!milestone.dispatched) {
        const after = undoneBefore(mission, milestone);
        return { milestone, after: after && holdback(mission, after) };
      }
      for (const other of airborne) {
        const on = clashOn(task, other);
        if (on.length) return { clash: other, on };
      }
      return { go: true };
    })();
    if ("go" in gate) airborne.push(task);
    out.push({ milestone, task, gate });
  }
  return out;
};

/** Which pending tasks may start now, by `gates`. */
export const startable = (mission: Pick<Mission, "milestones" | "status" | "proofRequired">): Array<{ milestone: Milestone; task: MissionTask }> =>
  gates(mission).filter(({ gate }) => "go" in gate).map(({ milestone, task }) => ({ milestone, task }));

/** One verdict in words. Two needs are read by name; past that the ids say which, and the plan rows carry the names. */
const reason = (gate: Exclude<Gate, { go: true }>): string => {
  if ("paused" in gate) return "the mission is paused";
  if ("needs" in gate) {
    const { needs } = gate;
    return `waits for ${needs.length > 2 ? `${needs.length} tasks: ${needs.map((u) => `${u.id} (${u.why})`).join(", ")}` : needs.map((u) => `${u.id}${u.title ? ` ${u.title}` : ""} (${u.why})`).join("; ")}`;
  }
  if ("milestone" in gate) return `starts with milestone ${gate.milestone.n}${gate.after ? `, once ${gate.after}` : ""}`;
  return `waits for ${gate.clash.id} ${gate.clash.title} to finish: both own ${gate.on.join(", ")}`;
};

/**
 * Why each task and milestone that has not started is waiting, in words, read off `gates` and
 * the dispatch's own order, so "why is only one thing running?" is read off the plan rather than
 * worked out from the ledger. A task `startable` would let through says it starts on the next sweep.
 */
export const waitingOn = (mission: Pick<Mission, "milestones" | "status" | "proofRequired">): { tasks: Record<string, string>; milestones: Record<number, string> } => {
  const tasks = Object.fromEntries(gates(mission).map(({ task, gate }) => [task.id, "go" in gate ? "starts on the next sweep" : reason(gate)]));
  const milestones: Record<number, string> = {};
  for (const m of mission.milestones) {
    if (m.dispatched || m.merged) continue;
    const after = undoneBefore(mission, m);
    const early = m.tasks.some((t) => t.needs?.length) ? "; a task in it starts sooner, as soon as what it needs has passed" : "";
    milestones[m.n] = mission.status === "paused" ? "the mission is paused" : after ? `sent once ${holdback(mission, after)}${early}` : "sent on the next sweep";
  }
  return { tasks, milestones };
};

/** The one definition of "a person is needed": a task handed back, or a milestone held. Used by the sweep, resume, release and landAgain alike, through `settle`. */
export const needsPerson = (mission: Pick<Mission, "milestones">): string[] => [
  ...mission.milestones.flatMap((m) => m.tasks.filter((t) => t.status === "handed-back").map((t) => `${t.title}: ${t.note ?? (t.verdict ? `the RIO said ${t.verdict}` : "no verdict recorded")}`)),
  ...mission.milestones.filter((m) => m.hold).map((m) => m.hold!.reason),
];

/**
 * The one derivation of a mission's status and trouble from its record, called at the end of
 * every pass and every person's action. Paused is the person's word; review is every milestone
 * merged and unheld; blocked is a person needed somewhere; otherwise it flies. Statuses before
 * approval and after the end are not its business.
 */
export const settle = (mission: Mission, extra: string[] = []): Mission => {
  if (!SWEPT.has(mission.status) && mission.status !== "review") return mission;
  {
    mission.status = mission.pausedFor !== undefined ? "paused"
      : mission.milestones.length && mission.milestones.every((m) => proved(mission, m)) ? "review"
      : needsPerson(mission).length ? "blocked" : "flying";
    if (mission.status === "review") mission.finished ??= new Date().toISOString();
  }
  const open = [...(mission.pausedFor !== undefined ? [`paused: ${mission.pausedFor}`] : []), ...needsPerson(mission), ...extra];
  mission.trouble = open.length ? open.join(" · ") : undefined;
  return mission;
};

const holdFor = (m: Milestone, kind: HoldKind, reason: string): void => { m.hold ??= { kind, reason, at: new Date().toISOString() }; };

/**
 * Claim on disk, then spawn, then record the id (M11). A record that refuses the claim means a
 * person moved the mission while this pass was busy, and the StaleMissionError ends the pass
 * before any agent is spawned that nobody owns. What the spawn needs is already on the record
 * when it starts; the id is patched in after.
 */
export const claimed = async <T>(mission: Mission, claim: () => void, spawn: () => Promise<T>, record: (on: Mission, result: T) => void, failed: (on: Mission, err: Error) => void): Promise<boolean> => {
  claim();
  await writeMission(mission);
  let result: T;
  try {
    result = await spawn();
  } catch (err) {
    // The claim is on disk and nothing is behind it. Undo it the same way an id is recorded,
    // onto whichever record is true, or the task reads as flying for good.
    failed(mission, err as Error);
    await writeOnto(mission, (on) => failed(on, err as Error));
    return false;
  }
  record(mission, result);
  // The agent is running: an agent the record does not name is one nobody can stop or review,
  // and that is the one thing a refused write must not leave.
  await writeOnto(mission, (on) => record(on, result));
  return true;
};

/**
 * Write what the agent listing made true. If the record moved under it, the change goes onto
 * the fresh record, which is the one that is true, and the pass ends.
 */
const writeOnto = async (mission: Mission, apply: (on: Mission) => void): Promise<void> => {
  try {
    await writeMission(mission);
  } catch (err) {
    if (!(err instanceof StaleMissionError)) throw err;
    const fresh = await readMission(mission.project, mission.id);
    if (fresh) {
      apply(fresh);
      await writeMission(fresh);
    }
    throw err;
  }
};

/** A Wingman that never started: back to the person with the reason, and the attempt not spent. */
const launchFailed = (taskId: string) => (on: Mission, err: Error): void => {
  const t = taskOn(on, taskId);
  if (!t) return;
  t.status = "handed-back";
  t.claudeId = undefined;
  t.attempts = Math.max(0, t.attempts - 1);
  t.note = `could not launch: ${err.message}`;
};

/** The task with this id on whichever record is at hand. */
const taskOn = (on: Mission, id: string): MissionTask | undefined => on.milestones.flatMap((x) => x.tasks).find((t) => t.id === id);

/** Cut a task's worktree from the mission branch as it stands now and send its Wingman out. */
const launch = async (project: Project, mission: Mission, m: Milestone, task: MissionTask, cfg: MissionConfig): Promise<void> => {
  try {
    const repo = missionRepo(mission, task);
    ({ worktree: task.worktree, branch: task.branch } = taskLayout(project, cfg, mission.id, task, repo));
    await ensureWorktree(repo.path, task.worktree, task.branch, repo.branch);
    // The fork point is the branch just made, not the mission tip a moment later.
    task.base = await revParse(repo.path, task.branch);
    const out = await claimed(mission,
      () => { task.status = "flying"; task.claudeId = undefined; task.started = new Date().toISOString(); task.attempts = 1; },
      () => spawnBackgroundAgent(task.worktree!, `${mission.name} · ${task.title}`, wingmanBrief(briefContext(project, mission, m, task, repo, cfg)), cfg.wingmanAgent, undefined, wingmanEnv(task, cfg)),
      (on, claudeId) => { const t = taskOn(on, task.id); if (t) t.claudeId = claudeId; },
      launchFailed(task.id));
    if (!out) return;
    agentCache.delete(project.path);
    await recordWingman(mission, task);
  } catch (err) {
    if (err instanceof StaleMissionError) throw err;
    launchFailed(task.id)(mission, err as Error);
    await writeMission(mission);
  }
};

/** What a Wingman's shell is told about itself, so a project's own scripts can refuse what the brief forbids. */
const wingmanEnv = (task: MissionTask, cfg: MissionConfig): Record<string, string> => ({ MAVERICK_TASK: task.id, ...(cfg.shared.length ? { MAVERICK_SHARED: cfg.shared.join(",") } : {}) });

/**
 * Run the project's proof command where the milestone's work is merged. Never throws: a proof
 * that cannot run is a failed proof. The command runs in its own process group and is judged
 * by the shell's exit, not by its pipes closing, so a server it starts in the background does
 * not hold the proof open until the timeout; and the whole group is killed afterwards, and when
 * this process ends, so nothing it started outlives it. A proof that times out is a failed proof.
 */
const liveProofGroups = new Set<number>();
const killProofGroups = (): void => { for (const pgid of liveProofGroups) try { process.kill(-pgid, "SIGKILL"); } catch { /* gone */ } };
process.once("exit", killProofGroups);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { killProofGroups(); process.exit(signal === "SIGINT" ? 130 : 143); });

export const runProof = (cwd: string, command: string, timeoutMs = 30 * 60_000): Promise<{ ok: boolean; at: string; output: string }> =>
  new Promise((resolve) => {
    const at = new Date().toISOString();
    let output = "";
    const child = spawn("sh", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    if (child.pid) liveProofGroups.add(child.pid);
    const keep = (chunk: Buffer): void => { output = (output + chunk.toString()).slice(-4000); };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const killGroup = (): void => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } liveProofGroups.delete(child.pid); } };
    const timer = setTimeout(() => { killGroup(); done(false, `${output}\n(timed out after ${Math.round(timeoutMs / 60_000)} minutes)`); }, timeoutMs);
    let settled = false;
    const done = (ok: boolean, text: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Anything the proof left running (a server, a watcher) dies with it; a proof is not a deploy.
      setTimeout(killGroup, 500).unref();
      resolve({ ok, at, output: text.slice(-4000) });
    };
    child.on("error", (err) => done(false, `${output}\n${err.message}`));
    const judge = (code: number | null, signal: NodeJS.Signals | null): void => done(code === 0, signal ? `${output}\n(killed by ${signal})` : output);
    // The shell's last lines can still be in the pipe when it exits. Wait for its streams to close, but not on
    // whatever it left running holding them open: a short grace after exit is enough to read what it wrote.
    child.on("close", judge);
    child.on("exit", (code, signal) => setTimeout(() => judge(code, signal), 200));
  });

/** Proofs in flight, keyed by mission and milestone: a standing job the pass starts and later reads, never waits on. */
const proving = new Map<string, { result?: Awaited<ReturnType<typeof runProof>> }>();

/** Merged, not held, and, where the project proves merges, proved: ready to be walked and landed, and counted for review. */
export const proved = (mission: Pick<Mission, "proofRequired">, m: Milestone): boolean =>
  Boolean(m.merged) && !m.hold && (!mission.proofRequired || Boolean(m.proof?.ok));

/** A milestone that is done with: proved, then walked or waived (M28). Nothing builds on, merges after, or is sent past one that is not. */
export const done = (mission: Pick<Mission, "proofRequired">, m: Milestone): boolean => proved(mission, m) && !needsWalking(m);

/** Milestones merge in order, and only once sent: a later one whose tasks all passed early still waits for the ones before it to be done. */
export const mergeable = (mission: Pick<Mission, "milestones" | "proofRequired">, m: Milestone): boolean =>
  Boolean(m.dispatched) && m.tasks.length > 0 && m.tasks.every((t) => t.status === "passed") && !m.conflicts?.length && !m.hold && !undoneBefore(mission, m);

/** Mark a milestone sent and start every task of it that can start; the rest wait on their `needs`. */
const dispatch = async (project: Project, mission: Mission, m: Milestone): Promise<Mission> => {
  m.dispatched = new Date().toISOString();
  await startReady(project, mission);
  return writeThenSync(project, mission);
};

/** Start whatever the plan's dependencies now allow, in any milestone, including one not yet sent. Each launch claims the record first, so a person's move ends the launches. */
const startReady = async (project: Project, mission: Mission): Promise<number> => {
  const ready = startable(mission);
  if (!ready.length) return 0;
  const cfg = await missionConfigFor(project.path);
  for (const { milestone, task } of ready) await launch(project, mission, milestone, task, cfg);
  return ready.length;
};

/**
 * What a verdict does to a task. Pure, so the rule is tested without agents. A pass, with or
 * without notes, passes. A fail or a mixed goes back out while there are attempts left. Out of
 * retries, a task whose open findings are notes only merges with them carried; one with an open
 * blocker stops, and with it everything that needs it, because its milestone cannot merge.
 */
const isPass = (said: Verdict | undefined): boolean => said === "pass" || said === "pass with notes";

/**
 * The findings as the verdict reads them. On a pass an unsorted line rides as a note; on a fail
 * or a mixed it is a blocker, and is written as one so the page reads it the way the verdict did.
 */
const sortedFor = (findings: string, said: Verdict | undefined): { blockers: string[]; notes: string[] } => {
  const sorted = findingsOf(findings);
  return isPass(said)
    ? { blockers: sorted.blockers, notes: [...sorted.notes, ...sorted.unsorted] }
    : { blockers: [...sorted.blockers, ...sorted.unsorted.map((line) => `BLOCKER: ${line}`)], notes: sorted.notes };
};

export const settleReview = (task: Pick<MissionTask, "attempts">, findings: string, said: Verdict): { status: "passed" | "retry" | "handed-back"; note?: string; carried?: string[] } => {
  const { blockers, notes } = sortedFor(findings, said);
  const passing = isPass(said);
  // A verdict that lists nothing at all has said nothing is safe to carry. A pass with a
  // blocker in it is a RIO contradicting itself, and the blocker wins.
  if (!passing && !blockers.length && !notes.length) blockers.push("the RIO wrote no sorted findings; read as a blocker");
  if (passing && !blockers.length) return { status: "passed", ...(notes.length ? { carried: notes } : {}) };
  if (task.attempts < MAX_ATTEMPTS) return { status: "retry" };
  if (!blockers.length) return { status: "passed", note: `the RIO said ${said} after ${task.attempts} attempts with no blocker open`, carried: notes };
  return { status: "handed-back", note: `the RIO said ${said} after ${task.attempts} attempts with ${blockers.length} blocker(s) open; this one is yours` };
};

/** What was remembered about a task's last attempt, cleared when it goes back in the air. */
const forget = (task: MissionTask): void => {
  task.commits = undefined;
  task.head = undefined;
  task.strayed = undefined;
  task.carried = undefined;
};

/** Put a task back out with the RIO's findings, in the worktree it already has. */
const handBack = async (project: Project, mission: Mission, m: Milestone, task: MissionTask, findings: string): Promise<boolean> => {
  const previous = task.claudeId;
  const cfg = await missionConfigFor(project.path);
  // The record is about to forget both, and the verdict is read: nothing reads either again.
  for (const id of [previous, task.review?.claudeId]) if (id) await stopAgent(id);
  const out = await claimed(mission,
    () => {
      task.sessionId = undefined;
      task.claudeId = undefined;
      task.status = "flying";
      task.attempts += 1;
      task.started = new Date().toISOString();
      task.ended = undefined;
      task.verdict = undefined;
      task.review = undefined;
      task.note = undefined;
      forget(task);
    },
    () => spawnBackgroundAgent(task.worktree!, `${mission.name} · ${task.title} (retry ${task.attempts})`, wingmanBrief(briefContext(project, mission, m, task, missionRepo(mission, task), cfg), findings), cfg.wingmanAgent, undefined, wingmanEnv(task, cfg)),
    (on, claudeId) => { const t = taskOn(on, task.id); if (t) t.claudeId = claudeId; },
    launchFailed(task.id));
  if (!out) return false;
  if (previous) await patchSession(config.sessionsDir, `bg-${previous}`, { status: "handed-off", ended: new Date().toISOString(), handoff: findings.split("\n")[0] });
  await recordWingman(mission, task);
  return true;
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
  // The one place work resumes: an interview whose first turn a restart cut off, or a message to the
  // Strike Lead that a restart or a terminal holding its session left unanswered, is answered on the next pass.
  for (const m of await listMissions(project.id)) {
    if (!over(m) && !leadBusy(m) && ((!m.lead && !m.approved) || unheard(m.chat ?? []).length)) hearLead(project, m.id);
  }
};

/** How long a burst of endings is let settle before the one pass it earns. */
const ENDING_SETTLE_MS = 3_000;
const soon = new Map<string, NodeJS.Timeout>();

/**
 * A pass soon, not on the next tick: a Wingman or RIO that ended is the moment its review, its
 * merge or its dependant can go, and waiting for the tick cost up to a minute on every link of a
 * chain. Debounced per project, so a burst of endings is one pass. The listing is dropped at the
 * ending and again when the pass goes, or a pass in between would read and keep the word from
 * before it; a pass already running is waited out rather than skipped, since it may have read
 * the listing before this ending.
 */
export const sweepSoon = (project: Project, sweep: (project: Project) => Promise<void> = sweepMissions, wait = ENDING_SETTLE_MS): void => {
  agentCache.delete(project.path);
  clearTimeout(soon.get(project.id));
  soon.set(project.id, setTimeout(() => {
    if (sweeping.has(project.id)) return sweepSoon(project, sweep, wait);
    soon.delete(project.id);
    agentCache.delete(project.path);
    sweep(project).catch((err: Error) => console.error(`mission sweep for ${project.name}:`, err.message));
  }, wait).unref());
};

/**
 * Claude Code writes each background session's state to `<jobs>/<id>/state.json`, many times
 * while it works. A session under a project whose state moves into a finished word calls `onEnd`
 * with that project, once: a rewrite of a session already finished is not another ending, so it
 * neither reads the project list again nor holds the pass back. Only a trigger: the pass still
 * reads `claude agents` for the truth, and the server's 60 s tick stays the backstop for
 * anything the watch misses. Returns the close.
 */
export const watchEndings = (projects: () => Promise<Project[]>, onEnd: (project: Project) => void, dir = config.claudeJobsDir): (() => void) => {
  const finished = new Map<string, boolean>();
  const seen = async (file: string): Promise<void> => {
    const { state, cwd } = JSON.parse(await readFile(join(dir, file), "utf8")) as { state?: string; cwd?: string };
    const now = FINISHED.test(state ?? "");
    const was = finished.get(file);
    finished.set(file, now);
    if (!cwd || !now || was) return;
    const project = (await projects()).reduce<Project | undefined>((best, p) => (underPath(cwd, p.path) && p.path.length > (best?.path.length ?? -1) ? p : best), undefined);
    if (project) onEnd(project);
  };
  try {
    const watcher = watch(dir, { recursive: true }, (_, file) => {
      // A file caught mid-write is read again on its next write; the tick covers the last one.
      if (file && /(^|\/)state\.json$/.test(file)) seen(file).catch(() => undefined);
    });
    return () => watcher.close();
  } catch (err) {
    console.error(`not watching ${dir} for sessions that end; the sweep runs on its tick alone:`, (err as Error).message);
    return () => undefined;
  }
};

/** A milestone with a task in the air is watched whether or not it has been sent: a task may start early on its needs, and a Wingman nobody watches never gets its RIO. */
const inTheAir = (m: Milestone): boolean => !m.merged && Boolean(m.dispatched || m.tasks.some((t) => t.status !== "pending"));

/** The files a task inherited through its needs: the owners' touches, and theirs in turn. A task that merged what it needs carries them on its branch; they are not its strays. */
const inherited = (mission: Mission, task: MissionTask): string[] => {
  const all = new Map(mission.milestones.flatMap((x) => x.tasks).map((t) => [t.id, t]));
  const out: string[] = [];
  for (const seen = new Set<string>(), queue = [...(task.needs ?? [])]; queue.length;) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(...(all.get(id)?.touches ?? []));
    queue.push(...(all.get(id)?.needs ?? []));
  }
  return out;
};

/**
 * Step one of a pass: record what finished. Session ids, Wingmen that stopped (with their
 * commits, head and strays), verdicts that arrived (recorded on the task, acted on in step
 * two), reconciles that ended, proofs that settled. Nothing here spawns, so it runs paused or
 * not: a paused mission still knows what happened to it.
 */
const recordFinished = async (project: Project, mission: Mission, agents: Map<string, { sessionId?: string }>, state: Map<string, string>): Promise<{ waiting: string[]; seated: boolean }> => {
  const waiting: string[] = [];
  let seated = false;
  for (const m of mission.milestones) {
    if (inTheAir(m)) for (const task of m.tasks) {
      // A session id only exists once the agent listing knows about it; the formation wants
      // that one. An agent can be listed without one, so read it rather than test for the key.
      const sessionId = task.claudeId ? agents.get(task.claudeId)?.sessionId : undefined;
      if (sessionId && !task.sessionId) {
        task.sessionId = sessionId;
        seated = true;
      }
      // A claim whose id has not landed yet (the spawn is in flight) is not an agent to judge. One
      // whose id never lands (the server died mid-spawn, or the write that said it failed was
      // refused) is judged on time alone, as `settleSummary` judges one: nothing is behind it.
      const claim = task.status === "flying" ? { who: "Wingman", id: task.claudeId, since: task.started } : task.status === "reviewing" ? { who: "RIO", id: task.review?.claudeId, since: task.review?.started } : undefined;
      if (claim && !claim.id && isOver(state, "", claim.since)) {
        task.status = "handed-back";
        task.note = `its ${claim.who} never started: the launch failed or was cut off before an agent was recorded`;
      }
      const asking = (id?: string): boolean => Boolean(id) && state.get(id!) === "blocked";
      if (task.status === "flying" && asking(task.claudeId)) waiting.push(`${task.title} is waiting on you in its own session`);
      if (task.status === "reviewing" && asking(task.review?.claudeId)) waiting.push(`the RIO on ${task.title} is waiting on you in its own session`);
      if (task.status === "flying" && task.claudeId && isOver(state, task.claudeId, task.started)) {
        const repo = missionRepo(mission, task);
        task.status = "built";
        task.ended = new Date().toISOString();
        task.commits = await commitsAhead(repo.path, repo.branch, task.branch!).catch(() => []);
        task.head = await revParse(repo.path, task.branch!).then((sha) => sha.slice(0, 7)).catch(() => undefined);
        // Against the commit the task was cut from, not the mission tip: the ledger moves that tip
        // on every transition, and a two-dot diff against it would call the ledger a stray.
        try {
          task.strayed = strays(await changedFiles(repo.path, task.base ?? repo.branch, task.branch!), task.touches?.length ? [...task.touches, ...inherited(mission, task)] : undefined);
        } catch (err) {
          task.strayed = undefined;
          console.error(`mission ${mission.id}: could not diff ${task.id} against its touches:`, (err as Error).message);
        }
      }
      if (task.status === "reviewing" && task.review?.claudeId) {
        const findings = await readFile(task.review.file, "utf8").catch(() => null);
        const verdict = findings ? verdictOf(findings) : undefined;
        if (verdict && verdict !== "pending") {
          // Recorded here; what it means for the task is step two's, which a pause withholds.
          task.verdict = verdict;
          task.status = "built";
          task.note = `the RIO said ${verdict}`;
          await patchSession(config.sessionsDir, `bg-${task.claudeId}`, { status: "closed", ended: new Date().toISOString() });
        } else if (isOver(state, task.review.claudeId, task.review.started)) {
          // The RIO is gone and wrote nothing: that is a failed review, not a pass.
          task.status = "handed-back";
          task.note = "the RIO finished without writing a verdict";
        }
      }
    }
    // A Strike Lead sent in to reconcile a collision: look at the branch when it is done, not at what it said about itself.
    if (m.resolve && isOver(state, m.resolve.claudeId, m.resolve.started)) {
      const repo = mission.repos.find((r) => r.label === m.resolve!.repo);
      const landed = repo ? await commitsAhead(repo.path, m.resolve.branch, repo.branch).catch(() => []) : [];
      if (landed.length) {
        m.mergeShas = { ...(m.mergeShas ?? {}), [m.resolve.repo]: await revParse(repo!.path, repo!.branch).then((sha) => sha.slice(0, 7)).catch(() => "merged") };
        m.conflicts = undefined;
        m.hold = undefined;
      } else {
        holdFor(m, "collision", `milestone ${m.n} collided in ${m.resolve.repo} and the Strike Lead could not reconcile it: ${(m.resolve.paths ?? []).join(", ")}. Both sides are work the plan asked for, so this is a question about the plan.`);
      }
      m.resolve = undefined;
    }
    // A proof that settled since the last pass. The job stays in the map until the record that
    // carries its result has been written, so a pass refused as stale does not erase a verdict.
    const job = proving.get(`${mission.id}/${m.n}`);
    if (job?.result && !m.proof) {
      m.proof = job.result;
      if (!m.proof.ok) holdFor(m, "proof", `the proof failed after milestone ${m.n} merged: ${m.proof.output.split("\n").filter(Boolean).slice(-3).join(" | ")}`);
    }
  }
  return { waiting, seated };
};

/** Step two: act on what step one recorded. Every spawn claims the record first; every merge or landing writes the record first as its brake. Not run while paused. */
const actOn = async (project: Project, mission: Mission, cfg: MissionConfig): Promise<void> => {
  for (const m of mission.milestones) {
    if (inTheAir(m)) for (const task of m.tasks) {
      if (task.status !== "built") continue;
      if (task.verdict) {
        const findings = task.review ? await readFile(task.review.file, "utf8").catch(() => "") : "";
        const outcome = settleReview(task, findings, task.verdict);
        if (outcome.status === "retry") {
          await handBack(project, mission, m, task, findings).catch((err) => {
            if (err instanceof StaleMissionError) throw err;
            task.status = "handed-back";
            task.note = `could not hand the task back: ${(err as Error).message}`;
          });
        } else {
          task.status = outcome.status;
          task.note = outcome.note;
          task.carried = outcome.carried;
        }
        continue;
      }
      // Reviewed by a RIO that did not write it. The tool list is the fence, passed here so it holds whether or not the agent file was installed (M19).
      const reviews = (task.reviews ?? 0) + 1;
      const file = reviewFile(mission, { ...task, reviews });
      const previous = reviews > 1 ? await readFile(reviewFile(mission, { ...task, reviews: reviews - 1 }), "utf8").catch(() => undefined) : undefined;
      if (await claimed(mission,
        () => { task.reviews = reviews; task.status = "reviewing"; task.review = { claudeId: "", file, started: new Date().toISOString() }; },
        () => spawnBackgroundAgent(project.path, `RIO · ${task.title}`, rioBrief(briefContext(project, mission, m, task, missionRepo(mission, task), cfg), file, previous), cfg.rioAgent, RIO_TOOLS),
        (on, claudeId) => { const t = taskOn(on, task.id); if (t?.review) t.review.claudeId = claudeId; },
        (on, err) => { const t = taskOn(on, task.id); if (t) { t.status = "handed-back"; t.note = `could not start the RIO: ${err.message}`; } })) {
        agentCache.delete(project.path);
        await patchSession(config.sessionsDir, `bg-${task.claudeId}`, { audit: task.review });
      }
    }
    if (m.resolve || !mergeable(mission, m)) continue;
    // The brake before anything non-idempotent: a write that the record refuses ends the pass.
    await writeMission(mission);
    // Each task lands on its own repo's mission branch: a milestone can span repos, and a
    // conflict in one must not leave another half-applied.
    m.mergeShas = m.mergeShas ?? {};
    let collided = false;
    for (const task of m.tasks) {
      if (!task.commits?.length) continue;
      const repo = missionRepo(mission, task);
      // The same precondition as the ledger's: the merge lands on whatever is checked out there (M8).
      await assertCheckedOut(repo.integration, repo.branch);
      const result = await mergeInto(repo.integration, task.branch!, `mission ${mission.id}: ${task.title}`);
      if (result.merged) {
        if (result.sha) m.mergeShas[repo.label] = result.sha;
        continue;
      }
      collided = true;
      const paths = result.conflicts ?? [];
      m.conflicts = paths.map((f) => `${repo.label}/${f}`);
      mission.conflictsSeen = (mission.conflictsSeen ?? 0) + 1;
      // Three collisions is a plan whose milestones overlap, which is a level up from here.
      if ((mission.conflictsSeen ?? 0) >= 3) mission.escalation = `${mission.conflictsSeen} milestones of this mission have collided. That is the plan putting work that touches the same lines into one milestone, not a merge that needs redoing. The plan is the thing to change.`;
      // One attempt by the Strike Lead per milestone. A second is not more likely to work
      // and a loop of agents on a collision is exactly what nobody asked for.
      if (m.resolveTried) {
        holdFor(m, "collision", `milestone ${m.n} still will not merge into ${repo.label} after the Strike Lead tried: ${m.conflicts.join(", ") || "unknown conflict"}`);
        break;
      }
      const on = (x: Mission) => x.milestones.find((y) => y.n === m.n);
      if (await claimed(mission,
        () => { m.resolveTried = true; m.resolve = { claudeId: "", repo: repo.label, branch: task.branch!, started: new Date().toISOString(), paths: m.conflicts! }; },
        () => spawnBackgroundAgent(repo.integration, `Strike Lead · resolve m${m.n}`, resolvePrompt(project, mission, m, repo, task.branch!, paths)),
        (x, claudeId) => { const r = on(x)?.resolve; if (r) r.claudeId = claudeId; },
        (x, err) => {
          const y = on(x);
          if (!y) return;
          y.resolve = undefined;
          holdFor(y, "collision", `milestone ${m.n} will not merge into ${repo.label} and the Strike Lead could not be sent in: ${err.message}`);
        })) agentCache.delete(project.path);
      break;
    }
    if (!collided) m.merged = new Date().toISOString();
  }
};

/**
 * Step three: catch up on what a merged milestone owes and what the plan now allows. Standing
 * jobs, not things done only in the pass that merged, so a milestone merged while paused gets
 * its proof, its landing and its walkthrough on resume, and a released hold is tried again.
 */
const catchUp = async (project: Project, mission: Mission, cfg: MissionConfig): Promise<void> => {
  for (const m of mission.milestones) {
    if (!m.merged || m.hold) continue;
    const key = `${mission.id}/${m.n}`;
    if (cfg.proof && !m.proof && !proving.has(key)) {
      // Detached: the pass starts it and a later pass reads it; a sweep is not held for half an hour.
      const job: { result?: Awaited<ReturnType<typeof runProof>> } = {};
      proving.set(key, job);
      void runProof(walkRepo(mission, m)!.integration, cfg.proof).then((r) => { job.result = r; });
    }
    if (!proved(mission, m)) continue;
    // A repo with nothing left to do lands now rather than at the close, so an earlier repo can
    // be reviewed and merged while the later ones are still flying. A base that never received
    // the push holds the next milestone, which very often consumes what this one made. Landing
    // is the whole branch, so it waits until every merged milestone is proved, not only this one.
    if (mission.repos.some((r) => r.land !== "merge" && !r.landed) && mission.milestones.every((x) => !x.merged || proved(mission, x))) {
      await writeMission(mission);
      const { failed } = await landTheWork(mission);
      if (failed.length) { holdFor(m, "landing", `could not land: ${failed.join(" · ")}. The next milestone is held until this does land, in case it depends on it.`); continue; }
    }
    if (!m.walkthrough) await commissionWalkthrough(project, mission, m);
    else clearWalkFix(m);
  }
  const next = mission.milestones.find((x) => !x.dispatched && !x.merged && !undoneBefore(mission, x));
  if (next) await dispatch(project, mission, next);
  await startReady(project, mission);
};

const ids = (list: Array<string | undefined>): string[] => list.filter((id): id is string => Boolean(id));

/**
 * The sessions a mission's record currently seats. The flight's: its Wingmen, their RIOs and a
 * reconciling Strike Lead, which a mission past the review gate is done with whatever they are
 * doing. The builders': the walkthrough builders and the summarizer, which run exactly while the
 * mission sits at the gate, so only a finished one is done with. The record forgets an id when a
 * task is handed back or a builder is asked again, so those moments stop what they forget.
 */
const seatedIn = (mission: Mission): { flight: string[]; builders: string[] } => ({
  flight: ids(mission.milestones.flatMap((m) => [...m.tasks.flatMap((t) => [t.claudeId, t.review?.claudeId]), m.resolve?.claudeId])),
  builders: ids([...mission.milestones.map((m) => m.walkthrough?.claudeId), mission.summary?.claudeId]),
});

/** Stops at a time; a first pass can have a dozen due, and dozens of `claude` starting at once is its own problem. */
const STOPS_AT_ONCE = 8;

/**
 * End every session the mission is done with and that still holds a process: the listing carries
 * a `pid` exactly while the process is up, whatever the state word says, and nothing once it is
 * down, so the listing is the memory and a restart replays nothing. While the sweep still flies
 * the mission (flying, blocked or paused) a session is done with once its turn has finished;
 * past the review gate the flight's sessions are done with whatever they are doing, since a RIO
 * sitting on a prompt after its task was accepted over it is a leak like any other, while a
 * builder is still only done with once finished, because that is when builders run. A pass reads
 * a Wingman's branch and a RIO's findings off finished sessions, so a stop here cuts nothing off.
 * Returns the ids stopped. Three missions once left eighteen idle sessions behind.
 */
export const endFinished = async (mission: Mission, agents: Map<string, Pick<BackgroundAgent, "state" | "pid">>, stop: (claudeId: string) => Promise<void> = stopAgent): Promise<string[]> => {
  const up = (id: string): Pick<BackgroundAgent, "state" | "pid"> | undefined => { const a = agents.get(id); return a?.pid ? a : undefined; };
  const finished = (id: string): boolean => FINISHED.test(up(id)?.state ?? "");
  const { flight, builders } = seatedIn(mission);
  const due = [...flight.filter((id) => (SWEPT.has(mission.status) ? finished(id) : Boolean(up(id)))), ...builders.filter(finished)];
  for (let i = 0; i < due.length; i += STOPS_AT_ONCE) await Promise.all(due.slice(i, i + STOPS_AT_ONCE).map(stop));
  return due;
};

const sweepOnce = async (project: Project): Promise<void> => {
  // A mission that has stopped flying (at the review gate, or blocked) may still have a walkthrough
  // or a summary being written, and one in review may still hold sessions that finished and were
  // never ended.
  const missions = (await listMissions(project.id)).filter((m) => SWEPT.has(m.status) || m.status === "review" || m.milestones.some(building) || summarizing(m));
  if (!missions.length) return;
  const cfg = await missionConfigFor(project.path);
  const agents = new Map((await agentsFor(project.path)).map((a) => [a.id, a]));
  const state = new Map([...agents].map(([id, a]) => [id, a.state ?? ""]));
  for (const mission of missions) {
    // First, before a settle or a hand-back forgets an id: the listing is cached twenty seconds,
    // so a pass that stopped anything drops the cache or the next one would tell the same ids again.
    if ((await endFinished(mission, agents)).length) agentCache.delete(project.path);
    const settledWalks = await settleWalkthroughs(project, mission, state);
    const settledSummary = await settleSummary(mission, state);
    if (!SWEPT.has(mission.status)) {
      if (settledWalks || settledSummary) await writeMission(mission).catch((err) => { if (!(err instanceof StaleMissionError)) throw err; });
      continue;
    }
    try {
      // The project may have set or removed its proof since approval; the record follows the project.
      mission.proofRequired = Boolean(cfg.proof);
      const { waiting, seated } = await recordFinished(project, mission, agents, state);
      // Paused: what is running is recorded and nothing new starts. Everything else is step two and three.
      if (mission.status !== "paused") {
        await actOn(project, mission, cfg);
        await catchUp(project, mission, cfg);
      }
      settle(mission, waiting);
      // One formation write per pass rather than one per task that gained a session id.
      if (seated && mission.formation) await updateFormation(mission.formation, { members: memberIds(mission) }).catch(() => undefined);
      // The Strike Lead only reaches Claude Code's session registry once its session has done something,
      // which can be well after the formation was made; keep offering it the lead seat.
      await seatTheLead(mission).catch(() => undefined);
      await writeThenSync(project, mission);
      for (const m of mission.milestones) if (m.proof) proving.delete(`${mission.id}/${m.n}`);
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
  if (!mission.formation || !(mission.lead || mission.interview)) return;
  if ((await listFormations(mission.project)).find((f) => f.id === mission.formation)?.lead) return;
  // A Strike Lead that is a chat has its session id on the record already.
  if (mission.lead) {
    await updateFormation(mission.formation, { lead: mission.lead.sessionId }).catch(() => undefined);
    return;
  }
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
/**
 * How each repo not landed yet lands, as the project says now, with a line for every one that
 * changed. Only `landAgain` calls it: following the config on every sweep would let an edit to
 * `maverick.json` start pushing a base nobody approved, so it waits for a person to ask.
 */
const followLanding = (mission: Mission, cfg: MissionConfig): string[] =>
  mission.repos.filter((r) => !r.landed && r.land !== landFor(cfg, r.label)).map((r) => {
    const was = r.land;
    r.land = landFor(cfg, r.label);
    return `${r.label} now lands by ${r.land}, not ${was}, as the project's maverick.json says`;
  });

export const landAgain = async (project: Project, id: string): Promise<{ mission: Mission; landed: string[]; failed: string[] }> => {
  let landed: string[] = [];
  let failed: string[] = [];
  let changed: string[] = [];
  const cfg = await missionConfigFor(project.path);
  const mission = await changeMission(project.id, id, async (mission) => {
    if (mission.status === "closed" || mission.status === "abandoned") throw new Error(`${mission.name} is ${mission.status}; there is nothing left to land`);
    if (mission.status === "paused") throw new Error(`${mission.name} is paused; landing pushes, so resume it first`);
    // A landing that failed is often fixed in the project's own config (a repo with no remote set to merge); try it as the project now says.
    changed = followLanding(mission, cfg);
    ({ landed, failed } = await landTheWork(mission));
    if (failed.length) {
      mission.trouble = `still could not land: ${failed.join(" · ")}`;
    } else if (!landed.length) {
      // Nothing landed and nothing failed: every repo either has work still moving or has
      // already landed. Saying "recovered" here would be a lie that puts the mission back in
      // the air on the strength of having done nothing.
      throw new Error(`nothing was waiting to land on ${mission.name}: every repo either still has work in the air or has already landed`);
    } else {
      // Back in the air: the hold comes off and the sweep sends the milestone that was waiting behind the landing.
      for (const m of mission.milestones) if (m.hold?.kind === "landing") m.hold = undefined;
      settle(mission);
    }
    return mission;
  });
  if (changed.length) await recorded(project, mission, changed);
  return { mission, landed, failed };
};

/** Put a blocked task back in the air after Cory has had a look, with one more attempt. */
export const retryTask = async (project: Project, id: string, taskId: string): Promise<Mission> => {
  // The checks and the attempt count go through the retried change; the spawn does not, so a
  // refused write never spawns twice.
  const mission = await changeMission(project.id, id, (mission) => {
    const task = taskOn(mission, taskId);
    if (!task) throw new Error(`no task "${taskId}" on ${mission.name}`);
    if (mission.status === "closed" || mission.status === "abandoned") throw new Error(`${mission.name} is ${mission.status}; it cannot be put back in the air`);
    if (mission.status === "paused") throw new Error(`${mission.name} is paused; resume it first, and the retry goes out then`);
    if (!task.worktree) throw new Error(`${task.title} never got a worktree; it cannot be retried`);
    if (task.status === "passed") throw new Error(`${task.title} already passed; there is nothing to send back out`);
    task.attempts = MAX_ATTEMPTS - 1;
    return mission;
  });
  const m = mission.milestones.find((x) => x.tasks.some((t) => t.id === taskId))!;
  const task = taskOn(mission, taskId)!;
  const findings = task.review ? await readFile(task.review.file, "utf8").catch(() => "") : "";
  // Recorded as handed back already; the person who pressed the button is told why here.
  if (!(await handBack(project, mission, m, task, findings))) throw new Error(`${task.title} ${task.note}`);
  settle(mission);
  await writeMission(mission);
  return recorded(project, mission, [`${taskId} sent back out by Cory`]);
};

/**
 * Pause, do not end. Nothing new is spawned; what is running finishes and is recorded; the
 * branches and worktrees stay. The reason goes into the ledger, so a mission paused for an
 * expired credential resumes from the file with the reason beside it.
 */
export const pauseMission = async (project: Project, id: string, note: string): Promise<Mission> => {
  if (!note.trim()) throw new Error("say why the mission is being paused; it is kept in the ledger");
  const mission = await changeMission(project.id, id, (mission) => {
    if (mission.status !== "flying" && mission.status !== "blocked") throw new Error(`${mission.name} is ${mission.status}; only a flying or blocked mission can be paused`);
    mission.pausedFor = note.trim();
    return settle(mission);
  });
  return recorded(project, mission, [`paused by Cory: ${note.trim()}`]);
};

/** One entry onto the end of the chat, on whichever record is current. */
const addChat = (project: Project, id: string, entry: Omit<ChatEntry, "at">) =>
  changeMission(project.id, id, (m) => { m.chat = [...(m.chat ?? []), { at: new Date().toISOString(), ...entry }]; });

/**
 * Cory's message to the Strike Lead: it goes into the chat and the Strike Lead answers it in
 * the next turn. Once the mission is approved it also goes into the ledger as a decision, like
 * every other thing a person does, on one line: a ledger decision is one bullet, so a newline in
 * it would start a line of plan of its own. The ledger is the record of what was decided and the
 * chat is the conversation; a ledger that refuses the line is trouble on the mission, and the
 * chat still has it.
 */
export const sayToStrikeLead = async (project: Project, id: string, text: string): Promise<{ ok: true }> => {
  const said = text.trim();
  if (!said) throw new Error("say something; an empty reply is not sent");
  const fresh = await missionOr404(project.id, id);
  if (over(fresh)) throw new Error(`${fresh.name} is ${fresh.status}; its Strike Lead is stood down`);
  if (fresh.approved) await recorded(project, fresh, [`Cory to the Strike Lead: ${said.replace(/\s+/g, " ")}`]);
  await addChat(project, id, { who: "you", text: said });
  hearLead(project, id);
  return { ok: true };
};

/** A round of the Strike Lead's questions answered with clicks: said to it as one message, numbered as it asked. */
export const answerLead = async (project: Project, id: string, picked: Record<string, { options?: string[]; other?: string }>): Promise<{ ok: true }> => {
  const last = openRound((await missionOr404(project.id, id)).chat);
  if (!last) throw new Error("there is no round of questions waiting for answers; it may have been answered already");
  return sayToStrikeLead(project, id, answersText(last.questions, picked));
};

/* ---------- the Strike Lead's turns ---------- */

/** Missions whose Strike Lead is mid-turn in this process, and the terminals its session is open in. */
const leading = new Set<string>();
const leadTerminals = new Map<string, string>();
const leadKey = (m: Pick<Mission, "project" | "id">): string => `${m.project}/${m.id}`;

/**
 * Busy answering in the chat, or open in a terminal: one session has one writer at a time. A
 * message sent meanwhile waits in the chat, and the sweep has it answered once the session is free.
 */
export const leadBusy = (m: Pick<Mission, "project" | "id">): boolean => {
  const key = leadKey(m);
  const terminal = leadTerminals.get(key);
  if (terminal && !listTerminals().some((t) => t.id === terminal && t.exitCode === null)) leadTerminals.delete(key);
  return leading.has(key) || leadTerminals.has(key);
};

/** A turn reads the repo before it answers; a long one is still well inside this. */
const LEAD_TURN_MS = 20 * 60_000;
/** Times a plan the Strike Lead calls ready, but that cannot fly, goes back to it before the person has to read why. */
const LEAD_FIXES = 2;

/** One turn of the Strike Lead's session: the prompt in, its structured reply out, or why there is none. */
const leadTurn = (project: Project, session: { sessionId?: string; resume?: string }, prompt: string): Promise<ReturnType<typeof parseTurn>> =>
  new Promise((done) => {
    execFile("claude", claudeArgs({ schema: LEAD_SCHEMA, ...session, prompt }), { cwd: project.path, timeout: LEAD_TURN_MS, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const parsed = parseTurn(stdout);
      done(parsed.ok || !err ? parsed : { ok: false, why: whyFailed(Object.assign(err, { stderr })) });
    });
  });

/** What the Strike Lead reads this turn: its brief on the first, the unheard messages, and in flight the mission's state. */
const leadPrompt = async (project: Project, mission: Mission, first: boolean, heard: ChatEntry[]): Promise<string> => {
  const parts: string[] = [];
  if (first) {
    const cfg = await missionConfigFor(project.path);
    // A mission approved before the Strike Lead was a chat has no session yet; its first turn is in flight.
    parts.push(mission.approved
      ? `You are the Strike Lead for the mission "${mission.name}" in the project at ${project.path}. Cory opened it with: "${mission.brief}"\n\n${flightRules(join(project.path, mission.plan), ledgerPath(project, mission) ?? undefined)}`
      : interviewPrompt(project, mission, join(project.path, mission.plan), await repoChoices(project, cfg), cfg.land));
  }
  if (heard.length) parts.push(heard.map((e) => `${e.who === "you" ? "Cory" : e.who}: ${e.text}`).join("\n\n"));
  if (mission.approved) {
    const view = await missionView(project, mission.id);
    parts.push(`Maverick's snapshot of the mission now:\n${snapshot(view, view.questions, view.feed.slice(-12).map((f) => `${f.at} ${f.who}: ${f.text}`), view.waiting)}`);
  }
  return parts.join("\n\n");
};

/**
 * Have the Strike Lead answer whatever it has not heard, one turn at a time, until nothing is
 * left: a message sent while it answers is answered next. Never throws and never awaited by a
 * request: a turn takes minutes, and the page follows it on the stream. A turn that fails says
 * why in the chat, as Maverick, and the messages it carried count as heard, so a broken session
 * is not retried in a loop. The session is recorded only once its first turn has answered, so a
 * first turn a restart cut off is a first turn again, brief and all.
 */
export const hearLead = (project: Project, id: string): void => {
  const key = leadKey({ project: project.id, id });
  if (leading.has(key)) return;
  leading.add(key);
  void (async () => {
    for (;;) {
      const mission = await missionOr404(project.id, id);
      const chat = mission.chat ?? [];
      const heard = unheard(chat);
      const first = !mission.lead;
      if (over(mission) || leadTerminals.has(key) || (!first && !heard.length)) return;
      const sessionId = mission.lead?.sessionId ?? randomUUID();
      const turn = await leadTurn(project, first ? { sessionId } : { resume: sessionId }, await leadPrompt(project, mission, first, heard));
      // Read before the reply lands, so a plan the Strike Lead says is ready is checked as it is now.
      const plan = turn.ok && turn.planReady && !mission.approved ? await previewPlan(project, id) : undefined;
      const problems = plan?.found ? plan.parsed?.problems ?? [] : plan ? [`there is no plan at ${mission.plan}`] : [];
      // Counted on the record since Cory last spoke, so the cap holds across restarts and repeat calls.
      const sentBack = chat.slice(chat.findLastIndex((e) => e.who === "you") + 1).filter((e) => e.sentBack).length;
      await changeMission(project.id, id, (m) => {
        const at = new Date().toISOString();
        if (turn.ok && !m.lead) m.lead = { sessionId, started: at };
        m.chat = [...(m.chat ?? []), turn.ok
          ? { at, who: "Strike Lead", text: turn.message, ...(turn.questions.length ? { questions: turn.questions } : {}), ...(turn.planReady && !problems.length ? { planReady: true } : {}) }
          : { at, who: "Maverick", text: `The Strike Lead did not answer: ${turn.why}`, error: true }];
        // A plan it calls ready that cannot fly goes straight back to it, so the person reads a plan that can.
        if (problems.length && sentBack < LEAD_FIXES) m.chat.push({ at, who: "Maverick", sentBack: true, text: `The plan cannot be flown as written. Fix these in ${m.plan}, then say it is ready again:\n${problems.map((p) => `- ${p}`).join("\n")}` });
      });
      // A first turn that failed has no session to resume; stopping here leaves it a first turn for the next call.
      if (!turn.ok && first) return;
    }
  })()
    .catch((err: Error) => {
      console.error(`strike lead for ${key}:`, err.message);
      return addChat(project, id, { who: "Maverick", text: `The Strike Lead's turn broke: ${err.message}`, error: true }).catch(() => undefined);
    })
    .finally(() => leading.delete(key));
};

/**
 * Release a milestone a person settled by hand. What release means is the hold's kind: a
 * collision they reconciled in the integration worktree is merged again; a proof is run again
 * on the tree they fixed, so a hand fix never goes in unproved; a landing is `landAgain`'s,
 * because it pushes. If the sweep still cannot, the hold comes back with the new reason.
 */
export const releaseMilestone = async (project: Project, id: string, n: number, note: string): Promise<Mission> => {
  if (!note.trim()) throw new Error("say what you did to settle it; it is kept in the ledger");
  const mission = await changeMission(project.id, id, (mission) => {
    if (!SWEPT.has(mission.status)) throw new Error(`${mission.name} is ${mission.status}; there is nothing to release`);
    const m = mission.milestones.find((x) => x.n === n);
    if (!m) throw new Error(`no milestone ${n} on ${mission.name}`);
    if (!m.hold) throw new Error(`milestone ${n} is not held`);
    if (m.hold.kind === "landing") throw new Error(`milestone ${n} is held on a landing; "land again" is the release for that, because it pushes`);
    if (m.hold.kind === "proof") m.proof = undefined;
    else { m.conflicts = undefined; m.resolveTried = undefined; }
    m.hold = undefined;
    return settle(mission);
  });
  return recorded(project, mission, [`milestone ${n} released by Cory: ${note.trim()}`]);
};

export const resumeMission = async (project: Project, id: string): Promise<Mission> => {
  const mission = await changeMission(project.id, id, (mission) => {
    if (mission.status !== "paused") throw new Error(`${mission.name} is ${mission.status}, not paused`);
    mission.pausedFor = undefined;
    return settle(mission);
  });
  return recorded(project, mission, ["resumed by Cory"]);
};

/** Accept a task Cory has looked at himself, so a milestone its RIO failed can still merge. */
export const acceptTask = async (project: Project, id: string, taskId: string, note: string): Promise<Mission> =>
  changeMission(project.id, id, async (mission) => {
    const task = mission.milestones.flatMap((m) => m.tasks).find((t) => t.id === taskId);
    if (!task) throw new Error(`no task "${taskId}" on ${mission.name}`);
    if (mission.status === "closed" || mission.status === "abandoned") throw new Error(`${mission.name} is ${mission.status}; accepting a task now would resurrect it`);
    task.status = "passed";
    task.note = `accepted by Cory over the RIO: ${note}`.trim();
    if (task.claudeId) await patchSession(config.sessionsDir, `bg-${task.claudeId}`, { decision: "accepted" });
    return settle(mission);
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
     failed.push(`${repo.label}: ${whyFailed(err as Error)}`);
   }
  }
  return { landed: opened, failed };
};

/** The report, from the record, the RIO files and the ledger's log. Readable at any point; written to the mission branch at close. */
export const missionReport = async (project: Project, id: string): Promise<string> => {
  const mission = await missionOr404(project.id, id);
  const findings: Record<string, string> = {};
  for (const task of mission.milestones.flatMap((m) => m.tasks)) {
    if (task.review) findings[task.id] = await readFile(task.review.file, "utf8").catch(() => "");
  }
  // A ledger that cannot be read is said to be unread, never reported as empty.
  let log: string[] | undefined;
  try {
    log = parsePlan(await readFile(planOnBranch(project.path, mission.plan, mission.repos), "utf8")).log;
  } catch {
    log = undefined;
  }
  return reportFor(mission, findings, log);
};

/** The report file beside the plan on the mission branch. */
const reportPath = (project: Project, mission: Mission): string => planOnBranch(project.path, mission.plan, mission.repos).replace(/\.md$/, "-report.md");

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
  // The report lands beside the ledger, on the mission branch, by the same guard; a failure to write it is noted, not fatal.
  try {
    const file = reportPath(project, mission);
    await ledgerRepoFor(mission, file);
    await writeFile(file, await missionReport(project, id), "utf8");
    await commitFile(file, `mission ${mission.id}: the report`);
  } catch (err) {
    await changeMission(project.id, id, (fresh) => { fresh.trouble = [fresh.trouble, `the report could not be written: ${(err as Error).message.split("\n")[0]}`].filter(Boolean).join(" · "); }).catch(() => undefined);
  }
  return { mission, commit, ticked, pullRequests };
};

/** The page saving where the person has got to in a milestone's walkthrough, or waiving it. */
export const recordWalkthrough = async (project: Project, id: string, n: number, patch: WalkthroughPatch): Promise<Mission> => {
  const { mission, fix } = await changeMission(project.id, id, (mission): { mission: Mission; fix?: WalkFix } => {
    const m = mission.milestones.find((x) => x.n === n);
    if (!m) throw new Error(`no milestone ${n} in ${mission.name}`);
    if (patch.waive) {
      if (!patch.waive.note.trim()) throw new Error("say why the walkthrough is being waived; it is kept on the milestone");
      m.walkthrough = { ...m.walkthrough, waived: { note: patch.waive.note.trim(), at: new Date().toISOString() } };
    } else if (patch.progress) {
      const w = m.walkthrough;
      if (!w?.doc) throw new Error(`milestone ${n} has no walkthrough document to record progress in`);
      // A page that has not yet dropped what a fix round cleared would put the old failures back: those answers are not taken, the rest are.
      const cleared = lastCleared(w);
      const stale = cleared && (patch.progress.round ?? 0) < cleared.round;
      const verdicts = stale ? Object.fromEntries(Object.entries(patch.progress.verdicts).filter(([id]) => !cleared.cases.includes(id))) : patch.progress.verdicts;
      w.progress = { ...patch.progress, verdicts, answered: Object.keys(verdicts).length };
      retellWalkFix(m);
      const fix = fileWalkFix(mission, m);
      if (fix) settle(mission);
      return { mission, fix };
    }
    return { mission };
  });
  // A waiver is a decision a person made about the mission; it belongs in the ledger with the others, and so does a fix round.
  if (patch.waive) return recorded(project, mission, [`milestone ${n} walkthrough waived by Cory: ${patch.waive.note.trim()}`]);
  if (fix) return recorded(project, mission, [`milestone ${n} walk ${fix.round} failed ${fix.cases.join(", ")}: one fix task, ${fix.task}, and those cases are walked again once it merges`]);
  return mission;
};

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

/** A finding as the Result section draws it: the record, whose it is, and what Cory did with it. */
export type Reading = Finding & { key: string; taskId: string; taskTitle: string; milestone: number; state?: "read" | "later" };

/**
 * One attempt at a task as the ledger tells it: the stamps of its launch (`out`), its hand-off
 * (`built`), its review starting (`reviewed`) and its end, with how it ended. `retry` is an
 * attempt the next launch took over. The verdict and counts are the passed or handed-back line's.
 */
export type Move = { taskId: string; attempt: number; out?: string; built?: string; reviewed?: string; ended?: string; end?: "passed" | "handed-back" | "retry"; verdict?: string; counts?: FeedEntry["counts"] };

/** The JSON of `GET /api/missions/:id`, and what its stream sends on every change. */
export type MissionView = Mission & { findings: Record<string, string>; diffstat: Record<string, string>; walk: Record<number, WalkView>; summaryState: ReturnType<typeof summaryState>; word: StatusWord; questions: Question[]; feed: FeedEntry[]; readings: Reading[]; moves: Move[] };

/**
 * A task's findings as keyed records: every carried line, and for a handed-back task its findings
 * file as its verdict read it (`sortedFor`), so an unsorted line the verdict took for a blocker
 * is read as one here too.
 */
const taskFindings = (task: MissionTask, text: string | undefined): Array<Finding & { key: string }> => {
  const lines = [...(task.carried ?? [])];
  if (task.status === "handed-back" && text) {
    const { blockers, notes } = sortedFor(text, task.verdict);
    lines.push(...blockers, ...notes);
  }
  // The same line twice is the same finding: one key, one reading.
  const keyed = lines.map((line) => { const f = parseFinding(line); return { ...f, key: keyOf(f, task.id) }; });
  return [...new Map(keyed.map((f) => [f.key, f])).values()];
};

/** Every task's findings with whose they are and their state, in triage order: fix, then check, then ship, each grouped by area. */
const readingsOf = (mission: Mission, findings: Record<string, string>): Reading[] => {
  const all = mission.milestones.flatMap((m) => m.tasks.flatMap((task) => taskFindings(task, findings[task.id]).map((f): Reading =>
    ({ ...f, taskId: task.id, taskTitle: task.title, milestone: m.n, state: task.readings?.[f.key] }))));
  const { fix, check, ship } = triage(all);
  return [...fix, ...check, ...ship];
};

/**
 * Cory's mark on one finding. `later` also puts it on the mission's tracker, as one item under
 * the backlog heading written the way the mission's own items are, committed the way the board
 * commits, and says so in the ledger. The item is written before the record and only when the
 * tracker does not already hold one with its key, so a second click, or a retry after a record
 * write that failed, never writes it twice.
 */
export const markReading = async (project: Project, id: string, taskId: string, key: string, state: "read" | "later"): Promise<Mission> => {
  if (state !== "read" && state !== "later") throw new Error(`a finding is marked "read" or "later", not "${String(state)}"`);
  const fresh = await missionOr404(project.id, id);
  const found = taskOn(fresh, taskId);
  if (!found) throw new Error(`no task "${taskId}" on ${fresh.name}`);
  const { findings } = await statsOf(fresh, (t) => t.id === taskId, false);
  const finding = taskFindings(found, findings[taskId]).find((f) => f.key === key);
  if (!finding) throw new Error(`no finding "${key}" on ${taskId}`);
  if (state === "later") {
    const tracker = project.trackers[fresh.trackerIndex];
    if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${fresh.trackerIndex}`);
    const before = await readFile(tracker.path, "utf8");
    const board = parseTracker(before);
    if (!allItems(board).some((i) => i.fields.finding === key)) {
      const section = board.sections.find((s) => BACKLOG.test(s.heading));
      if (!section) throw new Error(`${tracker.label} has no ${BACKLOG.source} section to write into`);
      const block = itemBlock(finding.headline, { created: today(), source: `mission ${id}, ${found.title}`, mission: id, area: finding.area, finding: key }, finding.detail ? [finding.detail] : []);
      await writeFile(tracker.path, addItem(before, section.heading, "", block), "utf8");
      await commitFile(tracker.path, `console: later from mission "${fresh.name}": ${finding.headline}`);
    }
  }
  let was: "read" | "later" | undefined;
  const mission = await changeMission(project.id, id, (mission) => {
    const task = taskOn(mission, taskId);
    if (!task) throw new Error(`no task "${taskId}" on ${mission.name}`);
    was = task.readings?.[key];
    task.readings = { ...task.readings, [key]: state };
    return mission;
  });
  return state === "later" && was !== "later" ? recorded(project, mission, [`${taskId} finding "${finding.headline}" marked later by Cory`]) : mission;
};

/**
 * Findings marked read, or read ones handed back to unread, across any of the mission's tasks in
 * one write: a bucket's "mark all read" and the undo after a mark. `later` is not here: it writes an
 * item and a commit to the tracker per finding, and taking that back is the board's job, not an
 * undo's. A finding on the checklist stays there, so unread refuses it rather than leave the two
 * disagreeing.
 */
export const markReadings = async (project: Project, id: string, byTask: Record<string, string[]>, state: "read" | "unread"): Promise<Mission> => {
  if (state !== "read" && state !== "unread") throw new Error(`findings are marked "read" or "unread" together, not "${String(state)}"`);
  const named = Object.entries(byTask).filter(([, keys]) => keys.length);
  if (!named.length) throw new Error("no findings named to mark");
  const fresh = await missionOr404(project.id, id);
  for (const [taskId] of named) if (!taskOn(fresh, taskId)) throw new Error(`no task "${taskId}" on ${fresh.name}`);
  const { findings } = await statsOf(fresh, (t) => named.some(([taskId]) => taskId === t.id), false);
  for (const [taskId, keys] of named) {
    const known = new Set(taskFindings(taskOn(fresh, taskId)!, findings[taskId]).map((f) => f.key));
    const unknown = keys.find((k) => !known.has(k));
    if (unknown) throw new Error(`no finding "${unknown}" on ${taskId}`);
  }
  return changeMission(project.id, id, (mission) => {
    for (const [taskId, keys] of named) {
      const task = taskOn(mission, taskId);
      if (!task) throw new Error(`no task "${taskId}" on ${mission.name}`);
      const readings = { ...task.readings };
      for (const key of keys) {
        if (readings[key] === "later") throw new Error(`"${key}" is on the checklist; take it off there, not here`);
        if (state === "read") readings[key] = "read";
        else delete readings[key];
      }
      task.readings = readings;
    }
    return mission;
  });
};

/**
 * Ask a read-only session for the three things Cory must read, from the report and the findings.
 * Refused before anything has merged, and while one is already running. A file an earlier summary
 * left is removed first, so the sweep never reads it as this one's. The checks and the claim go
 * through the retried change; the spawn does not, so a refused write never spawns twice, and the
 * id is recorded on whatever record is fresh once the session is up.
 */
export const summarizeMission = async (project: Project, id: string): Promise<Mission> => {
  const cfg = await missionConfigFor(project.path);
  const started = new Date().toISOString();
  let previous: string | undefined;
  const mission = await changeMission(project.id, id, (mission) => {
    if (!mission.milestones.some((m) => m.merged)) throw new Error(`${mission.name} has merged nothing yet, so there is nothing to summarize`);
    if (summarizing(mission)) throw new Error(`${mission.name} is already being summarized, since ${mission.summary!.started}`);
    previous = mission.summary?.claudeId;
    mission.summary = { started };
    return mission;
  });
  // The last summarizer, if one is still up, is forgotten by the claim above; nothing reads it again.
  if (previous) await stopAgent(previous);
  const file = summaryFile(mission);
  let claudeId: string;
  try {
    const [{ findings }, log] = await Promise.all([statsOf(mission, undefined, false), ledgerLog(project, mission)]);
    const brief = summaryBrief({ missionName: mission.name, report: reportFor(mission, findings, log), readings: readingsOf(mission, findings), file });
    await rm(file, { force: true });
    claudeId = await spawnBackgroundAgent(project.path, `summary · ${mission.name}`, brief, cfg.rioAgent, RIO_TOOLS);
  } catch (err) {
    // The claim is on disk and no session is behind it: say why, and leave the button live.
    return changeMission(project.id, id, (fresh) => {
      if (fresh.summary?.started === started) fresh.summary.failed = `could not start the summarizer: ${(err as Error).message}`;
      return fresh;
    });
  }
  agentCache.delete(project.path);
  return changeMission(project.id, id, (fresh) => {
    if (fresh.summary?.started === started) fresh.summary.claudeId = claudeId;
    return fresh;
  });
};

/** Where the ledger is once a mission is approved: the plan on the mission branch. Null before that, or when the plan names no repo. */
export const ledgerPath = (project: Project, mission: Mission): string | null => {
  if (!mission.approved) return null;
  try {
    return planOnBranch(project.path, mission.plan, mission.repos);
  } catch {
    return null;
  }
};

/** The ledger's log for the view: a plain read, empty before approval or when the file cannot be read, never a throw. */
const ledgerLog = async (project: Project, mission: Mission): Promise<string[]> => {
  const ledger = ledgerPath(project, mission);
  if (!ledger) return [];
  return readFile(ledger, "utf8").then((text) => parsePlan(text).log, () => []);
};

/**
 * Each task's RIO findings and diff stat, both remembered once the task has settled. `only`
 * narrows it to the tasks a caller will read, and `diff: false` skips git altogether: the
 * workspace and the question poll want far less than the page, and a stat is a git spawn.
 */
const statsOf = async (mission: Mission, only: (task: MissionTask) => boolean = () => true, diff = true): Promise<{ findings: Record<string, string>; diffstat: Record<string, string> }> => {
  const findings: Record<string, string> = {};
  const diffstat: Record<string, string> = {};
  const settled = (task: MissionTask) => task.status === "passed" || task.status === "handed-back";
  await Promise.all(mission.milestones.flatMap((m) => m.tasks).filter(only).map(async (task) => {
    if (task.review) {
      const text = await remembered(`findings:${task.review.file}`, () => readFile(task.review!.file, "utf8").catch(() => ""), settled(task));
      if (text) findings[task.id] = text;
    }
    if (diff && task.branch) {
      const repo = mission.repos.find((r) => r.label === task.repo);
      const from = task.base ?? repo?.branch;
      if (!repo || !from) return;
      const stat = await remembered(`diff:${repo.path}:${from}..${task.branch}`, () => diffStat(repo.path, from, task.branch!), settled(task) && Boolean(task.base));
      if (stat) diffstat[task.id] = stat;
    }
  }));
  return { findings, diffstat };
};

/** What every view derives from the record the same way: the findings and stats it asked for, the questions, the word. */
const asked = async (mission: Mission, only?: (task: MissionTask) => boolean, diff = true): Promise<{ findings: Record<string, string>; diffstat: Record<string, string>; questions: Question[]; word: StatusWord }> => {
  const { findings, diffstat } = await statsOf(mission, only, diff);
  const questions = questionsOf({ ...mission, findings });
  return { findings, diffstat, questions, word: statusWord(mission, questions) };
};

/**
 * Each task's attempts, read off the feed's transitions (`FeedEntry.move`, which a person's words
 * never carry). Every move to `flying` is a launch and opens the next attempt, ending the one
 * before as a `retry` unless it already ended. Leaving `flying` is the hand-off, whether the sweep
 * saw `built` or went straight on to `reviewing`. A pass or hand-back ends the attempt with its
 * verdict and counts, and a later pass (Cory accepting a handed-back task) replaces that end. A
 * task the plan does not hold has no attempts. Pure.
 */
export const movesOf = (feed: FeedEntry[], mission: Mission): Move[] => {
  const planned = mission.milestones.flatMap((m) => m.tasks.map((t) => t.id));
  const inPlan = new Set(planned);
  const byTask = new Map<string, Move[]>();
  for (const entry of feed) {
    const move = entry.move;
    if (!move || !inPlan.has(move.taskId)) continue;
    const { taskId, was, now, verdict } = move;
    const moves = byTask.get(taskId) ?? [];
    byTask.set(taskId, moves);
    const last = moves.at(-1);
    if (now === "flying") {
      if (last && !last.end) Object.assign(last, { ended: entry.at, end: "retry" });
      moves.push({ taskId, attempt: moves.length + 1, out: entry.at });
    } else if (last && (now === "passed" || now === "handed-back")) {
      if (was === "flying") last.built ??= entry.at;
      Object.assign(last, { ended: entry.at, end: now }, verdict ? { verdict } : {}, entry.counts ? { counts: entry.counts } : {});
    } else if (last && !last.end) {
      if (was === "flying") last.built ??= entry.at;
      if (now === "reviewing") last.reviewed ??= entry.at;
    }
  }
  return planned.flatMap((id) => byTask.get(id) ?? []);
};

export const missionView = async (project: Project, id: string): Promise<MissionView> => {
  const mission = await missionOr404(project.id, id);
  const [{ findings, diffstat, questions, word }, log] = await Promise.all([asked(mission), ledgerLog(project, mission)]);
  const walk = Object.fromEntries(mission.milestones.map((m) => [m.n, { state: walkthroughState(m), needed: needsWalking(m) }]));
  const feed = feedOf(log, mission);
  return { ...mission, findings, diffstat, walk, summaryState: summaryState(mission), word, questions, feed, readings: readingsOf(mission, findings), moves: movesOf(feed, mission), leadBusy: leadBusy(mission), waiting: waitingOn(mission), proved: mission.milestones.filter((m) => proved(mission, m)).map((m) => m.n), updates: updatesOf(feed, mission) };
};

/** A mission as the workspace lists it: the record, what it asks, its word, and its merged diff as one line. */
export type WorkspaceMission = Mission & { word: StatusWord; questions: Question[]; diffstat: string };

/** A task's stat read the way the result page reads it: its totals line, and each file with its changed lines. */
type ReadStat = { order: number; plus: number; minus: number; files: Array<{ path: string; changes: number | null }> };
const readStat = (stat: string, order: number): ReadStat => {
  const lines = stat.trim().split("\n");
  const last = lines.at(-1) ?? "";
  const files = lines.slice(0, -1).flatMap((line) => {
    const m = line.match(/^\s*(.+?)\s+\|\s+(\d+|Bin)\b/);
    // A rename is drawn `src/{old => new}/a.ts` or `old => new`; the file is where it went.
    const path = m?.[1].replace(/\{[^{}]*? => ([^{}]*)\}/g, "$1").replace(/\/\/+/g, "/").replace(/^.* => /, "");
    return m && path ? [{ path, changes: m[2] === "Bin" ? null : Number(m[2]) }] : [];
  });
  return { order, files, plus: Number(last.match(/(\d+) insertions?\(\+\)/)?.[1] ?? 0), minus: Number(last.match(/(\d+) deletions?\(-\)/)?.[1] ?? 0) };
};

/**
 * Whether `a` is a sibling that `b` merged into its own branch: every file of `a` is in `b`'s stat
 * with the same count of changed lines. The same test as `inside` in web/mission/result.js, so the
 * workspace's total and the mission page's agree.
 */
const inside = (a: ReadStat, b: ReadStat): boolean => a.files.length > 0 && a !== b
  && a.files.every((f) => b.files.some((g) => g.path === f.path && g.changes === f.changes))
  && (b.files.length > a.files.length || b.order > a.order);

/**
 * `+N −M` over the passed tasks of merged milestones. A task that merged a sibling (a `needs:`)
 * carries the sibling's lines in its own stat, so each task counts only its diff less the
 * outermost siblings inside it, as the mission page's result does. Empty when nothing has merged
 * or git gave no stat for any of it.
 */
const mergedStat = (mission: Mission, diffstat: Record<string, string>): string => {
  const stats = mission.milestones.filter((m) => m.merged).flatMap((m) => m.tasks).filter((t) => t.status === "passed")
    .map((t) => diffstat[t.id]).filter(Boolean).map(readStat);
  if (!stats.length) return "";
  let plus = 0;
  let minus = 0;
  for (const t of stats) {
    const within = stats.filter((a) => inside(a, t));
    // Only the outermost: a sibling inside another sibling is already in that one's count.
    const direct = within.filter((a) => !within.some((b) => inside(a, b)));
    plus += t.plus - direct.reduce((n, a) => n + a.plus, 0);
    minus += t.minus - direct.reduce((n, a) => n + a.minus, 0);
  }
  return `+${plus} −${minus}`;
};

/** The tasks a question reads findings for, and the merged total reads stats for; the rest of a mission is not asked. */
const askedAbout = (mission: Mission): ((task: MissionTask) => boolean) => {
  const merged = new Set(mission.milestones.filter((m) => m.merged).flatMap((m) => m.tasks));
  return (task) => task.status === "handed-back" || (task.status === "passed" && merged.has(task));
};

/** Every mission in the project as the workspace draws it, so a row can say what it asks without opening it. */
export const workspaceMissions = async (project: Project): Promise<WorkspaceMission[]> =>
  Promise.all((await listMissions(project.id)).map(async (mission) => {
    const { diffstat, questions, word } = await asked(mission, askedAbout(mission));
    // A row draws none of the chat, and the workspace polls; the conversation stays on the mission page.
    const { chat: _chat, lead: _lead, ...row } = mission;
    return { ...row, word, questions, diffstat: mergedStat(mission, diffstat) };
  }));

/** What a mission asks, and nothing else: no sweep, no git, findings only for what is handed back. The notification poll reads this. */
export const missionQuestions = async (project: Project): Promise<Array<{ id: string; name: string; questions: Question[] }>> =>
  Promise.all((await listMissions(project.id)).map(async (mission) => {
    const { questions } = await asked(mission, (task) => task.status === "handed-back", false);
    return { id: mission.id, name: mission.name, questions };
  }));
