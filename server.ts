/**
 * Session console: a local HTTP server over one project's markdown trackers, its Claude
 * sessions (with embedded terminals to work in them), and its live repo signals. The UI in
 * web/ is plain static files talking to /api/*, so the same page runs in a browser today
 * and inside an Electron window later, where this file becomes the main process.
 *
 * Run: node server.ts   (Node 22.18+ strips the types itself; no build, no dependencies)
 */
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "./src/config.ts";
import { commitFile } from "./src/git.ts";
import { liveSignals } from "./src/live.ts";
import { addProject, chooseFolder, projectById, readProjects, removeProject, type Project } from "./src/projects.ts";
import { assignParent, auditView, createParent, recordDecision, runAudit, sweep } from "./src/audits.ts";
import { releasesFor, writeSlot, type ReleaseSlot, type SlotName } from "./src/releases.ts";
import { createShip, listShips, readShip, runStep, sweepShips, updateStep, type StepStatus } from "./src/ships.ts";
import { sessionsForProject, type SessionRecord } from "./src/sessions.ts";
import { closeTerminal, listTerminals, openTerminal, resize, subscribe, writeInput } from "./src/terminal.ts";
import { addGroup, applyEdit, applyMove, deleteGroup, parseTracker, renameGroup, StaleMoveError, type MoveRequest } from "./src/trackers.ts";

const run = promisify(execFile);
const webRoot = join(fileURLToPath(new URL(".", import.meta.url)), "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readBodyBytes = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const readJson = async <T>(req: IncomingMessage): Promise<T> => {
  const raw = (await readBodyBytes(req)).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
};

const requireProject = async (url: URL): Promise<Project> => {
  const id = url.searchParams.get("project");
  if (!id) throw new Error("project query parameter is required");
  return projectById(id);
};

/* ---------- board ---------- */

/** One `git blame` per tracker file gives the commit date of every line: when an item's bullet last changed. Cached by mtime. */
const blameCache = new Map<string, { mtimeMs: number; dates: Map<number, string> }>();
const lineDates = async (filePath: string): Promise<Map<number, string>> => {
  const { mtimeMs } = await stat(filePath);
  const hit = blameCache.get(filePath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.dates;
  const dates = new Map<number, string>();
  try {
    const { stdout } = await run("git", ["blame", "--porcelain", "--", filePath], { cwd: dirname(filePath), maxBuffer: 64 * 1024 * 1024 });
    let line = 0;
    let time = "";
    for (const row of stdout.split("\n")) {
      const head = row.match(/^[0-9a-f]{40} \d+ (\d+)/);
      if (head) line = Number(head[1]);
      else if (row.startsWith("author-time ")) time = new Date(Number(row.slice(12)) * 1000).toISOString().slice(0, 10);
      else if (row.startsWith("\t")) dates.set(line, time);
    }
  } catch (err) {
    console.error(`blame failed for ${filePath}:`, (err as Error).message);
  }
  blameCache.set(filePath, { mtimeMs, dates });
  return dates;
};

const board = async (project: Project) =>
  Promise.all(
    project.trackers.map(async (tracker, index) => {
      const text = await readFile(tracker.path, "utf8");
      const parsed = parseTracker(text);
      const dates = await lineDates(tracker.path);
      for (const section of parsed.sections) for (const group of section.groups) for (const item of group.items) {
        (item as { lineDate?: string }).lineDate = dates.get(item.start + 1);
      }
      return { index, label: tracker.label, path: tracker.path, ...parsed };
    }),
  );

interface RenameBody {
  project: string;
  tracker: number;
  heading: string;
  oldName: string;
  newName: string;
}

const renameGroupIn = async (body: RenameBody): Promise<{ commit: string }> => {
  const project = await projectById(body.project);
  const tracker = project.trackers[body.tracker];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${body.tracker}`);
  const newName = body.newName.trim();
  if (!newName || newName.includes("\n")) throw new Error("a group name is one non-empty line");
  const after = renameGroup(await readFile(tracker.path, "utf8"), body.heading, body.oldName, newName);
  await writeFile(tracker.path, after, "utf8");
  return { commit: await commitFile(tracker.path, `console: rename group "${body.oldName}" to "${newName}"`) };
};

interface MoveBody extends MoveRequest {
  project: string;
  tracker: number;
}

const move = async (body: MoveBody): Promise<{ commit: string }> => {
  const project = await projectById(body.project);
  const tracker = project.trackers[body.tracker];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${body.tracker}`);
  const before = await readFile(tracker.path, "utf8");
  const after = applyMove(before, body);
  await writeFile(tracker.path, after, "utf8");
  const title = body.itemFirstLine.match(/\*\*(.+?)\*\*/)?.[1] ?? body.itemFirstLine.slice(2, 60);
  const where = body.targetGroup ? `${body.targetHeading} / ${body.targetGroup}` : body.targetHeading;
  const commit = await commitFile(tracker.path, `console: move "${title}" to ${where} #${body.targetIndex + 1}`);
  return { commit };
};

