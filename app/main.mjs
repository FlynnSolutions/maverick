/**
 * The Electron shell: one window onto the same server a browser tab talks to. `server.ts` is
 * imported here as the main process and `web/` is served from it unchanged. If something
 * already answers on the port (a `node server.ts` left running in a terminal), the window
 * opens on that and starts nothing of its own.
 */
import { app, BrowserWindow, Notification, shell } from "electron";
import { execFile } from "node:child_process";
import { request } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { config } from "../src/config.ts";
import { newQuestions } from "../src/notify.ts";

const run = promisify(execFile);

/** A GUI app launched from Finder gets a bare PATH; `claude`, `gh` and `git` live on the login shell's. */
const loginPath = async () => {
  try {
    const { stdout } = await run(config.shell, ["-ilc", "echo $PATH"], { timeout: 5000 });
    return stdout.trim().split("\n").pop();
  } catch {
    return undefined;
  }
};

/** Whether a Maverick server answers on the port. */
const answers = (port) =>
  new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/projects", timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });

const startServer = async () => {
  const path = await loginPath();
  if (path) process.env.PATH = path;
  await import("../server.ts");
  const started = Date.now();
  while (!(await answers(config.port))) {
    if (Date.now() - started > 10_000) throw new Error(`nothing answered on port ${config.port} ten seconds after starting the server`);
    await sleep(200);
  }
};

const openWindow = (origin) => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Maverick",
    backgroundColor: "#14171a",
  });
  // Links into the console (a plan document, a hosted walkthrough) open as windows; anything else is the browser's.
  const external = (url) => {
    if (url.startsWith(origin)) return false;
    shell.openExternal(url);
    return true;
  };
  win.webContents.setWindowOpenHandler(({ url }) => (external(url) ? { action: "deny" } : { action: "allow" }));
  win.webContents.on("will-navigate", (event, url) => { if (external(url)) event.preventDefault(); });
  win.loadURL(origin);
  return win;
};

/** A notification is dropped with its click handler once nothing holds it, so the live ones are kept here. */
const shown = new Set();

const notify = (win, origin, projectId, { missionId, missionName, question }) => {
  const note = new Notification({ title: missionName, body: question.title });
  shown.add(note);
  note.on("close", () => shown.delete(note));
  note.on("click", () => {
    shown.delete(note);
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.loadURL(`${origin}mission.html?project=${encodeURIComponent(projectId)}&mission=${encodeURIComponent(missionId)}#progress`);
  });
  note.show();
};

const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
};

/**
 * Every 15 s, each project's missions from the workspace, compared with the last poll of the
 * same project. A project's first poll only remembers what it asks, so opening the app (or
 * adding a project) does not announce questions that were already waiting.
 */
const pollQuestions = (win, origin) => {
  const last = new Map();
  const poll = async () => {
    try {
      for (const project of await getJson(`${origin}api/projects`)) {
        try {
          const { missions = [] } = await getJson(`${origin}api/workspace?project=${encodeURIComponent(project.id)}`);
          const now = missions.map((m) => ({ missionId: m.id, missionName: m.name, questions: m.questions ?? [] }));
          if (last.has(project.id)) for (const fresh of newQuestions(last.get(project.id), now)) notify(win, origin, project.id, fresh);
          last.set(project.id, now);
        } catch (err) {
          console.error(`question poll for ${project.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error("question poll:", err.message);
    }
    if (!win.isDestroyed()) setTimeout(poll, 15_000);
  };
  poll();
};

app.whenReady().then(async () => {
  if (!(await answers(config.port))) await startServer();
  const origin = `http://127.0.0.1:${config.port}/`;
  pollQuestions(openWindow(origin), origin);
});

app.on("window-all-closed", () => app.quit());
