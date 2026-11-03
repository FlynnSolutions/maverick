/**
 * The server is kept up by a supervisor (decisions M31): a death is logged with why and the server
 * is started again, and one that keeps dying fast is given up on with the reason. Each test runs a
 * real child process, the way the app runs `server.ts`, and reads the log a person would read.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { supervise } from "../src/supervisor.ts";
import { until } from "./fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "mv-supervise-"));
/** A stand-in server: counts its starts in a file (`n` is this run's), says something, then does what `how` says. */
const script = (name: string, how: string) => {
  const file = join(dir, `${name}.mjs`);
  const count = JSON.stringify(join(dir, `${name}.starts`));
  writeFileSync(file, `import { appendFileSync, readFileSync } from "node:fs";
appendFileSync(${count}, "x");
const n = readFileSync(${count}, "utf8").length;
console.log("listening on 8766");
${how}
`, "utf8");
  return file;
};
const starts = (name: string) => (existsSync(join(dir, `${name}.starts`)) ? readFileSync(join(dir, `${name}.starts`), "utf8").length : 0);
const STAY_UP = "setInterval(() => {}, 1000);";
const run = (name: string, how: string, more: Partial<Parameters<typeof supervise>[0]> = {}) => {
  const log = join(dir, `${name}.log`);
  const stop = supervise({ command: process.execPath, args: [script(name, how)], log, delay: () => 50, ...more });
  after(stop);
  return { stop, text: () => readFileSync(log, "utf8") };
};

test("a server that dies is logged with its code and last words, and started again", async () => {
  const { text } = run("crash", `if (n === 1) { console.error("TypeError: cannot read the ledger"); process.exit(3); }\n${STAY_UP}`);
  await until(() => starts("crash") === 2);
  assert.match(text(), /supervisor: the server exited with code 3 after \d+s; starting it again in 0s; its last words:\n {4}listening on 8766\n {4}TypeError: cannot read the ledger/);
  assert.match(text(), /listening on 8766[\s\S]*listening on 8766/, "what it printed is in the log, both runs");
});

test("a server killed by a signal says so", async () => {
  const { text } = run("killed", `if (n === 1) process.kill(process.pid, "SIGKILL");\n${STAY_UP}`);
  await until(() => starts("killed") === 2);
  assert.match(text(), /the server killed by SIGKILL after \d+s; starting it again/);
});

test("a server that keeps dying fast is given up on with the reason, not restarted forever", async () => {
  let gaveUp = "";
  const { text } = run("loop", "process.exit(1);", { delay: () => 10, maxDeaths: 3, onGiveUp: (why) => { gaveUp = why; } });
  await until(() => gaveUp !== "");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(starts("loop"), 3, "three starts, then no more");
  assert.match(gaveUp, /exited with code 1 after 0s, 3 deaths inside 1m0s, so it is not started again/);
  assert.match(text(), /so it is not started again; its last words:\n {4}listening on 8766/);
});

test("a command that cannot be started is a death too, so it is given up on rather than left waiting", async () => {
  let gaveUp = "";
  after(supervise({ command: join(dir, "no-such-binary"), args: [], log: join(dir, "missing.log"), delay: () => 10, maxDeaths: 2, onGiveUp: (why) => { gaveUp = why; } }));
  await until(() => gaveUp !== "");
  assert.match(gaveUp, /could not start \(spawn .*ENOENT\)/);
});

test("stopping it ends the server for good", async () => {
  const { stop, text } = run("stop", STAY_UP);
  await until(() => starts("stop") === 1);
  stop();
  await until(() => /supervisor: stopped/.test(text()));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(starts("stop"), 1);
});