interface GroupBody {
  project: string;
  tracker: number;
  heading: string;
  name: string;
}

const createGroup = async (body: GroupBody): Promise<{ commit: string }> => {
  const project = await projectById(body.project);
  const tracker = project.trackers[body.tracker];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${body.tracker}`);
  const name = body.name.trim();
  if (!name || name.includes("\n")) throw new Error("a group name is one non-empty line");
  const after = addGroup(await readFile(tracker.path, "utf8"), body.heading, name);
  await writeFile(tracker.path, after, "utf8");
  return { commit: await commitFile(tracker.path, `console: add group "${name}" under ${body.heading}`) };
};

interface EditBody {
  project: string;
  tracker: number;
  itemStart: number;
  itemFirstLine: string;
  body: string;
}

const editItem = async (body: EditBody): Promise<{ commit: string }> => {
  const project = await projectById(body.project);
  const tracker = project.trackers[body.tracker];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${body.tracker}`);
  const after = applyEdit(await readFile(tracker.path, "utf8"), body.itemStart, body.itemFirstLine, body.body);
  await writeFile(tracker.path, after, "utf8");
  const title = body.body.split("\n")[0].match(/\*\*(.+?)\*\*/)?.[1] ?? body.body.slice(2, 60);
  return { commit: await commitFile(tracker.path, `console: edit "${title}"`) };
};

/* ---------- sessions and terminals ---------- */

interface OpenTerminalBody {
  project: string;
  /** attach a background agent, resume an interactive session, start a fresh claude, or spawn a task agent and attach it. */
  kind: "attach" | "resume" | "new" | "spawn";
  id?: string;
  sessionId?: string;
  title?: string;
  prompt?: string;
  /** Working directory for a fresh session; must sit inside the project (a worktree, say). */
  cwd?: string;
  /** An audit parent's record id; a supervised task session is audited when it finishes. */
  parent?: string;
  cols?: number;
  rows?: number;
}

const writeSessionRecord = async (record: SessionRecord): Promise<void> => {
  await mkdir(config.sessionsDir, { recursive: true });
  await writeFile(join(config.sessionsDir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
};

/** `claude --bg` prints "backgrounded · <id> · <name>"; the id is what attach/stop/logs take. */
const spawnBackgroundAgent = async (cwd: string, prompt: string, name: string): Promise<string> => {
  const { stdout } = await run("claude", ["--bg", "--name", name, "--permission-mode", "auto", prompt], { cwd });
  const id = stdout.match(/backgrounded\s*·\s*([0-9a-f]+)/)?.[1];
  if (!id) throw new Error(`could not read the background session id from:\n${stdout}`);
  return id;
};

const spawnPrompt = (project: Project, title: string, body: string, trackerPath: string): string =>
  [
    `You are a develop session for the project at ${project.path}. Your one loop is: ${title}.`,
    `Follow the "Session discipline" section of ~/.claude/CLAUDE.md: work only this loop, park tangents as one line in the tracker, and end with one line saying whether the loop closed and where the handoff lives.`,
    `The item, verbatim from ${trackerPath}:`,
    "",
    body,
    "",
    `When the loop closes, update that item in the tracker (mark it done or record the handoff) and commit the tracker file alone.`,
  ].join("\n");

const openTerminalFor = async (body: OpenTerminalBody) => {
  const project = await projectById(body.project);
  const size = { cols: body.cols ?? 120, rows: body.rows ?? 36 };
  switch (body.kind) {
    case "attach": {
      if (!body.id) throw new Error("attach needs id");
      return openTerminal(body.title ?? `attach ${body.id}`, ["claude", "attach", body.id], project.path, size.cols, size.rows);
    }
    case "resume": {
      if (!body.sessionId) throw new Error("resume needs sessionId");
      return openTerminal(body.title ?? `resume ${body.sessionId.slice(0, 8)}`, ["claude", "--resume", body.sessionId], project.path, size.cols, size.rows);
    }
    case "new": {
      const cwd = body.cwd ?? project.path;
      if (cwd !== project.path && !cwd.startsWith(`${project.path}/`)) throw new Error(`cwd ${cwd} is outside the project`);
      return openTerminal(body.title ?? `claude · ${project.name}`, ["claude"], cwd, size.cols, size.rows);
    }
    case "spawn": {
      if (!body.prompt || !body.title) throw new Error("spawn needs title and prompt");
      const trackerPath = project.trackers[0]?.path ?? project.path;
      const id = await spawnBackgroundAgent(project.path, spawnPrompt(project, body.title, body.prompt, trackerPath), body.title.slice(0, 60));
      await writeSessionRecord({
        id: `bg-${id}`,
        role: "develop",
        loop: body.title,
        status: "open",
        started: new Date().toISOString(),
        project: project.id,
        claudeId: id,
        ...(body.parent ? { parent: body.parent } : {}),
      });
      return { ...openTerminal(body.title, ["claude", "attach", id], project.path, size.cols, size.rows), agentId: id };
    }
    default:
      throw new Error(`unknown terminal kind "${String(body.kind)}"`);
  }
};

/* ---------- static ---------- */

const serveStatic = async (pathname: string, res: ServerResponse): Promise<void> => {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(webRoot, rel));
  if (!file.startsWith(webRoot)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      res.writeHead(404).end("not found");
      return;
    }
    throw err;
  }
};

