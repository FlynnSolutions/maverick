/**
 * What a project tells Maverick about how to fly a mission in it, from its own `maverick.json`.
 *
 * This exists because a project that already has worktree tooling has it for a reason.
 * Realtime's `claude/scripts/worktree.sh` says in its own header that it was written because
 * two contradictory naming conventions collided; Maverick inventing a third would be that
 * mistake a second time. So the layout, the branch names, the base branch per repo and what
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
 *   and only ever as a per-repo override: Realtime's `contracts` is the shared source of truth
 *   between its two services and is meant to be on `main` before either starts, while those
 *   services are under an absolute never-self-merge rule.
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
  /** Where worktrees go, relative to the project root. */
  worktrees: string;
  /** Prefix for a task's branch: `<prefix><mission>-<task>`. */
  branchPrefix: string;
  /** `merge` lands milestones on the mission branch; `pr` opens one pull request per repo and stops. */
  land: Landing;
  /** Per repo, keyed by the label `reposUnder` gives it (a directory name, or "root"). */
  repos: Record<string, RepoConfig>;
  /** True when the project said nothing and these are Maverick's own defaults. */
  implicit: boolean;
}

export const DEFAULT_MISSION_CONFIG: MissionConfig = {
  worktrees: join(".claude", "worktrees"),
  branchPrefix: "mission/",
  land: "merge",
  repos: {},
  implicit: true,
};

const isLanding = (v: unknown): v is Landing => v === "merge" || v === "pr" || v === "push";

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
    worktrees,
    branchPrefix: typeof m.branchPrefix === "string" ? m.branchPrefix : DEFAULT_MISSION_CONFIG.branchPrefix,
    land: isLanding(m.land) ? m.land : DEFAULT_MISSION_CONFIG.land,
    repos: m.repos && typeof m.repos === "object" ? m.repos : {},
    implicit: false,
  };
};
