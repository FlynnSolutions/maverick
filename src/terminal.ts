/**
 * Embedded terminals: each one is a `claude` process inside a pty (bin/ptybridge.py), owned by
 * the console server. The browser gets the byte stream over Server-Sent Events and sends
 * keystrokes back with POSTs, so no WebSocket implementation is needed.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

const ptyHelper = join(fileURLToPath(new URL("..", import.meta.url)), "bin", "ptybridge.py");

/** How much recent output a late subscriber (a reload) gets replayed. */
const SCROLLBACK_BYTES = 256 * 1024;

export interface TerminalInfo {
  id: string;
  title: string;
  command: string[];
  cwd: string;
  startedAt: string;
  exitCode: number | null;
}

interface Terminal extends TerminalInfo {
  child: ChildProcessWithoutNullStreams;
  scrollback: Buffer[];
  scrollbackBytes: number;
  subscribers: Set<ServerResponse>;
}

const terminals = new Map<string, Terminal>();

const info = (t: Terminal): TerminalInfo => ({
  id: t.id,
  title: t.title,
  command: t.command,
  cwd: t.cwd,
  startedAt: t.startedAt,
  exitCode: t.exitCode,
});

export const listTerminals = (): TerminalInfo[] => [...terminals.values()].map(info);

export const openTerminal = (title: string, command: string[], cwd: string, cols = 120, rows = 36): TerminalInfo => {
  const id = randomUUID().slice(0, 8);
  const child = spawn("python3", [ptyHelper, String(cols), String(rows), ...command], {
    cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: process.env.LANG ?? "en_US.UTF-8" },
  });
  const terminal: Terminal = {
    id, title, command, cwd, startedAt: new Date().toISOString(), exitCode: null,
    child, scrollback: [], scrollbackBytes: 0, subscribers: new Set(),
  };
  terminals.set(id, terminal);

  const broadcast = (chunk: Buffer) => {
    terminal.scrollback.push(chunk);
    terminal.scrollbackBytes += chunk.length;
    while (terminal.scrollbackBytes > SCROLLBACK_BYTES && terminal.scrollback.length > 1) {
      terminal.scrollbackBytes -= terminal.scrollback.shift()!.length;
    }
    const event = `data: ${chunk.toString("base64")}\n\n`;
    for (const res of terminal.subscribers) res.write(event);
  };
  child.stdout.on("data", broadcast);
  child.stderr.on("data", (chunk: Buffer) => console.error(`terminal ${id} helper:`, chunk.toString()));
  child.on("exit", (code, signal) => {
    terminal.exitCode = code ?? (signal ? 128 : 1);
    const event = `event: exit\ndata: ${terminal.exitCode}\n\n`;
    for (const res of terminal.subscribers) {
      res.write(event);
      res.end();
    }
    terminal.subscribers.clear();
  });
  return info(terminal);
};

const get = (id: string): Terminal => {
  const t = terminals.get(id);
  if (!t) throw new Error(`no terminal "${id}"`);
  return t;
};

export const subscribe = (id: string, res: ServerResponse): void => {
  const t = get(id);
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const chunk of t.scrollback) res.write(`data: ${chunk.toString("base64")}\n\n`);
  if (t.exitCode !== null) {
    res.write(`event: exit\ndata: ${t.exitCode}\n\n`);
    res.end();
    return;
  }
  t.subscribers.add(res);
  res.on("close", () => t.subscribers.delete(res));
};

export const writeInput = (id: string, data: Buffer): void => {
  const t = get(id);
  if (t.exitCode !== null) throw new Error(`terminal "${id}" has exited`);
  t.child.stdin.write(data);
};

export const resize = (id: string, cols: number, rows: number): void => {
  get(id).child.stdin.write(`\x1b]9999;${Math.max(20, cols)};${Math.max(5, rows)}\x07`);
};

export const closeTerminal = (id: string): void => {
  const t = get(id);
  if (t.exitCode === null) t.child.kill("SIGHUP");
  terminals.delete(t.id);
};
