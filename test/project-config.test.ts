/**
 * `maverick.json` is hand-edited and it decides whether a remote branch moves. Every case here
 * is one a review found reachable by writing the file wrong, not a hypothetical.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_MISSION_CONFIG, missionConfigFor } from "../src/project-config.ts";

const withConfig = async (missions: unknown) => {
  const dir = await mkdtemp(join(tmpdir(), "mv-cfg-"));
  await writeFile(join(dir, "maverick.json"), JSON.stringify({ callsign: "X", missions }), "utf8");
  return missionConfigFor(dir);
};

test("a project with no maverick.json gets Maverick's own defaults, and they do not push", async () => {
  const cfg = await missionConfigFor(await mkdtemp(join(tmpdir(), "mv-none-")));
  assert.deepEqual(cfg, DEFAULT_MISSION_CONFIG);
  assert.equal(cfg.land, "merge");
});

test("`push` is refused at the mission level, where it would apply to every repo", async () => {
  const cfg = await withConfig({ land: "push" });
  assert.equal(cfg.land, "merge", "a mission-wide push is the thing the per-repo rule exists to prevent");
});

test("`push` is honoured per repo, which is the opt-in by name M10 requires", async () => {
  const cfg = await withConfig({ land: "pr", repos: { contracts: { base: "main", land: "push" } } });
  assert.equal(cfg.land, "pr");
  assert.equal(cfg.repos.contracts.land, "push");
  assert.equal(cfg.repos.contracts.base, "main");
});

test("a branch prefix that would put the mission on a base branch is refused", async () => {
  for (const bad of ["", " ", "main", "refs", "x", "..", "a..b/"]) {
    const cfg = await withConfig({ branchPrefix: bad });
    assert.equal(cfg.branchPrefix, DEFAULT_MISSION_CONFIG.branchPrefix, `"${bad}" must not be taken as a prefix`);
  }
  for (const good of ["feature/", "mission/", "mv-"]) {
    assert.equal((await withConfig({ branchPrefix: good })).branchPrefix, good);
  }
});

test("a branch prefix git would read as a flag is refused", async () => {
  for (const bad of ["-", "-m", "--force/", "-D-"]) {
    assert.equal((await withConfig({ branchPrefix: bad })).branchPrefix, DEFAULT_MISSION_CONFIG.branchPrefix);
  }
});

test("a base that is not plainly a branch name is dropped rather than reaching git", async () => {
  const cfg = await withConfig({ repos: { a: { base: "--upload-pack=x" }, b: { base: ["main"] }, c: { base: "../../etc" }, d: { base: "develop" } } });
  assert.equal(cfg.repos.a.base, undefined);
  assert.equal(cfg.repos.b.base, undefined);
  assert.equal(cfg.repos.c.base, undefined);
  assert.equal(cfg.repos.d.base, "develop", "a real branch name still comes through");
});

test("a misspelt landing falls back rather than becoming a third behaviour", async () => {
  const cfg = await withConfig({ repos: { a: { land: "Push" }, b: { land: "push " }, c: { land: 1 } } });
  for (const label of ["a", "b", "c"]) assert.equal(cfg.repos[label].land, undefined);
});

test("a worktree root outside the project is refused", async () => {
  for (const bad of ["/tmp/anywhere", "../sibling", "a/../../b"]) {
    assert.equal((await withConfig({ worktrees: bad })).worktrees, DEFAULT_MISSION_CONFIG.worktrees);
  }
  assert.equal((await withConfig({ worktrees: "worktrees" })).worktrees, "worktrees");
});

test("junk in repos does not become a repo", async () => {
  const cfg = await withConfig({ repos: ["a", "b"] });
  assert.deepEqual(cfg.repos, {});
  assert.deepEqual((await withConfig({ repos: { a: "main", b: null, c: {} } })).repos, { c: {} });
});

test("an agent name that is not plainly a name never reaches the CLI", async () => {
  for (const bad of ["--dangerously-skip-permissions", "a b", "", "x/y", 7]) {
    assert.equal((await withConfig({ wingmanAgent: bad })).wingmanAgent, undefined);
    assert.equal((await withConfig({ rioAgent: bad })).rioAgent, "auditor", "the RIO falls back rather than losing its agent");
  }
  assert.equal((await withConfig({ wingmanAgent: "wingman" })).wingmanAgent, "wingman");
  assert.equal((await withConfig({ rioAgent: "reviewer-2" })).rioAgent, "reviewer-2");
});

test("a project that says nothing gets no Wingman agent, which is the state the gate warns about", async () => {
  assert.equal(DEFAULT_MISSION_CONFIG.wingmanAgent, undefined);
  assert.equal(DEFAULT_MISSION_CONFIG.rioAgent, "auditor");
});
