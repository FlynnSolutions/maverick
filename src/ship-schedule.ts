/**
 * Ship days: when this project intends to ship, and how often it means to keep doing it.
 *
 * The trackers hold work, and work has a deadline; a *cadence* is neither, which is why this is
 * the one scheduling record that cannot live in a markdown file. It is per project, in
 * `~/.claude/session-console/ship-schedule.json`, alongside the release labels it sits next to.
 *
 * A cadence is an anchor date and a number of weeks, so every occurrence is derived rather than
 * stored: change the cadence and the future moves, while everything said about a particular day
 * (it moved, it was cancelled, it shipped) stays keyed to the day the cadence generated. That
 * key is the `origin`. A day that shipped is kept for good, even if the cadence later stops
 * generating it, because the history of what actually shipped is the part worth not losing.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.ts";

const DAY = 86_400_000;
const file = config.shipScheduleFile;

export interface Cadence {
  /** 1 is weekly, 2 every other week. Capped at 12: past a quarter it is not a cadence. */
  everyWeeks: number;
  /** The first ship day. Its weekday is the cadence's weekday; there is no separate field. */
  anchor: string;
}

export interface ShipSchedule {
  cadence: Cadence | null;
  /** One-off ship days, added by hand. ISO dates. */
  extra: string[];
  /** Occurrences taken off the calendar, keyed by origin. */
  skipped: string[];
  /** origin -> the date it now sits on. Later than the origin means it was pushed back. */
  moved: Record<string, string>;
  /** origin -> what shipped that day. */
  shipped: Record<string, { version?: string; at: string }>;
}

export interface Occurrence {
  /** The day it is on now. */
  date: string;
  /** The day the cadence generated, which is what every record about it is keyed to. */
  origin: string;
  source: "cadence" | "extra";
  /** Set only when the day has been moved off its origin. */
  movedFrom?: string;
  shipped?: { version?: string; at: string };
}

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Throws rather than coercing: a bad date silently becoming today's is the worse failure. */
const requireDate = (v: unknown, what: string): string => {
  if (!isDate(v)) throw new Error(`${what} must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(v)}`);
  return v;
};

const at = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Whatever is on disk, read as the shape the rest of this file may assume. */
const normalize = (raw: unknown): ShipSchedule => {
  const r = (raw ?? {}) as Partial<ShipSchedule>;
  const c = r.cadence;
  const cadence: Cadence | null =
    c && isDate(c.anchor) && Number.isInteger(c.everyWeeks) && c.everyWeeks >= 1 && c.everyWeeks <= 12
      ? { everyWeeks: c.everyWeeks, anchor: c.anchor }
      : null;
  return {
    cadence,
    extra: [...new Set((r.extra ?? []).filter(isDate))].sort(),
    skipped: [...new Set((r.skipped ?? []).filter(isDate))].sort(),
    moved: Object.fromEntries(Object.entries(r.moved ?? {}).filter(([k, v]) => isDate(k) && isDate(v))),
    shipped: Object.fromEntries(Object.entries(r.shipped ?? {}).filter(([k]) => isDate(k))),
  };
};

/** Read through every time, like the release labels next to it: the file is tiny, and a cache
 * would mean a hand-edit to it went unseen until the console restarted. */
const loadAll = async (): Promise<Record<string, unknown>> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return {};
  }
};

export const readSchedule = async (projectId: string): Promise<ShipSchedule> => normalize((await loadAll())[projectId]);

const save = async (projectId: string, schedule: ShipSchedule): Promise<ShipSchedule> => {
  const all = { ...(await loadAll()), [projectId]: schedule };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  return schedule;
};

/** Whether the cadence generates this exact day: on or after the anchor, a whole number of steps along. */
const isCadenceOrigin = (cadence: Cadence | null, date: string): boolean => {
  if (!cadence) return false;
  const delta = at(date) - at(cadence.anchor);
  return delta >= 0 && delta % (cadence.everyWeeks * 7 * DAY) === 0;
};

