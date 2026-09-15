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

const psLine = async (pid: number): Promise<{ ppid: number; tty: string; etime: string; comm: string } | null> => {
  try {
    const { stdout } = await run("ps", ["-o", "ppid=,tty=,etime=,comm=", "-p", String(pid)]);
    const m = stdout.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) return null;
    return { ppid: Number(m[1]), tty: m[2], etime: m[3], comm: m[4] };
  } catch {
    return null;
  }
};

const appName = (comm: string): string | undefined => {
  const app = comm.match(/\/([^/]+)\.app\//)?.[1];
  if (app) return app;
  const base = comm.split("/").pop() ?? comm;
  if (/^-?(zsh|bash|fish|sh)$/.test(base)) return undefined;
  return base;
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
