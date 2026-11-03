/**
 * The server is kept up by a supervisor (decisions M31): a death is logged with why and the server
 * is started again, and one that keeps dying fast is given up on with the reason. Each test runs a
 * real child process, the way the app runs `server.ts`, and reads the log a person would read.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { supervise } from "../src/supervisor.ts";

const dir = mkdtempSync(join(tmpdir(), "mv-supervise-"));
/** A stand-in server: counts its starts in a file, says something, then does what `how` says. */
const script = (name: string, how: string) => {
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(join(dir, `${name}.starts`))}, "x");
console.log("listening on 8766");
${how}
`, "utf8");
  return file;
};
const starts = (name: string) => { try { return readFileSync(join(dir, `${name}.starts`), "utf8").length; } catch { return 0; } };
const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (ok()) return;
  throw new Error("timed out");
};

test("a server that dies is logged with its code and last words, and started again", async () => {
  const log = join(dir, "crash.log");
  const s = supervise({ command: process.execPath, args: [script("crash", `// The first run dies the way a server does; the second stays up.
if ((await import("node:fs")).readFileSync(${JSON.stringify(join(dir, "crash.starts"))}, "utf8").length === 1) { console.error("TypeError: cannot read the ledger"); process.exit(3); }
setInterval(() => {}, 1000);`)], log, delay: () => 50 });
  after(s.stop);
  await until(() => starts("crash") === 2);
  s.stop();
  const text = readFileSync(log, "utf8");
  assert.match(text, /supervisor: the server exited with code 3 after \d+s; starting it again in 0s; its last words:\n {4}listening on 8766\n {4}TypeError: cannot read the ledger/);
  assert.match(text, /listening on 8766[\s\S]*listening on 8766/, "what it printed is in the log, both runs");
});

test("a server killed by a signal says so", async () => {
  const log = join(dir, "killed.log");
  const s = supervise({ command: process.execPath, args: [script("killed", "setInterval(() => {}, 1000);")], log, delay: () => 50 });
  after(s.stop);
  await until(() => starts("killed") === 1);
  process.kill(s.pid()!, "SIGKILL");
  await until(() => starts("killed") === 2);
  assert.match(readFileSync(log, "utf8"), /the server killed by SIGKILL after \d+s; starting it again/);
});

test("a server that keeps dying fast is given up on with the reason, not restarted forever", async () => {
  const log = join(dir, "loop.log");
  let gaveUp = "";
  supervise({ command: process.execPath, args: [script("loop", "process.exit(1);")], log, delay: () => 10, maxDeaths: 3, onGiveUp: (why) => { gaveUp = why; } });
  await until(() => gaveUp !== "");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(starts("loop"), 3, "three starts, then no more");
  assert.match(gaveUp, /exited with code 1 after 0s, 3 deaths inside 1m0s, so it is not started again/);
  assert.match(readFileSync(log, "utf8"), /so it is not started again; its last words:\n {4}listening on 8766/);
});

test("stopping it ends the server for good", async () => {
  const log = join(dir, "stop.log");
  const s = supervise({ command: process.execPath, args: [script("stop", "setInterval(() => {}, 1000);")], log, delay: () => 10 });
  await until(() => starts("stop") === 1);
  s.stop();
  await until(() => /supervisor: stopped/.test(readFileSync(log, "utf8")));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(starts("stop"), 1);
});
