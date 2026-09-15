/**
 * Claude usage, from the transcripts Claude Code keeps: every assistant message carries the
 * model and its token counts. This scans `~/.claude/projects/<slug>/<session>.jsonl` across
 * every project, incrementally (a per-file offset, so a file is only ever read once past
 * what was already counted), and aggregates by day, project and model. There is no local
 * record of the subscription's quota; this is what was consumed, not what remains.
 */
import { open, readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { config } from "./config.ts";

interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messages: number;
}

interface FileCache {
  size: number;
  mtimeMs: number;
  offset: number;
  /** date -> model -> tokens */
  days: Record<string, Record<string, Tokens>>;
  /** hour (YYYY-MM-DDTHH) -> model -> tokens, kept for the last few days only */
  hours?: Record<string, Record<string, Tokens>>;
  sessionId: string;
  project: string;
}

interface UsageCache {
  /** Bumped when the per-file shape changes; an older cache is rescanned from zero. */
  version?: number;
  files: Record<string, FileCache>;
}
const CACHE_VERSION = 2;

export interface UsageView {
  scannedAt: string;
  filesScanned: number;
  /** hour -> model -> tokens for the last 7 days; the provider widget builds windows from it. */
  hourly: Record<string, Record<string, Tokens>>;
  /** ISO week start (YYYY-MM-DD) -> model -> tokens for the last 8 weeks. */
  weekly: Record<string, Record<string, Tokens>>;
  days: Array<{ date: string } & Tokens>;
  projects: Array<{ project: string } & Tokens>;
  models: Array<{ model: string } & Tokens>;
  totals: { today: Tokens; week: Tokens; month: Tokens };
  sessionsThisMonth: number;
}

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 });
const add = (a: Tokens, b: Tokens): void => {
  a.input += b.input;
  a.output += b.output;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
  a.messages += b.messages;
};

const cachePath = (): string => join(dirname(config.projectsFile), "usage-cache.json");
const projectsDir = (): string => join(homedir(), ".claude", "projects");
const DAYS_KEPT = 45;

const readCache = async (): Promise<UsageCache> => {
  try {
    const cache = JSON.parse(await readFile(cachePath(), "utf8")) as UsageCache;
    return cache.version === CACHE_VERSION ? cache : { version: CACHE_VERSION, files: {} };
  } catch {
    return { version: CACHE_VERSION, files: {} };
  }
};

/** Read a file from `offset`, counting complete lines only; returns the new offset. */
const scanFrom = async (path: string, offset: number, into: Record<string, Record<string, Tokens>>, hours: Record<string, Record<string, Tokens>>): Promise<number> => {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size <= offset) return offset;
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    const text = buffer.toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) return offset;
    for (const line of text.slice(0, lastNewline).split("\n")) {
      if (!line.includes('"usage"')) continue;
      let entry: { type?: string; timestamp?: string; message?: { model?: string; usage?: Record<string, number> } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== "assistant" || !entry.message?.usage || !entry.timestamp) continue;
      const day = entry.timestamp.slice(0, 10);
      const hour = entry.timestamp.slice(0, 13);
      const model = entry.message.model ?? "unknown";
      const u = entry.message.usage;
      const delta = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        messages: 1,
      };
      add(((into[day] ??= {})[model] ??= zero()), delta);
      add(((hours[hour] ??= {})[model] ??= zero()), delta);
    }
    return offset + Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8");
  } finally {
    await handle.close();
  }
};

const readableProject = (slug: string): string => {
  const parts = slug.replace(/^-/, "").split("-");
  const i = parts.indexOf("Projects");
  return i >= 0 && parts[i + 1] ? parts.slice(i + 1).join("-").replace(/-worktrees-.*$/, "") : slug;
};

let scanning: Promise<UsageView> | null = null;
let last: UsageView | null = null;

