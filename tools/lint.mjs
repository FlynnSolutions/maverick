#!/usr/bin/env node
/**
 * `node --check` over every script in the repo: a syntax pass, which is the strongest check the
 * standard library gives with no dependency (decisions M15). Exit code is the first failure's.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["server.ts", "src", "test", "tools", "bin", "web", "app/main.mjs"];
const skip = new Set(["web/vendor"]);

const files = (path) => {
  if (skip.has(path)) return [];
  if (statSync(path).isFile()) return /\.(ts|mjs|js)$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
};

let failed = 0;
for (const file of roots.flatMap(files)) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "inherit"] });
  } catch {
    failed += 1;
  }
}
if (failed) {
  console.error(`lint: ${failed} file(s) failed node --check`);
  process.exit(1);
}
