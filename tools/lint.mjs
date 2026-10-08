#!/usr/bin/env node
/**
 * `node --check` over every tracked script: a syntax pass, which is the strongest check the
 * standard library gives with no dependency (decisions M15). Exits 1 if any file fails.
 */
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-z", "--", "*.ts", "*.mjs", "*.js", ":!web/vendor"], { encoding: "utf8" }).split("\0").filter(Boolean);
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "inherit"] });
  } catch {
    failed += 1;
  }
}
if (failed) {
  console.error(`lint: ${failed} of ${files.length} files failed node --check`);
  process.exit(1);
}
