/**
 * The ship wizard. A ship run is a saved record of steps for one version: the audits, the
 * two review documents, and every phase of the project's own ship workflow
 * (`claude/SHIP_WORKFLOW.md`, parsed live so the wizard follows the doc). Each step runs as
 * a background Claude session driving the matching skill; the wizard records the session,
 * watches it finish, collects the documents it produced, and keeps notes. Progress lives in
 * `~/.claude/console-sessions/ships/<project>/<version>.json`, so a ship can be picked up
 * again after any interruption.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { backgroundAgents } from "./git.ts";
import type { Project } from "./projects.ts";
import { readSessions, type SessionRecord } from "./sessions.ts";
import { runAudit } from "./audits.ts";

const run = promisify(execFile);

export type StepStatus = "pending" | "running" | "finished" | "done" | "failed" | "skipped";

export interface ShipStep {
  id: string;
  title: string;
  /** What the step's background session is told to do; `/skill` prompts run that skill. */
  prompt: string;
  status: StepStatus;
  claudeId?: string;
  started?: string;
  ended?: string;
  /** The session's own summary, if it wrote one where asked. */
  report?: string;
  /** Documents produced while the step ran, relative to the project, served by /files. */
  artifacts: string[];
  notes?: string;
  /** The human's items from the report, as checkboxes: key -> {done, label, at}. */
  checks?: Record<string, { done: boolean; label?: string; at?: string }>;
  /** Progress through a hosted walkthrough document: verdict per case id, read from the doc as it is worked. */
  walkthrough?: { doc: string; key: string; total: number; answered: number; verdicts: Record<string, string>; updatedAt: string };
}

export interface ShipRun {
  id: string;
  project: string;
  version: string;
  started: string;
  finished?: string;
  steps: ShipStep[];
}

const shipsDir = (projectId: string): string => join(config.sessionsDir, "ships", projectId);
const shipPath = (projectId: string, version: string): string => join(shipsDir(projectId), `${version}.json`);
const reportPath = (projectId: string, version: string, stepId: string): string => join(shipsDir(projectId), `${version}-${stepId}.md`);

