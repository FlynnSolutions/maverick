/**
 * Everything environment-specific lives here and is overridable by env vars, so the same
 * code runs against a scratch copy of the trackers (tests), the real ones (daily use), or
 * inside an Electron shell later.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();
const projects = process.env.SESSION_CONSOLE_PROJECTS ?? join(home, "Projects");

export interface TrackerConfig {
  label: string;
  path: string;
}

const defaultTrackers: TrackerConfig[] = [
  { label: "hq / PUNCHLIST", path: join(projects, "hq", "PUNCHLIST.md") },
  { label: "Realtime / CHECKLIST", path: join(projects, "Realtime", "deliverables", "CHECKLIST.md") },
];

/** `SESSION_CONSOLE_TRACKERS=label=path,label=path` overrides the default pair. */
const trackersFromEnv = (): TrackerConfig[] | null => {
  const raw = process.env.SESSION_CONSOLE_TRACKERS;
  if (!raw) return null;
  return raw.split(",").map((entry) => {
    const eq = entry.indexOf("=");
    if (eq < 0) throw new Error(`SESSION_CONSOLE_TRACKERS entry "${entry}" is not label=path`);
    return { label: entry.slice(0, eq), path: entry.slice(eq + 1) };
  });
};

export const config = {
  port: Number(process.env.SESSION_CONSOLE_PORT ?? 8766),
  trackers: trackersFromEnv() ?? defaultTrackers,
  sessionsDir: process.env.SESSION_CONSOLE_SESSIONS ?? join(home, ".claude", "console-sessions"),
  devServersRegistry: join(projects, "Realtime", ".dev-servers.json"),
  repos: [
    { label: "frontend", path: join(projects, "Realtime", "RTMFG-frontend"), gh: "RealTimeMFG/RTMFG-frontend" },
    { label: "backend", path: join(projects, "Realtime", "RTMFG-backend"), gh: "RealTimeMFG/RealTimeMFG-backend" },
  ],
  /** Live signals (gh, git) are refreshed at most this often. */
  liveCacheMs: 60_000,
};
