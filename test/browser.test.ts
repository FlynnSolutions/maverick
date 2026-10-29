import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { browserTab, tabScript } from "../app/browser.mjs";

// A stand-in osascript: it records what it was asked and answers with a tab id, so nothing opens.
const fake = mkdtempSync(join(tmpdir(), "mv-osascript-"));
// It is called as \`osascript -e <script> <url> <tab>\`, so the URL and the tab are $3 and $4.
writeFileSync(join(fake, "osascript"), `#!/bin/sh\nprintf '%s|%s\\n' "$3" "$4" >> "${fake}/calls"\necho 41\n`, "utf8");
chmodSync(join(fake, "osascript"), 0o755);
const realPath = process.env.PATH;
process.env.PATH = `${fake}:${realPath}`;
after(() => { process.env.PATH = realPath; });
const calls = () => readFileSync(join(fake, "calls"), "utf8").trim().split("\n");

test("every link lands in the one tab: the first opens it, every next one names it again", async () => {
  const tab = browserTab("Google Chrome");
  await tab.open("http://concept.localhost:3002/dev-login?u=a&p=b");
  await tab.open("http://concept.localhost:3002/styles/7");
  assert.deepEqual(calls().slice(-2), ["http://concept.localhost:3002/dev-login?u=a&p=b|", "http://concept.localhost:3002/styles/7|41"], "no tab yet: a new window; then the tab it opened, by id");
});

test("two quick clicks wait their turn, so the second reuses the first's tab instead of opening a window", async () => {
  const tab = browserTab("Google Chrome");
  await Promise.all([tab.open("http://a.localhost/1"), tab.open("http://a.localhost/2")]);
  assert.deepEqual(calls().slice(-2), ["http://a.localhost/1|", "http://a.localhost/2|41"]);
});

test("the URL is an argument, never part of the script, and the browser's name is quoted", () => {
  const script = tabScript('Odd "Browser"');
  assert.match(script, /tell application "Odd \\"Browser\\""/);
  assert.doesNotMatch(script, /localhost/);
  assert.match(script, /set theUrl to item 1 of argv/);
});
