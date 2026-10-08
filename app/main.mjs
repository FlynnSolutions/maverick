/**
 * The Electron shell: one window onto the same server a browser tab talks to. `server.ts` is
 * imported here as the main process and `web/` is served from it unchanged. If something
 * already answers on the port (a `node server.ts` left running in a terminal), the window
 * opens on that and starts nothing of its own.
 */
import { app, BrowserWindow, shell } from "electron";
import { execFile } from "node:child_process";
import { request } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { config } from "../src/config.ts";

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
};

app.whenReady().then(async () => {
  if (!(await answers(config.port))) await startServer();
  openWindow(`http://127.0.0.1:${config.port}/`);
});

app.on("window-all-closed", () => app.quit());
