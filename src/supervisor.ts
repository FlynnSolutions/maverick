/**
 * Keep the server up, and say why it went down. The app used to import `server.ts` into its own
 * process, so a crash took the app with it, and what the server printed went nowhere a person
 * could read: on 2026-10-30 the console on 8766 died mid-session and nothing brought it back or
 * said why (decisions M31). Here the server is a child process: everything it prints goes to one
 * log file, a death is written there with its exit code or signal, how long it ran and the last
 * thing it said, and it is started again after a pause that grows with each death in a row. A
 * server that keeps dying fast is given up on with that reason, rather than restarted forever.
 *
 * The child is started with `MAVERICK_SUPERVISED=1` and its stdin a pipe from here; `server.ts`
 * exits when that pipe closes, so a supervisor that dies without a word (a kill -9, a crash)
 * takes its server with it rather than leaving one on the port that nothing watches.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync, renameSync, statSync, writeSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SuperviseOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** The log every byte the server prints goes to, and every death and restart. */
  log: string;
  /** Deaths inside a minute before it is given up on. */
  maxDeaths?: number;
  /** Pause before restart `n` (1-based). */
  delay?: (n: number) => number;
  /** Called once when it is given up on, with the line that says why. */
  onGiveUp?: (why: string) => void;
}

/** What a death leaves in the log, past the server's own lines: the last of what it printed. */
const TAIL_LINES = 40;
const TAIL_BYTES = 8 * 1024;
/** Past this the log moves to `<log>.1`, replacing the one before, so it never fills the disk and the last deaths survive. */
const LOG_CAP_BYTES = 10 * 1024 * 1024;
const WINDOW_MS = 60_000;

const backoff = (n: number): number => Math.min(1000 * 2 ** (n - 1), 30_000);

const lasted = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${s % 60}s` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};

/** An append-only log that rotates itself by size, written synchronously so the last line before an exit lands. */
const openLog = (file: string): ((bytes: Buffer | string) => void) => {
  mkdirSync(dirname(file), { recursive: true });
  let size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  let fd = openSync(file, "a");
  return (bytes) => {
    if (size > LOG_CAP_BYTES) {
      closeSync(fd);
      renameSync(file, `${file}.1`);
      fd = openSync(file, "a");
      size = 0;
    }
    size += writeSync(fd, bytes);
  };
};

/** Run the server and keep it running. Returns the stop: the child is killed and not started again. */
export const supervise = (o: SuperviseOptions): (() => void) => {
  const { maxDeaths = 5, delay = backoff } = o;
  const write = openLog(o.log);
  const note = (line: string) => write(`${new Date().toISOString()} supervisor: ${line}\n`);

  let kill: (() => void) | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const deaths: number[] = [];

  const start = () => {
    const began = Date.now();
    // Raw bytes, cut to lines only when the server dies: output is constant, a death is rare.
    let tail = Buffer.alloc(0);
    const keep = (chunk: Buffer) => {
      write(chunk);
      tail = Buffer.concat([tail, chunk]).subarray(-TAIL_BYTES);
    };
    const child = spawn(o.command, o.args, { env: { ...(o.env ?? process.env), MAVERICK_SUPERVISED: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    kill = () => child.kill();
    note(`started ${o.args.join(" ")} (pid ${child.pid})`);
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let ended = false;
    const died = (how: string) => {
      if (ended) return;
      ended = true;
      kill = undefined;
      if (stopped) return note(`stopped (${how})`);
      const now = Date.now();
      deaths.push(now);
      while (deaths.length && now - deaths[0] > WINDOW_MS) deaths.shift();
      const lines = tail.toString().split("\n").filter(Boolean).slice(-TAIL_LINES);
      const last = lines.length ? `; its last words:\n${lines.map((l) => `    ${l}`).join("\n")}` : "; it printed nothing";
      const what = `the server ${how} after ${lasted(now - began)}`;
      if (deaths.length >= maxDeaths) {
        const why = `${what}, ${deaths.length} deaths inside ${lasted(WINDOW_MS)}, so it is not started again`;
        note(`${why}${last}`);
        o.onGiveUp?.(why);
        return;
      }
      const wait = delay(deaths.length);
      note(`${what}; starting it again in ${lasted(wait)}${last}`);
      timer = setTimeout(start, wait);
    };
    // A command that cannot be started at all errors with no exit to follow; it is a death like any other.
    child.on("error", (err) => died(`could not start (${err.message})`));
    child.on("exit", (code, signal) => died(signal ? `killed by ${signal}` : `exited with code ${code}`));
  };
  start();

  return () => {
    stopped = true;
    clearTimeout(timer);
    kill?.();
  };
};
