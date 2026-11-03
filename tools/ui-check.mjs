#!/usr/bin/env node
/**
 * The page check CI runs on every pull request: the app rendered on the invented Harbor project,
 * one real write made through the page, and the commit it made read back. Then, when a ui-audit
 * is plugged in, its grade on the key states, which must be A.
 *
 *   node tools/ui-check.mjs [--out <dir>]
 *
 * The ui-audit is a slot, not a dependency: `MAVERICK_UI_AUDIT` names a folder holding a
 * ui-audit's `scripts/scan.mjs` and `scripts/grade.mjs` (flynn-core's, or your own with the same
 * contract). Unset, the grade is skipped and said so; the render and the write still run.
 * Chrome is found as the scanner finds it: `$CHROME`, else the macOS app, else on PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startHarbor } from "../test/harbor.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const out = arg("out", join(tmpdir(), `maverick-ui-check-${process.pid}`));
mkdirSync(out, { recursive: true });

const TITLE = "Survey the breakwater";
const BOARD = "/?project=harbor&view=board";

/** Submit the first lane's quick-add as a person would, and wait for the board to say it landed. */
const WRITE = `(async () => {
  const until = async (find, ms) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) { const hit = find(); if (hit) return hit; } return null; };
  const form = await until(() => document.querySelector(".quick-add"), 15000);
  if (!form) return "no quick-add on the board";
  form.querySelector("input").value = ${JSON.stringify(TITLE)};
  form.requestSubmit();
  const toast = await until(() => document.querySelector(".toast"), 10000);
  return toast ? toast.className + ": " + toast.textContent.trim() : "no toast after the add";
})()`;

/** The key states: the board as it opens, an item's drawer, and the board after the write landed. */
const manifest = (base) => ({
  base,
  routes: [
    { id: "board", path: BOARD, states: [
      { id: "default", steps: [{ waitFor: ".lane .card", timeout: 15000 }, { wait: 700 }], expect: ".lane .card" },
      { id: "item-drawer", steps: [{ waitFor: ".lane .card", timeout: 15000 }, { click: ".lane .card .title" }, { waitFor: ".drawer", timeout: 12000 }, { wait: 700 }], expect: ".drawer" },
      { id: "added", steps: [{ waitFor: ".lane .card", timeout: 15000 }, { wait: 700 }], expect: ".lane .card" },
    ] },
    { id: "picker", path: "/?pick=1", states: [
      { id: "default", steps: [{ waitFor: "#picker:not([hidden]) .project-list li", timeout: 15000 }, { wait: 700 }], expect: "#picker:not([hidden]) .project-list li" },
    ] },
  ],
});

const harbor = await startHarbor();
let failed = "";
try {
  const said = execFileSync(process.execPath, [join(root, "tools", "cdp.mjs"), `${harbor.url}${BOARD}`, "--eval", writeEval(), "--w", "1280", "--h", "900", "--wait", "3000"], { encoding: "utf8" }).trim();
  console.log(`write through the page: ${said}`);
  const subject = harbor.head();
  if (!subject.startsWith(`console: add "${TITLE}" under `)) failed = `the add did not commit: the newest commit is "${subject}"`;
  else if (harbor.git("status", "--porcelain")) failed = "the add left the tracker uncommitted";
  else console.log(`committed: ${harbor.git("log", "-1", "--format=%h %s").trim()}`);

  const audit = process.env.MAVERICK_UI_AUDIT;
  if (failed) {
    // A board that cannot save is not graded; the failure above is the result.
  } else if (!audit) {
    console.log("ui-audit: no MAVERICK_UI_AUDIT set, grade skipped");
  } else {
    writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest(harbor.url), null, 2), "utf8");
    execFileSync(process.execPath, [join(audit, "scripts", "scan.mjs"), "--manifest", join(out, "manifest.json"), "--out", out], { stdio: "inherit" });
    const card = execFileSync(process.execPath, [join(audit, "scripts", "grade.mjs"), join(out, "scan.json")], { encoding: "utf8" });
    console.log(card);
    // An A with rows that never rendered is "A (incomplete)", which is not a pass.
    if (!/^Overall: \*\*A\*\*\s*$/m.test(card)) failed = `ui-audit did not grade every key state A (card and scan in ${out})`;
  }
} finally {
  await harbor.stop();
}
if (failed) {
  console.error(`ui-check: ${failed}`);
  process.exit(1);
}

function writeEval() {
  const file = join(out, "write.js");
  writeFileSync(file, WRITE, "utf8");
  return file;
}