export const readShip = async (projectId: string, version: string): Promise<ShipRun | null> => {
  try {
    return JSON.parse(await readFile(shipPath(projectId, version), "utf8")) as ShipRun;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

export const listShips = async (projectId: string): Promise<ShipRun[]> => {
  let names: string[];
  try {
    names = await readdir(shipsDir(projectId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const runs = await Promise.all(names.filter((n) => n.endsWith(".json")).map(async (n) => JSON.parse(await readFile(join(shipsDir(projectId), n), "utf8")) as ShipRun));
  return runs.sort((a, b) => b.started.localeCompare(a.started));
};

const writeShip = async (ship: ShipRun): Promise<void> => {
  await mkdir(shipsDir(ship.project), { recursive: true });
  await writeFile(shipPath(ship.project, ship.version), `${JSON.stringify(ship, null, 2)}\n`, "utf8");
};

/** The project's ship phases, from its own workflow doc when it has one. */
const workflowPhases = async (project: Project): Promise<Array<{ id: string; title: string }>> => {
  try {
    const text = await readFile(join(project.path, "claude", "SHIP_WORKFLOW.md"), "utf8");
    const phases = [...text.matchAll(/^### Phase (\d+): (.+?)\s*$/gm)].map((m) => ({ id: `phase-${m[1]}`, title: `Phase ${m[1]}: ${m[2]}` }));
    if (phases.length) return phases;
  } catch {
    /* no project workflow; fall through */
  }
  return ["Pre-flight", "Migrate (conditional)", "Stage", "Verify Staging", "Deploy to Production", "Version Bump", "Stamp Changelog + Release Notes", "Merge Back"].map((t, i) => ({ id: `phase-${i + 1}`, title: `Phase ${i + 1}: ${t}` }));
};

const stepPrompt = (version: string, title: string, report: string, body: string): string =>
  [
    `You are one step of the ship wizard for version ${version}: ${title}.`,
    body,
    `When this step is complete, write a short summary (what you did, what you verified, what is left for a human) to ${report}, then stop. Do not start any other phase.`,
  ].join("\n");

export const createShip = async (project: Project, version: string): Promise<ShipRun> => {
  const existing = await readShip(project.id, version);
  if (existing) return existing;
  const rp = (id: string) => reportPath(project.id, version, id);
  const steps: ShipStep[] = [
    { id: "audits", title: "Audit every task session in this release", prompt: "", status: "pending", artifacts: [] },
    { id: "walkthrough", title: "Build the staging test walkthrough", prompt: stepPrompt(version, "test walkthrough", rp("walkthrough"), `Run the /ship-test-walkthrough skill for the batch shipping as ${version}. The document goes where that skill puts it (deliverables/testing/).`), status: "pending", artifacts: [] },
    { id: "architecture", title: "Build the architecture doc", prompt: stepPrompt(version, "architecture doc", rp("architecture"), `Run the /ship-architecture-doc skill for the batch shipping as ${version}. The document goes where that skill puts it (deliverables/architecture/).`), status: "pending", artifacts: [] },
    ...(await workflowPhases(project)).map((p) => ({
      id: p.id,
      title: p.title,
      prompt: stepPrompt(version, p.title, rp(p.id), `Run the /ship skill for version ${version}, but ONLY ${p.title}. The skill pauses for confirmation at phase boundaries; a human is attached to this session and will answer. Stop at the end of this phase.`),
      status: "pending" as StepStatus,
      artifacts: [],
    })),
  ];
  const ship: ShipRun = { id: `${project.id}-${version}`, project: project.id, version, started: new Date().toISOString(), steps };
  await writeShip(ship);
  return ship;
};

const stepOf = (ship: ShipRun, stepId: string): ShipStep => {
  const step = ship.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`no step "${stepId}" in ship ${ship.id}`);
  return step;
};

/** Start a step: audits run inside the console; everything else is a background Claude session. */
export const runStep = async (project: Project, version: string, stepId: string): Promise<ShipStep> => {
  const ship = await readShip(project.id, version);
  if (!ship) throw new Error(`no ship run for ${version}`);
  const step = stepOf(ship, stepId);
  if (step.status === "running") throw new Error(`${step.title} is already running (${step.claudeId})`);
  step.started = new Date().toISOString();
  step.notes = undefined;
  if (stepId === "audits") {
    const records = (await readSessions(config.sessionsDir)).filter((r) => r.role === "develop" && (r.project === project.id || r.project === project.name) && r.claudeId && !r.audit) as SessionRecord[];
    const started: string[] = [];
    for (const r of records) {
      try {
        await runAudit(project, r.id);
        started.push(r.loop);
      } catch (err) {
        console.error(`ship audit of ${r.id} failed:`, (err as Error).message);
      }
    }
    step.status = "done";
    step.ended = new Date().toISOString();
    step.report = started.length ? `Audits started for: ${started.join("; ")}. Verdicts show under their audit parents on the rail.` : "No un-audited task sessions for this project.";
  } else {
    const { stdout } = await run(
      "claude",
      ["--bg", "--name", `ship ${version}: ${step.title.slice(0, 40)}`, "--permission-mode", "auto", step.prompt],
      { cwd: project.path },
    );
    const claudeId = stdout.match(/backgrounded\s*·\s*([0-9a-f]+)/)?.[1];
    if (!claudeId) throw new Error(`could not read the session id from:\n${stdout}`);
    step.claudeId = claudeId;
    step.status = "running";
  }
  await writeShip(ship);
  return step;
};

export const updateStep = async (project: Project, version: string, stepId: string, patch: { status?: StepStatus; notes?: string; checks?: ShipStep["checks"]; walkthrough?: ShipStep["walkthrough"] }): Promise<ShipStep> => {
  const ship = await readShip(project.id, version);
  if (!ship) throw new Error(`no ship run for ${version}`);
  const step = stepOf(ship, stepId);
  if (patch.status) {
    step.status = patch.status;
    if (patch.status === "done" || patch.status === "skipped" || patch.status === "failed") step.ended = step.ended ?? new Date().toISOString();
    if (patch.status === "pending") {
      delete step.claudeId;
      delete step.ended;
    }
  }
  if (patch.notes !== undefined) step.notes = patch.notes;
  if (patch.checks !== undefined) step.checks = patch.checks;
  if (patch.walkthrough !== undefined) step.walkthrough = patch.walkthrough;
  if (ship.steps.every((s) => s.status === "done" || s.status === "skipped")) ship.finished = ship.finished ?? new Date().toISOString();
  else delete ship.finished;
  await writeShip(ship);
  return step;
};

/** Review documents written since a step started, under the folders the doc skills use. */
const artifactsSince = async (project: Project, sinceIso: string): Promise<string[]> => {
  const since = new Date(sinceIso).getTime();
  const out: string[] = [];
  for (const dir of ["deliverables/testing", "deliverables/architecture"]) {
    try {
      for (const name of await readdir(join(project.path, dir))) {
        if (!/\.(html|md)$/.test(name)) continue;
        const full = join(project.path, dir, name);
        const info = await stat(full);
        if (info.isFile() && info.mtimeMs >= since) out.push(relative(project.path, full));
      }
    } catch {
      /* folder absent in this project */
    }
  }
  return out.sort();
};

/** Watch running steps: a finished session becomes "finished" (or "done" when it wrote its report), and its documents are collected. */
export const sweepShips = async (project: Project): Promise<void> => {
  const ships = await listShips(project.id);
  if (!ships.some((s) => s.steps.some((st) => st.status === "running"))) return;
  const agents = await backgroundAgents(project.path);
  for (const ship of ships) {
    let changed = false;
    for (const step of ship.steps) {
      if (step.status !== "running" || !step.claudeId) continue;
      const agent = agents.find((a) => a.id === step.claudeId);
      const state = agent?.state ?? "gone";
      if (!/^(done|exited|stopped|gone)$/.test(state)) continue;
      const rp = reportPath(project.id, ship.version, step.id);
      try {
        step.report = await readFile(rp, "utf8");
        // The walkthrough step is done when the human has been through the document, not when the agent built it.
        step.status = step.id === "walkthrough" ? "finished" : "done";
      } catch {
        step.status = "finished";
      }
      step.ended = new Date().toISOString();
      step.artifacts = await artifactsSince(project, step.started ?? ship.started);
      changed = true;
    }
    if (changed) await writeShip(ship);
  }
};
