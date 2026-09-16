/**
 * Where a session process lives: its tty, how long it has run, and the application at the
 * top of its ancestry (Warp, Terminal, iTerm, Code, ...), so a forgotten tab is nameable.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ProcessHome {
  tty?: string;
  elapsed?: string;
  app?: string;
}

interface PsLine { ppid: number; tty: string; etime: string; comm: string }

/**
 * The whole process table, read in one call and held for a beat.
 *
 * Walking ancestry used to spawn a `ps` per pid: every session's parent chain and its terminal
 * app, about ten spawns each, so a page of thirty sessions cost nearly three hundred processes
 * and `/api/sessions/all` took eight seconds. One `ps -e` returns all eleven hundred lines in a
 * tenth of a second, and every lookup after that is a map read. The window only has to cover a
 * single request's burst of lookups; ancestry does not change inside one, and a session that
 * appears mid-window is picked up by the next poll.
 */
const TABLE_MS = 1500;
/**
 * The promise is what is cached, not the map. A request asks about thirty sessions at once, so
 * caching only the settled result lets all thirty miss the empty cache and spawn their own
 * `ps -e` in parallel: measured, that turned one 110ms call into 3.9 seconds of stampede.
 * Holding the in-flight read means the first caller pays for it and the rest await the same one.
 */
let table: { at: number; rows: Promise<Map<number, PsLine>> } | null = null;

const readTable = async (): Promise<Map<number, PsLine>> => {
  const rows = new Map<number, PsLine>();
  try {
    const { stdout } = await run("ps", ["-eo", "pid=,ppid=,tty=,etime=,comm="], { maxBuffer: 8 * 1024 * 1024 });
    for (const line of stdout.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
      if (m) rows.set(Number(m[1]), { ppid: Number(m[2]), tty: m[3], etime: m[4], comm: m[5] });
    }
  } catch {
    /* no table: every lookup misses, which reads the same as a dead process */
  }
  return rows;
};

const processTable = (): Promise<Map<number, PsLine>> => {
  if (table && Date.now() - table.at < TABLE_MS) return table.rows;
  table = { at: Date.now(), rows: readTable() };
  return table.rows;
};

const psLine = async (pid: number): Promise<PsLine | null> => (await processTable()).get(pid) ?? null;

const appName = (comm: string): string | undefined => {
  const app = comm.match(/\/([^/]+)\.app\//)?.[1];
  if (app) return app;
  const base = comm.split("/").pop() ?? comm;
  if (/^-?(zsh|bash|fish|sh)$/.test(base)) return undefined;
  return base;
};

/** The pids above `pid`, nearest first, up to `depth` levels. */
export const parentChain = async (pid: number, depth = 5): Promise<number[]> => {
  const chain: number[] = [];
  let current = pid;
  for (let i = 0; i < depth; i += 1) {
    const line = await psLine(current);
    if (!line || line.ppid <= 1) break;
    chain.push(line.ppid);
    current = line.ppid;
  }
  return chain;
};

/** Bring a terminal app to the front; the tab inside it is not scriptable, so the caller names the tty. */
export const focusApp = async (app: string): Promise<void> => {
  await run("osascript", ["-e", `tell application "${app.replace(/"/g, "")}" to activate`]);
};

export const processHome = async (pid: number): Promise<ProcessHome> => {
  const self = await psLine(pid);
  if (!self) return {};
  const home: ProcessHome = { tty: self.tty === "??" ? undefined : self.tty, elapsed: self.etime };
  let cursor = self.ppid;
  for (let depth = 0; depth < 6 && cursor > 1; depth += 1) {
    const parent = await psLine(cursor);
    if (!parent) break;
    const name = appName(parent.comm);
    if (name && name !== "claude" && name !== "node") {
      home.app = name;
      break;
    }
    cursor = parent.ppid;
  }
  return home;
};
