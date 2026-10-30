/**
 * The Electron shell: one window onto the same server a browser tab talks to. `server.ts` is
 * imported here as the main process and `web/` is served from it unchanged. If something
 * already answers on the port (a `node server.ts` left running in a terminal), the window
 * opens on that and starts nothing of its own. With `--source <checkout>` the server is that
 * checkout's, not the packed copy; the page reads which off the server's `/api/about`.
 */
import { app, BrowserWindow, dialog, Menu, Notification, shell } from "electron";
import { execFile } from "node:child_process";
import { request } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "../src/config.ts";
import { newQuestions } from "../src/notify.ts";
import { browserTab } from "./browser.mjs";
import { serverUrl, sourceDir, withoutSource } from "./source.mjs";

const run = promisify(execFile);
const source = sourceDir(process.argv, process.env);

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
  await import(serverUrl(source, fileURLToPath(new URL("../server.ts", import.meta.url))));
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
  win.loadURL(origin);
  return win;
};

/** The one browser tab every link out of Maverick lands in, replaced on each click. */
const tab = browserTab(config.browser);
const toBrowser = (url) => {
  // A mailto: or a non-mac host has no tab to reuse; the system's own handler takes it.
  if (process.platform !== "darwin" || !/^https?:/.test(url)) return void shell.openExternal(url);
  tab.open(url).catch((err) => {
    console.error(`could not open ${url} in ${tab.browser}, so it went to the default browser:`, err.message);
    shell.openExternal(url);
  });
};

/**
 * Links into the console (a plan document, a hosted walkthrough) open as Maverick windows;
 * anything else is the browser's. Set on every web contents the app makes, not only the first
 * window's: a walkthrough opened in a window of its own, or a dev link followed inside its frame,
 * used to load a dev app in Maverick, where it has none of the browser's sign-in.
 */
const keepLinksOut = (origin) => {
  // A frame's about:blank, a data: or blob: document and the devtools are the page's own, not
  // links out. Of what is out, only http(s) goes to the tab; toBrowser hands the rest to the system.
  const external = (url) => !url.startsWith(origin) && !/^(about|data|blob|javascript|devtools):/.test(url);
  app.on("web-contents-created", (_, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (!external(url)) return { action: "allow" };
      toBrowser(url);
      return { action: "deny" };
    });
    // Fired for the main frame and every frame inside it, such as a link in a walkthrough document.
    contents.on("will-frame-navigate", (event) => {
      if (!external(event.url)) return;
      event.preventDefault();
      toBrowser(event.url);
    });
  });
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
 * Every 15 s, what each project's missions ask, compared with the last poll of the same project.
 * The questions route reads records and nothing else, so the poll never drives a sweep or a git
 * spawn. A project's first poll only remembers what it asks, so opening the app (or adding a
 * project) does not announce questions that were already waiting.
 */
const pollQuestions = (win, origin) => {
  const last = new Map();
  const one = async (project) => {
    try {
      const { missions = [] } = await getJson(`${origin}api/questions?project=${encodeURIComponent(project.id)}`);
      const now = missions.map((m) => ({ missionId: m.id, missionName: m.name, questions: m.questions }));
      if (last.has(project.id)) for (const fresh of newQuestions(last.get(project.id), now)) notify(win, origin, project.id, fresh);
      last.set(project.id, now);
    } catch (err) {
      console.error(`question poll for ${project.id}:`, err.message);
    }
  };
  const poll = async () => {
    try {
      await Promise.all((await getJson(`${origin}api/projects`)).map(one));
    } catch (err) {
      console.error("question poll:", err.message);
    }
    if (!win.isDestroyed()) setTimeout(poll, 15_000);
  };
  poll();
};

/** The same app again on another source, or none: server.ts is imported in-process, so swapping it is a relaunch. */
const relaunch = (dir) => {
  app.relaunch({ args: [...withoutSource(process.argv.slice(1)), ...(dir ? ["--source", dir] : [])] });
  app.exit(0);
};

/**
 * The app menu: the stock Edit, View and Window, and one item of Maverick's own, pick a checkout
 * and relaunch on it, so a person working on Maverick gets their code in the app's window
 * without a terminal. The flag is the same one the terminal would pass.
 */
const menu = () => Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        label: "Open with a source checkout...",
        click: async () => {
          const { canceled, filePaths } = await dialog.showOpenDialog({ title: "A Maverick checkout", properties: ["openDirectory"], message: "Pick the folder that holds server.ts. The app relaunches on it." });
          if (!canceled && filePaths[0]) relaunch(filePaths[0]);
        },
      },
      ...(source ? [{ label: "Reopen on the app's own server", click: () => relaunch() }] : []),
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  { role: "editMenu" },
  { role: "viewMenu" },
  { role: "windowMenu" },
]));

app.whenReady().then(async () => {
  menu();
  if (!(await answers(config.port))) await startServer();
  const origin = `http://127.0.0.1:${config.port}/`;
  keepLinksOut(origin);
  pollQuestions(openWindow(origin), origin);
});

app.on("window-all-closed", () => app.quit());
