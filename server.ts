/**
 * Session console: a local HTTP server over the markdown trackers, session records and
 * live repo signals. The UI in web/ is plain static files talking to /api/*, so the same
 * page runs in a browser today and inside an Electron window later, where this file
 * becomes the main process.
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
import { readSessions } from "./src/sessions.ts";
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

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const board = async () =>
  Promise.all(
    config.trackers.map(async (tracker, index) => {
      const text = await readFile(tracker.path, "utf8");
      return { index, label: tracker.label, path: tracker.path, ...parseTracker(text) };
    }),
  );

interface MoveBody extends MoveRequest {
  tracker: number;
}

const move = async (body: MoveBody): Promise<{ commit: string }> => {
  const tracker = config.trackers[body.tracker];
  if (!tracker) throw new Error(`no tracker at index ${body.tracker}`);
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
  if (req.method === "GET" && url.pathname === "/api/board") return sendJson(res, 200, await board());
  if (req.method === "GET" && url.pathname === "/api/live") return sendJson(res, 200, await liveSignals());
  if (req.method === "GET" && url.pathname === "/api/sessions") {
    return sendJson(res, 200, await readSessions(config.sessionsDir));
  }
  if (req.method === "POST" && url.pathname === "/api/move") {
    const body = JSON.parse(await readBody(req)) as MoveBody;
    try {
      return sendJson(res, 200, await move(body));
    } catch (err) {
      if (err instanceof StaleMoveError) return sendJson(res, 409, { error: err.message });
      throw err;
    }
  }
  if (req.method === "GET") return serveStatic(url.pathname, res);
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
  for (const t of config.trackers) console.log(`  ${t.label}: ${t.path}`);
});
