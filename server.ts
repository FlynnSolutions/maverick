/**
 * Session console: a local HTTP server over one project's markdown trackers, its session
 * records and its live repo signals. The UI in web/ is plain static files talking to
 * /api/*, so the same page runs in a browser today and inside an Electron window later,
 * where this file becomes the main process.
 *
 * Run: node server.ts   (Node 22.18+ strips the types itself; no build, no dependencies)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./src/config.ts";
import { commitFile } from "./src/git.ts";
import { liveSignals } from "./src/live.ts";
import { addProject, chooseFolder, projectById, readProjects, removeProject } from "./src/projects.ts";
import { sessionsForProject } from "./src/sessions.ts";
import { applyMove, parseTracker, StaleMoveError, type MoveRequest } from "./src/trackers.ts";

const webRoot = join(fileURLToPath(new URL(".", import.meta.url)), "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readJson = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
};

const requireProject = async (url: URL) => {
  const id = url.searchParams.get("project");
  if (!id) throw new Error("project query parameter is required");
  return projectById(id);
};

const board = async (projectId: string) => {
  const project = await projectById(projectId);
  return Promise.all(
    project.trackers.map(async (tracker, index) => {
      const text = await readFile(tracker.path, "utf8");
      return { index, label: tracker.label, path: tracker.path, ...parseTracker(text) };
    }),
  );
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

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { method } = req;
  const path = url.pathname;

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
  if (method === "GET" && path === "/api/board") {
    return sendJson(res, 200, await board((await requireProject(url)).id));
  }
  if (method === "GET" && path === "/api/live") {
    return sendJson(res, 200, await liveSignals(await requireProject(url), url.searchParams.has("refresh")));
  }
  if (method === "GET" && path === "/api/sessions") {
    const project = await requireProject(url);
    return sendJson(res, 200, await sessionsForProject(config.sessionsDir, project.id, project.name));
  }
  if (method === "POST" && path === "/api/move") {
    const body = await readJson<MoveBody>(req);
    try {
      return sendJson(res, 200, await move(body));
    } catch (err) {
      if (err instanceof StaleMoveError) return sendJson(res, 409, { error: err.message });
      throw err;
    }
  }
  if (method === "GET") return serveStatic(path, res);
  res.writeHead(405).end();
};

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
