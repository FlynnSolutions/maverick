/**
 * The project registry: which directories the console knows, and which tracker files
 * inside each one are the roadmap. This is console configuration, not tracker data, so it
 * lives in the console's own home (`~/.claude/session-console/projects.json`).
 */
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";

const run = promisify(execFile);

export interface TrackerRef {
  label: string;
  path: string;
}

export interface Project {
  /** Slug used in URLs and session records. */
  id: string;
  name: string;
  path: string;
  trackers: TrackerRef[];
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

export const readProjects = async (): Promise<Project[]> => {
  try {
    return JSON.parse(await readFile(config.projectsFile, "utf8")) as Project[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
};

const writeProjects = async (projects: Project[]): Promise<void> => {
  await mkdir(dirname(config.projectsFile), { recursive: true });
  await writeFile(config.projectsFile, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
};

/** Tracker files a project conventionally keeps, in the order they should show. */
const TRACKER_CANDIDATES: Array<{ rel: string; label: string }> = [
  { rel: "deliverables/CHECKLIST.md", label: "CHECKLIST" },
  { rel: "CHECKLIST.md", label: "CHECKLIST" },
  { rel: "PUNCHLIST.md", label: "PUNCHLIST" },
  { rel: "TODO.md", label: "TODO" },
  { rel: "NEXT_STEPS.md", label: "NEXT STEPS" },
];

export const detectTrackers = async (projectPath: string): Promise<TrackerRef[]> => {
  const found: TrackerRef[] = [];
  for (const candidate of TRACKER_CANDIDATES) {
    const full = join(projectPath, candidate.rel);
    if (await exists(full)) found.push({ label: candidate.label, path: full });
  }
  return found;
};

const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const addProject = async (path: string, name = basename(path)): Promise<Project> => {
  if (!(await exists(path))) throw new Error(`no directory at ${path}`);
  const projects = await readProjects();
  const existing = projects.find((p) => p.path === path);
  if (existing) return existing;
  let id = slugOf(name);
  while (projects.some((p) => p.id === id)) id = `${id}-2`;
  const project: Project = { id, name, path, trackers: await detectTrackers(path) };
  await writeProjects([...projects, project]);
  return project;
};

export const removeProject = async (id: string): Promise<void> => {
  const projects = await readProjects();
  if (!projects.some((p) => p.id === id)) throw new Error(`no project "${id}"`);
  await writeProjects(projects.filter((p) => p.id !== id));
};

export const projectById = async (id: string): Promise<Project> => {
  const project = (await readProjects()).find((p) => p.id === id);
  if (!project) throw new Error(`no project "${id}"`);
  return project;
};

/**
 * Native macOS folder picker (the console runs on Cory's Mac). Returns null when the
 * dialog is cancelled; any other failure surfaces.
 */
export const chooseFolder = async (): Promise<string | null> => {
  try {
    const { stdout } = await run("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Pick a project directory for the console")',
    ]);
    return stdout.trim().replace(/\/$/, "");
  } catch (err) {
    const message = (err as { stderr?: string; message: string }).stderr ?? (err as Error).message;
    if (/User cancel/i.test(message)) return null;
    throw new Error(`folder picker failed: ${message.trim()}`);
  }
};
