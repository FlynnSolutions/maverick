/**
 * Drive headless Chrome over the DevTools protocol with no dependency: Node 22 ships a
 * WebSocket client. Navigate, wait, optionally evaluate an expression, optionally screenshot.
 *   node cdp.mjs <url> [--shot out.png] [--eval file.js] [--w 1600] [--h 1200] [--wait 4000]
 */
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const url = process.argv[2];
const width = Number(arg("w", 1600));
const height = Number(arg("h", 1200));
const waitMs = Number(arg("wait", 4500));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = await mkdtemp(join(tmpdir(), "cdp-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run",
  `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "--remote-debugging-port=0", "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  const onData = (c) => {
    buf += c.toString();
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) resolve(m[0]);
  };
  chrome.stderr.on("data", onData);
  chrome.stdout.on("data", onData);
  chrome.on("exit", (code) => reject(new Error(`chrome exited ${code}: ${buf.slice(0, 400)}`)));
  setTimeout(() => reject(new Error(`no devtools url in 15s: ${buf.slice(0, 400)}`)), 15000);
});

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws failed")); });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false }, sessionId);
await send("Page.navigate", { url }, sessionId);
await sleep(waitMs);

const evalFile = arg("eval");
if (evalFile) {
  const expression = await readFile(evalFile, "utf8");
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (exceptionDetails) console.error("EVAL ERROR:", JSON.stringify(exceptionDetails.exception?.description ?? exceptionDetails).slice(0, 800));
  else console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2));
}

const shot = arg("shot");
if (shot) {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
  await writeFile(shot, Buffer.from(data, "base64"));
  console.error(`shot: ${shot}`);
}
ws.close();
chrome.kill();
process.exit(0);