/* ---------- routing ---------- */

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { method } = req;
  const path = url.pathname;
  const termMatch = path.match(/^\/api\/terminals\/([^/]+)(?:\/(stream|input|resize))?$/);

  if (method === "GET" && path === "/api/projects") return sendJson(res, 200, await readProjects());
  if (method === "POST" && path === "/api/projects/import") {
    const folder = await chooseFolder();
    if (!folder) return sendJson(res, 200, { cancelled: true });
    return sendJson(res, 200, await addProject(folder));
  }
  if (method === "POST" && path === "/api/projects") {
    const body = await readJson<{ path: string; name?: string }>(req);
    return sendJson(res, 200, await addProject(body.path, body.name));
  }
  if (method === "DELETE" && path.startsWith("/api/projects/")) {
    await removeProject(decodeURIComponent(path.slice("/api/projects/".length)));
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && path === "/api/board") return sendJson(res, 200, await board(await requireProject(url)));
  if (method === "GET" && path === "/api/live") {
    return sendJson(res, 200, await liveSignals(await requireProject(url), url.searchParams.has("refresh")));
  }
  if (method === "GET" && path === "/api/releases") {
    return sendJson(res, 200, await releasesFor(await requireProject(url), url.searchParams.has("refresh")));
  }
  if (method === "GET" && path === "/api/sessions") {
    const project = await requireProject(url);
    const records = await sessionsForProject(config.sessionsDir, project.id, project.name);
    const live = await liveSignals(project);
    const states = new Map(live.backgroundAgents.map((a) => [a.id, a.state ?? ""]));
    return sendJson(res, 200, await Promise.all(records.map(async (r) => ({ ...r, auditView: await auditView(r, states) }))));
  }
  if (method === "POST" && path === "/api/audit-parents") {
    const body = await readJson<{ project: string; name: string }>(req);
    return sendJson(res, 200, await createParent(await projectById(body.project), body.name));
  }
  const sessionAction = path.match(/^\/api\/sessions\/([^/]+)\/(parent|audit|decision)$/);
  if (method === "POST" && sessionAction) {
    const [, id, action] = sessionAction;
    if (action === "parent") return sendJson(res, 200, await assignParent(id, (await readJson<{ parent: string | null }>(req)).parent));
    if (action === "audit") return sendJson(res, 200, await runAudit(await requireProject(url), id));
    if (action === "decision") {
      await recordDecision(id, (await readJson<{ decision: "accepted" | "rejected" }>(req)).decision);
      return sendJson(res, 200, { ok: true });
    }
  }
  if (method === "POST" && path === "/api/move") {
    try {
      return sendJson(res, 200, await move(await readJson<MoveBody>(req)));
    } catch (err) {
      if (err instanceof StaleMoveError) return sendJson(res, 409, { error: err.message });
      throw err;
    }
  }

  if (method === "POST" && path === "/api/groups") return sendJson(res, 200, await createGroup(await readJson<GroupBody>(req)));
  if (method === "POST" && path === "/api/groups/rename") return sendJson(res, 200, await renameGroupIn(await readJson<RenameBody>(req)));
  if (method === "DELETE" && path === "/api/groups") {
    const body = await readJson<GroupBody>(req);
    const project = await projectById(body.project);
    const tracker = project.trackers[body.tracker];
    if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${body.tracker}`);
    await writeFile(tracker.path, deleteGroup(await readFile(tracker.path, "utf8"), body.heading, body.name), "utf8");
    return sendJson(res, 200, { commit: await commitFile(tracker.path, `console: delete empty group "${body.name}"`) });
  }
  if (method === "GET" && path === "/api/ships") return sendJson(res, 200, await listShips((await requireProject(url)).id));
  if (method === "POST" && path === "/api/ships") {
    const body = await readJson<{ project: string; version: string }>(req);
    if (!/^\d+\.\d+\.\d+$/.test(body.version)) throw new Error(`version must look like 1.9.0, got "${body.version}"`);
    return sendJson(res, 200, await createShip(await projectById(body.project), body.version));
  }
  const shipStep = path.match(/^\/api\/ships\/([^/]+)\/steps\/([^/]+)(?:\/(run))?$/);
  if (shipStep) {
    const project = await requireProject(url);
    const [, version, stepId, action] = shipStep;
    if (method === "POST" && action === "run") return sendJson(res, 200, await runStep(project, version, stepId));
    if (method === "POST" && !action) return sendJson(res, 200, await updateStep(project, version, stepId, await readJson<{ status?: StepStatus; notes?: string }>(req)));
  }
  if (method === "GET" && path.startsWith("/api/ships/")) {
    const project = await requireProject(url);
    await sweepShips(project);
    return sendJson(res, 200, await readShip(project.id, decodeURIComponent(path.slice("/api/ships/".length))));
  }
  // Review documents the ship produced, served read-only from inside the project.
  if (method === "GET" && path === "/files") {
    const project = await requireProject(url);
    const rel = url.searchParams.get("path") ?? "";
    const full = normalize(join(project.path, rel));
    if (!full.startsWith(`${project.path}/`) || !/\.(html|md|txt)$/.test(full)) {
      res.writeHead(403).end("only .html, .md and .txt inside the project");
      return;
    }
    const data = await readFile(full);
    res.writeHead(200, { "content-type": full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
    res.end(data);
    return;
  }
  if (method === "POST" && path === "/api/release-slots") {
    const body = await readJson<{ project: string; slot: SlotName; name?: string; deploy?: string }>(req);
    if (body.slot !== "next" && body.slot !== "next+1") throw new Error(`slot must be next or next+1, got "${String(body.slot)}"`);
    // Only the keys sent are touched: undefined leaves a value alone, "" clears it.
    const patch: ReleaseSlot = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.deploy !== undefined) patch.deploy = body.deploy;
    return sendJson(res, 200, await writeSlot((await projectById(body.project)).id, body.slot, patch));
  }
  if (method === "POST" && path === "/api/edit") {
    try {
      return sendJson(res, 200, await editItem(await readJson<EditBody>(req)));
    } catch (err) {
      if (err instanceof StaleMoveError) return sendJson(res, 409, { error: err.message });
      throw err;
    }
  }
  if (method === "POST" && /^\/api\/sessions\/\d+\/close$/.test(path)) {
    const pid = Number(path.split("/")[3]);
    const project = await requireProject(url);
    const live = await liveSignals(project, true);
    if (!live.claudeSessions.some((s) => s.pid === pid)) throw new Error(`pid ${pid} is not a Claude session under ${project.name}`);
    process.kill(pid, "SIGTERM");
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && path === "/api/terminals") return sendJson(res, 200, listTerminals());
  if (method === "POST" && path === "/api/terminals") return sendJson(res, 200, await openTerminalFor(await readJson<OpenTerminalBody>(req)));
  if (termMatch) {
    const [, id, action] = termMatch;
    if (method === "GET" && action === "stream") return subscribe(id, res);
    if (method === "POST" && action === "input") {
      writeInput(id, await readBodyBytes(req));
      return sendJson(res, 200, { ok: true });
    }
    if (method === "POST" && action === "resize") {
      const { cols, rows } = await readJson<{ cols: number; rows: number }>(req);
      resize(id, cols, rows);
      return sendJson(res, 200, { ok: true });
    }
    if (method === "DELETE" && !action) {
      closeTerminal(id);
      return sendJson(res, 200, { ok: true });
    }
  }
  if (method === "POST" && path.startsWith("/api/agents/") && path.endsWith("/stop")) {
    const id = path.slice("/api/agents/".length, -"/stop".length);
    const { stdout } = await run("claude", ["stop", id]);
    return sendJson(res, 200, { ok: true, output: stdout.trim() });
  }

  if (method === "GET") return serveStatic(path, res);
  res.writeHead(405).end();
};

// Supervised task sessions that finish get audited on their own; one pass a minute.
const sweepAll = async (): Promise<void> => {
  for (const project of await readProjects()) {
    try {
      const started = await sweep(project);
      for (const id of started) console.log(`auto-audit started for ${id} (${project.name})`);
      await sweepShips(project);
    } catch (err) {
      console.error(`sweep failed for ${project.name}:`, (err as Error).message);
    }
  }
};
setInterval(() => { sweepAll().catch((err: Error) => console.error("sweep:", err.message)); }, 60_000).unref();

createServer((req, res) => {
  handle(req, res).catch((err: Error) => {
    console.error(`${req.method} ${req.url} failed:`, err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  });
}).listen(config.port, "127.0.0.1", () => {
  console.log(`session console: http://localhost:${config.port}`);
  console.log(`  projects: ${config.projectsFile}`);
});
