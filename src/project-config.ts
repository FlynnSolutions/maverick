/**
 * What a project tells Maverick about how to fly a mission in it, from its own `maverick.json`.
 *
 * This exists because a project that already has worktree tooling has it for a reason.
 * A project on this machine carries a `worktree.sh` whose own header says it was written
 * because two contradictory naming conventions collided; Maverick inventing a third would be
 * that mistake a second time. So the layout, the branch names, the base branch per repo and what
 * "done" does with the work are the project's to declare, and Maverick's defaults apply only
 * to a project that declares nothing.
 *
 * `src/theme.ts` reads the same file for the palette. Two small readers of one small file is
 * the trade for keeping the theme's validation where it is.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * What a finished mission does with its work.
 * - `merge` leaves it on the repo's own mission branch, for a person to take from there.
 * - `pr` pushes the branch and opens a pull request against the base, and merges nothing.
 * - `push` advances the base to it. Only ever for a repo whose own process already says so,
 *   and only ever as a per-repo override: a contract package that is the shared source of
 *   truth between two services, and is meant to be on `main` before either of them starts,
 *   while those services themselves sit under an absolute never-self-merge rule.
 */
export type Landing = "merge" | "pr" | "push";

export interface RepoConfig {
  /** The branch a task's work is cut from and lands against. Defaults to the repo's current HEAD branch. */
  base?: string;
  /** Overrides the mission's landing for this repo alone. See `Landing`. */
  land?: Landing;
  /** Skip this repo when a mission does not name it. Purely documentation; the plan decides. */
  note?: string;
}

export interface MissionConfig {
  /**
   * The Claude Code agent a Wingman runs as, by name. M5 is explicit that a level's boundary
   * is enforced by its allowed-tools list and not by its prompt, and without this a Wingman
   * runs with every tool and auto-approval, held only by prose. The agent belongs to the
   * project being flown, since that is where the boundary has to be true.
   */
  wingmanAgent?: string;
  /** The agent a RIO runs as. `auditor` by convention: it reads and judges, it never fixes. */
  rioAgent: string;
  /** Where worktrees go, relative to the project root. */
  worktrees: string;
  /** Prefix for a task's branch: `<prefix><mission>-<task>`. */
  branchPrefix: string;
  /** `merge` lands milestones on the mission branch; `pr` opens one pull request per repo and stops. */
  land: Landing;
  /** Per repo, keyed by the label `reposUnder` gives it (a directory name, or "root"). */
  repos: Record<string, RepoConfig>;
}

export const DEFAULT_MISSION_CONFIG: MissionConfig = {
  rioAgent: "auditor",
  worktrees: join(".claude", "worktrees"),
  branchPrefix: "mission/",
  land: "merge",
  repos: {},
};

const isLanding = (v: unknown): v is Landing => v === "merge" || v === "pr" || v === "push";

/**
 * `push` is refused here and only here. It is the one value that moves a shared branch on a
 * remote, and the whole argument for allowing it at all (M10) is that a repo opts into it by
 * name. Read at the mission level it would apply to every repo the plan touches, which is
 * exactly what the per-repo rule exists to prevent, and a `land` key one level too high is an
 * easy thing to write by hand.
 */
const missionLanding = (v: unknown): Landing =>
  v === "push" || !isLanding(v) ? DEFAULT_MISSION_CONFIG.land : v;

/**
 * A branch prefix reaches `git branch` as argv and is the difference between a mission branch
 * and the base itself. An empty one puts a mission called "Main" on `main`; one starting with
 * `-` is read by git as bundled short options. Neither is worth guessing at, so anything that
 * is not plainly a prefix falls back to Maverick's own.
 */
const BRANCH_PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]*[/-]$/;
const branchPrefix = (v: unknown): string =>
  typeof v === "string" && BRANCH_PREFIX.test(v) && !v.includes("..") ? v : DEFAULT_MISSION_CONFIG.branchPrefix;

const AGENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** A base is a branch name, so it is a string that git will not read as a flag or a path trick. */
const REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;
const repoConfigs = (v: unknown): Record<string, RepoConfig> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, RepoConfig> = {};
  for (const [label, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const cfg: RepoConfig = {};
    if (typeof r.base === "string" && REF.test(r.base) && !r.base.includes("..")) cfg.base = r.base;
    // Here `push` is honoured: this is the per-repo opt-in by name that M10 requires.
    if (isLanding(r.land)) cfg.land = r.land;
    if (typeof r.note === "string") cfg.note = r.note;
    out[label] = cfg;
  }
  return out;
};

export const missionConfigFor = async (projectPath: string): Promise<MissionConfig> => {
  let raw: { missions?: Partial<MissionConfig> };
  try {
    raw = JSON.parse(await readFile(join(projectPath, "maverick.json"), "utf8")) as { missions?: Partial<MissionConfig> };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return DEFAULT_MISSION_CONFIG;
  }
  const m = raw.missions;
  if (!m) return DEFAULT_MISSION_CONFIG;
  // A relative path only: a worktree root outside the project is not this tool's business.
  const worktrees = typeof m.worktrees === "string" && !m.worktrees.startsWith("/") && !m.worktrees.includes("..")
    ? m.worktrees
    : DEFAULT_MISSION_CONFIG.worktrees;
  return {
    // An agent name reaches the CLI as argv, so it is a name or it is nothing.
    ...(typeof m.wingmanAgent === "string" && AGENT.test(m.wingmanAgent) ? { wingmanAgent: m.wingmanAgent } : {}),
    rioAgent: typeof m.rioAgent === "string" && AGENT.test(m.rioAgent) ? m.rioAgent : DEFAULT_MISSION_CONFIG.rioAgent,
    worktrees,
    branchPrefix: branchPrefix(m.branchPrefix),
    land: missionLanding(m.land),
    repos: repoConfigs(m.repos),
  };
};
