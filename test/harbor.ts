/**
 * Harbor: an invented project in a throwaway git repo, with a real `node server.ts` over it.
 * Every write the board makes is a commit in the tracker's own repo, so the only proof a write
 * worked is the commit; this is what lets a test (or CI's page check) make one and read it back.
 * Nothing here is real: the repo, the tracker, HOME and `claude` are all made up for the run.
 *
 * Run by hand: `node test/harbor.ts` prints the URL and the repo, and serves until killed.
 */
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo } from "./fixtures.ts";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const TRACKER = `# Harbor checklist

## 🔥 Priority

### Docks

- [ ] \`[ENG]\` **Tide table on the dock page**
  - created: 2026-10-01
  The dock page shows the next two tides.

- [ ] \`[ENG]\` **Berth numbers on the map**
  - created: 2026-10-02

## 🚧 In progress

- [ ] \`[ENG]\` **Ferry timetable import**
  - created: 2026-10-03

## 📋 Backlog

- [ ] \`[OPS]\` **Rotate the harbor master's key**
  - created: 2026-10-04

## ✅ Shipped

- [x] \`[ENG]\` **Buoy colours**
  - created: 2026-09-20
`;

export interface Harbor {
  url: string;
  repo: string;
  tracker: string;
  /** Where the fake `claude` writes what it was asked to do. */
  claudeDir: string;
  sessions: string;
  git: (...args: string[]) => string;
  /** The subject of the newest commit in the repo. */
  head: () => string;
  stop: () => Promise<void>;
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** A `claude` that lists no agents and backgrounds every spawn under one id, recording its arguments. */
const fakeClaude = (dir: string): void => {
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh
if [ "$1" = agents ]; then echo '[]'; exit 0; fi
printf '%s\\0' "$@" >> "${dir}/spawns"
echo "backgrounded · a7b0c"
`, "utf8");
  chmodSync(bin, 0o755);
};

/** The caller's environment without anything that would point the server back at the real machine. */
const isolatedEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|SESSION_CONSOLE_|MAVERICK_)/.test(k)));

/** Ready is the board answering for harbor, which also proves the registry was read; an exit first is the failure, with what it printed. */
const ready = async (url: string, child: ReturnType<typeof spawn>, log: () => string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the harbor server exited ${child.exitCode} before it answered:\n${log()}`);
    if (await fetch(`${url}/api/board?project=harbor`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the harbor server did not answer in 15s:\n${log()}`);
};

export const startHarbor = async (): Promise<Harbor> => {
  const scratch = mkdtempSync(join(tmpdir(), "mv-harbor-"));
  const home = join(scratch, "home");
  const consoleHome = join(home, ".claude", "session-console");
  const sessions = join(home, ".claude", "console-sessions");
  const claudeDir = join(scratch, "bin");
  const agents = join(home, ".claude", "agents");
  for (const d of [consoleHome, sessions, claudeDir, agents]) mkdirSync(d, { recursive: true });
  fakeClaude(claudeDir);
  // The gate refuses a mission whose RIO has no standing orders, as it would on a fresh machine.
  writeFileSync(join(agents, "rio.md"), "---\nname: rio\ndescription: the harbor's reviewer\n---\nRead, run, judge.\n", "utf8");

  const { dir: repo, git } = tempRepo("mv-harbor-repo");
  const tracker = join(repo, "deliverables", "CHECKLIST.md");
  mkdirSync(dirname(tracker), { recursive: true });
  writeFileSync(tracker, TRACKER, "utf8");
  git("add", ".");
  git("commit", "-q", "-m", "harbor: the checklist");
  writeFileSync(join(consoleHome, "projects.json"), JSON.stringify([{ id: "harbor", name: "Harbor", path: repo, trackers: [{ label: "CHECKLIST", path: tracker }] }]), "utf8");

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.ts"], {
    cwd: serverRoot,
    env: { ...isolatedEnv(), HOME: home, SESSION_CONSOLE_HOME: consoleHome, SESSION_CONSOLE_SESSIONS: sessions, SESSION_CONSOLE_PORT: String(port), PATH: `${claudeDir}:${process.env.PATH}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Kept only until it answers, for the error; after that the output is drained and dropped.
  let log = "";
  const keep = (d: Buffer) => { log += d; };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  await ready(url, child, () => log);
  child.stdout.off("data", keep).resume();
  child.stderr.off("data", keep).resume();

  return {
    url,
    repo,
    tracker,
    claudeDir,
    sessions,
    git,
    head: () => git("log", "-1", "--format=%s").trim(),
    stop: async () => {
      if (child.exitCode === null) await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
      rmSync(scratch, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    },
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const harbor = await startHarbor();
  console.log(`harbor: ${harbor.url}/?project=harbor`);
  console.log(`  repo: ${harbor.repo}`);
  const stop = () => { harbor.stop().then(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
