/** A throwaway git repo with an identity and one empty base commit: what every git-backed test starts from. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tempRepo = (prefix: string, branch = "main"): { dir: string; git: (...args: string[]) => string } => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-`)));
  const git = (...args: string[]): string => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", branch);
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  git("commit", "-q", "--allow-empty", "-m", "base");
  return { dir, git };
};
