import assert from "node:assert/strict";
import { test } from "node:test";
import { aboutOf } from "../src/about.ts";

test("a server knows whether it runs packed in an app or from a checkout", () => {
  assert.deepEqual(aboutOf("/Applications/Maverick.app/Contents/Resources/app"), { source: "/Applications/Maverick.app/Contents/Resources/app", packed: true });
  assert.equal(aboutOf("/Users/someone/Projects/maverick").packed, false);
  assert.equal(aboutOf("/Users/someone/Projects/maverick/.claude/worktrees/x").packed, false, "a worktree is a checkout too");
});