/**
 * Every ship day between `from` and `to`, by the date it sits on now. Cadence days are expanded
 * over a window widened by a quarter at each end, because a day moved into view may have been
 * generated outside it.
 */
export const occurrences = (schedule: ShipSchedule, from: string, to: string): Occurrence[] => {
  const origins = new Map<string, "cadence" | "extra">();
  const { cadence } = schedule;
  if (cadence) {
    const step = cadence.everyWeeks * 7 * DAY;
    const anchor = at(cadence.anchor);
    const slack = 92 * DAY;
    const first = Math.max(0, Math.floor((at(from) - slack - anchor) / step));
    const last = Math.floor((at(to) + slack - anchor) / step);
    for (let k = first; k <= last; k += 1) origins.set(iso(anchor + k * step), "cadence");
  }
  for (const date of schedule.extra) origins.set(date, "extra");
  // A day that shipped stays on the calendar whatever the cadence does now.
  for (const origin of Object.keys(schedule.shipped)) if (!origins.has(origin)) origins.set(origin, "extra");

  const out: Occurrence[] = [];
  for (const [origin, source] of origins) {
    if (schedule.skipped.includes(origin) && !schedule.shipped[origin]) continue;
    const date = schedule.moved[origin] ?? origin;
    if (date < from || date > to) continue;
    out.push({
      date,
      origin,
      source,
      ...(date === origin ? {} : { movedFrom: origin }),
      ...(schedule.shipped[origin] ? { shipped: schedule.shipped[origin] } : {}),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.origin.localeCompare(b.origin));
};

export const setCadence = async (projectId: string, cadence: Cadence | null): Promise<ShipSchedule> => {
  const current = await readSchedule(projectId);
  if (!cadence) return save(projectId, { ...current, cadence: null });
  const anchor = requireDate(cadence.anchor, "anchor");
  const everyWeeks = Number(cadence.everyWeeks);
  if (!Number.isInteger(everyWeeks) || everyWeeks < 1 || everyWeeks > 12) {
    throw new Error(`everyWeeks must be a whole number of weeks from 1 to 12, got ${JSON.stringify(cadence.everyWeeks)}`);
  }
  return save(projectId, { ...current, cadence: { everyWeeks, anchor } });
};

export type DayAction = "add" | "remove" | "move" | "ship" | "unship";

/**
 * One change to one ship day, keyed by the day the cadence generated it on. `move` records the
 * new date against that origin rather than rewriting it, so a day that was pushed back still
 * knows where it was meant to be.
 */
export const markDay = async (
  projectId: string,
  action: DayAction,
  origin: string,
  opts: { to?: string; version?: string } = {},
): Promise<ShipSchedule> => {
  const s = await readSchedule(projectId);
  requireDate(origin, "date");
  const next: ShipSchedule = { ...s, extra: [...s.extra], skipped: [...s.skipped], moved: { ...s.moved }, shipped: { ...s.shipped } };
  switch (action) {
    case "add":
      // Un-cancelling is the same gesture as adding: a cancelled cadence day comes back rather
      // than being duplicated as a one-off sitting on the same date.
      next.skipped = next.skipped.filter((d) => d !== origin);
      if (!isCadenceOrigin(next.cadence, origin) && !next.extra.includes(origin)) next.extra = [...next.extra, origin].sort();
      break;
    case "remove":
      next.extra = next.extra.filter((d) => d !== origin);
      if (isCadenceOrigin(next.cadence, origin)) next.skipped = [...new Set([...next.skipped, origin])].sort();
      delete next.moved[origin];
      delete next.shipped[origin];
      break;
    case "move": {
      const to = requireDate(opts.to, "to");
      if (to === origin) delete next.moved[origin];
      else next.moved[origin] = to;
      break;
    }
    case "ship":
      next.shipped[origin] = { at: new Date().toISOString(), ...(opts.version ? { version: opts.version } : {}) };
      break;
    case "unship":
      delete next.shipped[origin];
      break;
    default:
      throw new Error(`unknown ship-day action "${String(action)}"`);
  }
  return save(projectId, next);
};
