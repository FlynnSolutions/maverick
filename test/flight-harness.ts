/**
 * What a test of the real sweep sets up before it imports `src/missions.ts`: throwaway folders, the
 * environment `src/config.ts` reads once, and a fake `claude` first on PATH that logs every spawn
 * with its folder and arguments, fields ending in NUL and a record in 0x1e, because a brief holds
 * anything else. Call it before the dynamic imports. `test/mission-flight.test.ts` keeps its own
 * copy, because that file is the before half of a before and after and no later change may touch it.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

export const flightHarness = (prefix: string, extraCase = "") => {
  const made: string[] = [];
  const scratch = (name: string): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-${name}-`)));
    made.push(dir);
    return dir;
  };
  const sessions = scratch("sessions");
  process.env.SESSION_CONSOLE_SESSIONS = sessions;
  process.env.SESSION_CONSOLE_HOME = scratch("home");
  process.env.CLAUDE_CONFIG_DIR = scratch("claude");
  const bin = scratch("bin");
  const log = join(bin, "spawns");
  const listing = join(bin, "agents.json");
  writeFileSync(join(bin, "claude"), `#!/bin/sh
case "$1" in
  agents) cat "${listing}"; exit 0 ;;
  stop) exit 0 ;;${extraCase ? `\n  ${extraCase}` : ""}
esac
n=$(( $(cat "${bin}/count" 2>/dev/null || echo 160) + 1 )); echo "$n" > "${bin}/count"
id=$(printf '%x' "$n")
printf '%s\\0' "$id" "$(pwd)" "$@" >> "${log}"; printf '\\036' >> "${log}"
echo "backgrounded · $id"
`, "utf8");
  chmodSync(join(bin, "claude"), 0o755);
  const realPath = process.env.PATH;
  process.env.PATH = `${bin}:${realPath}`;
  after(() => {
    process.env.PATH = realPath;
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });
  /** Every spawn so far, oldest first. */
  const spawned = () => (existsSync(log) ? readFileSync(log, "utf8").split("\x1e").slice(0, -1) : []).map((record) => {
    const [id, cwd, ...args] = record.split("\0").slice(0, -1);
    return { id, cwd, args };
  });
  return { made, scratch, sessions, bin, log, listing, spawned };
};

export const valueOf = (args: string[], flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