const scan = async (): Promise<UsageView> => {
  const cache = await readCache();
  const cutoff = Date.now() - DAYS_KEPT * 86400000;
  let filesScanned = 0;
  let dirs: string[] = [];
  try {
    dirs = await readdir(projectsDir());
  } catch {
    dirs = [];
  }
  for (const slug of dirs) {
    const dir = join(projectsDir(), slug);
    // Subagent transcripts nest under <session>/subagents/**; they consume the plan too, so walk everything.
    let names: string[];
    try {
      names = (await readdir(dir, { recursive: true })).filter((n) => n.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (!info || !info.isFile() || info.mtimeMs < cutoff) continue;
      const sessionId = name.split("/")[0].replace(/\.jsonl$/, "");
      const entry = cache.files[path] ?? { size: 0, mtimeMs: 0, offset: 0, days: {}, sessionId, project: readableProject(slug) };
      if (entry.size === info.size && entry.mtimeMs === info.mtimeMs) {
        cache.files[path] = entry;
        continue;
      }
      if (info.size < entry.offset) {
        entry.offset = 0;
        entry.days = {};
      }
      entry.hours ??= {};
      entry.offset = await scanFrom(path, entry.offset, entry.days, entry.hours);
      // Hours older than eight days are not needed by any view; keep the cache small.
      const hourCutoff = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 13);
      for (const h of Object.keys(entry.hours)) if (h < hourCutoff) delete entry.hours[h];
      entry.size = info.size;
      entry.mtimeMs = info.mtimeMs;
      cache.files[path] = entry;
      filesScanned += 1;
    }
  }
  await mkdir(dirname(cachePath()), { recursive: true });
  await writeFile(cachePath(), JSON.stringify(cache), "utf8");

  const byDay = new Map<string, Tokens>();
  const byProject = new Map<string, Tokens>();
  const byModel = new Map<string, Tokens>();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const totals = { today: zero(), week: zero(), month: zero() };
  const sessionsThisMonth = new Set<string>();
  const hourly: Record<string, Record<string, Tokens>> = {};
  const weekly: Record<string, Record<string, Tokens>> = {};
  const hourFloor = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 13);
  const weekStart = (day: string): string => {
    const d = new Date(`${day}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  };
  const eightWeeksAgo = new Date(Date.now() - 56 * 86400000).toISOString().slice(0, 10);
  for (const entry of Object.values(cache.files)) {
    for (const [hour, models] of Object.entries(entry.hours ?? {})) {
      if (hour < hourFloor) continue;
      for (const [model, t] of Object.entries(models)) add(((hourly[hour] ??= {})[model] ??= zero()), t);
    }
    for (const [day, models] of Object.entries(entry.days)) {
      if (day >= eightWeeksAgo) for (const [model, t] of Object.entries(models)) add(((weekly[weekStart(day)] ??= {})[model] ??= zero()), t);
      if (day < monthAgo) continue;
      for (const [model, t] of Object.entries(models)) {
        add(byDay.get(day) ?? byDay.set(day, zero()).get(day)!, t);
        add(byProject.get(entry.project) ?? byProject.set(entry.project, zero()).get(entry.project)!, t);
        add(byModel.get(model) ?? byModel.set(model, zero()).get(model)!, t);
        add(totals.month, t);
        if (day >= weekAgo) add(totals.week, t);
        if (day === today) add(totals.today, t);
        sessionsThisMonth.add(entry.sessionId);
      }
    }
  }
  const view: UsageView = {
    scannedAt: new Date().toISOString(),
    filesScanned,
    hourly,
    weekly,
    days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, t]) => ({ date, ...t })),
    projects: [...byProject.entries()].map(([project, t]) => ({ project, ...t })).sort((a, b) => b.output - a.output),
    models: [...byModel.entries()].map(([model, t]) => ({ model, ...t })).sort((a, b) => b.output - a.output),
    totals,
    sessionsThisMonth: sessionsThisMonth.size,
  };
  last = view;
  return view;
};

export const usage = async (force = false): Promise<UsageView> => {
  if (last && !force && Date.now() - new Date(last.scannedAt).getTime() < 5 * 60_000) return last;
  if (!scanning) scanning = scan().finally(() => { scanning = null; });
  return scanning;
};
