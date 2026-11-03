/**
 * Keep the server up, and say why it went down. The app used to import `server.ts` into its own
 * process, so a crash took the app with it, and what the server printed went nowhere a person
 * could read: on 2026-10-30 the console on 8766 died mid-session and nothing brought it back or
 * said why (decisions M31). Here the server is a child process: everything it prints goes to one
 * log file, a death is written there with its exit code or signal, how long it ran and the last
 * thing it said, and it is started again after a pause that grows with each death in a row. A
 * server that keeps dying fast is given up on with that reason, rather than restarted forever.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { dirname } from "node:path";

export interface SuperviseOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** The log every line the server prints goes to, and every death and restart. */
  log: string;
  /** Deaths inside `window` ms before it is given up on. */
  maxDeaths?: number;
  window?: number;
  /** Pause before restart `n` (1-based). */
  delay?: (n: number) => number;
  /** Called once when it is given up on, with the line that says why. */
  onGiveUp?: (why: string) => void;
}

export interface Supervised {
  /** Stop for good: the child is killed and not started again. */
  stop: () => void;
  /** The child's pid, while one is running. */
  pid: () => number | undefined;
}

/** What a death leaves in the log, past the server's own lines: the last of what it printed. */
const TAIL_LINES = 40;
/** A log past this is cut back to nothing at start, so it never fills the disk. */
const LOG_CAP_BYTES = 10 * 1024 * 1024;

const backoff = (n: number): number => Math.min(1000 * 2 ** (n - 1), 30_000);

const lasted = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${s % 60}s` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};

export const supervise = (o: SuperviseOptions): Supervised => {
  const { maxDeaths = 5, window = 60_000, delay = backoff } = o;
  mkdirSync(dirname(o.log), { recursive: true });
  try { if (statSync(o.log).size > LOG_CAP_BYTES) truncateSync(o.log, 0); } catch { /* no log yet */ }
  const write = (text: string) => appendFileSync(o.log, text);
  const note = (line: string) => write(`${new Date().toISOString()} supervisor: ${line}\n`);

  let child: ChildProcess | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const deaths: number[] = [];

  const start = () => {
    const began = Date.now();
    let tail: string[] = [];
    const keep = (chunk: Buffer) => {
      const text = chunk.toString();
      write(text);
      tail = [...tail, ...text.split("\n").filter(Boolean)].slice(-TAIL_LINES);
    };
    child = spawn(o.command, o.args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"] });
    note(`started ${o.args.join(" ")} (pid ${child.pid})`);
    child.stdout!.on("data", keep);
    child.stderr!.on("data", keep);
    child.on("error", (err) => note(`could not start: ${err.message}`));
    child.on("exit", (code, signal) => {
      child = undefined;
      if (stopped) return note(`stopped (${signal ?? `code ${code}`})`);
      const now = Date.now();
      deaths.push(now);
      while (deaths.length && now - deaths[0] > window) deaths.shift();
      const how = signal ? `killed by ${signal}` : `exited with code ${code}`;
      const last = tail.length ? `; its last words:\n${tail.map((l) => `    ${l}`).join("\n")}` : "; it printed nothing";
      if (deaths.length >= maxDeaths) {
        const why = `the server ${how} after ${lasted(now - began)}, ${deaths.length} deaths inside ${lasted(window)}, so it is not started again`;
        note(`${why}${last}`);
        o.onGiveUp?.(why);
        return;
      }
      const wait = delay(deaths.length);
      note(`the server ${how} after ${lasted(now - began)}; starting it again in ${lasted(wait)}${last}`);
      timer = setTimeout(start, wait);
    });
  };
  start();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      child?.kill();
    },
    pid: () => child?.pid,
  };
};
