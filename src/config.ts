/**
 * Everything environment-specific lives here and is overridable by env vars, so the same
 * code runs against scratch data (tests), the real projects (daily use), or inside an
 * Electron shell later.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();
const consoleHome = process.env.SESSION_CONSOLE_HOME ?? join(home, ".claude", "session-console");

export const config = {
  port: Number(process.env.SESSION_CONSOLE_PORT ?? 8766),
  /** The project registry (see src/projects.ts). */
  projectsFile: join(consoleHome, "projects.json"),
  /** Our per-session records (role, loop, parent, handoff). */
  sessionsDir: process.env.SESSION_CONSOLE_SESSIONS ?? join(home, ".claude", "console-sessions"),
  /** Claude Code's own live-session registry. Read-only; the CLI owns it. */
  claudeSessionsDir: join(home, ".claude", "sessions"),
  /** Live signals (gh, git, claude agents) are refreshed at most this often, per project. */
  liveCacheMs: 60_000,
};
