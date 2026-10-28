/** The gate-1 preflight: what a machine can check before a person approves and leaves. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { tempRepo } from "./fixtures.ts";

// config.ts reads this once when the module graph loads, so it is set before the imports below.
const claudeHome = mkdtempSync(join(tmpdir(), "mv-claude-"));
process.env.CLAUDE_CONFIG_DIR = claudeHome;
const { hoursOf, parseRequirements, preflight, untrusted, versionMeets } = await import("../src/preflight.ts");
const { parsePlan } = await import("../src/missions.ts");

test("a preflight line names its kind, what, and a note", () => {
  const { requirements, problems } = parseRequirements(["duration: 8h", "**tool**: `docker`", "**tool:** gh", "credential: aws dev, the dev stack, and staging", "human: check the inbox, then click the link", "something else"]);
  assert.deepEqual(requirements, [
    { kind: "duration", value: "8h", note: "" },
    { kind: "tool", value: "docker", note: "" },
    { kind: "tool", value: "gh", note: "" },
    { kind: "credential", value: "aws dev", note: "the dev stack, and staging" },
    { kind: "human", value: "check the inbox, then click the link", note: "" },
  ]);
  assert.match(problems[0], /"something else" is not/);
  assert.equal(hoursOf("8h"), 8); assert.equal(hoursOf("90m"), 1.5); assert.equal(hoursOf("2d"), 48); assert.equal(hoursOf("soon"), undefined);
});

test("a runtime pin is read the way a Wingman would hit it", () => {
  assert.equal(versionMeets(">=22.18", "v22.21.1"), true);
  assert.equal(versionMeets(">=24", "v22.21.1"), false, "the first mission's Node 22 against 24");
  assert.equal(versionMeets("22", "v22.21.1"), true);
  assert.equal(versionMeets("24\n", "v22.21.1"), false);
  assert.equal(versionMeets("^20", "v22.0.0"), false, "a caret pin is that major");
  assert.equal(versionMeets("lts/*", "v22.0.0"), undefined, "a pin it cannot read is not a verdict");
  assert.equal(versionMeets("20 || 22", "v22.21.1"), true);
  assert.equal(versionMeets(">=18 <23", "v24.1.0"), false);
  assert.equal(versionMeets(">=18 <23", "v22.1.0"), true);
  assert.equal(versionMeets(">22", "v22.21.1"), false);
  assert.equal(versionMeets(">22", "v24.1.0"), true);
  assert.equal(versionMeets("~22.21", "v22.21.1"), true);
  assert.equal(versionMeets("node", "v22.0.0"), undefined);
  assert.equal(versionMeets("<=22", "v22.21.1"), true, "a pin with no minor is the whole major");
  assert.equal(versionMeets(">22.x", "v22.21.1"), false);
});

test("the plan's Preflight section is read, and the checks say ok, fail or yours", async () => {
  const { dir } = tempRepo("mv-preflight");
  await writeFile(join(dir, ".nvmrc"), "99\n", "utf8");
  const plan = parsePlan("# Mission: p\n\nP.\n\n## Milestone 1 — m\n\n_done when: d._\n\n- [ ] **t**\n  Build it.\n\n## Preflight\n\n- duration: 8h\n- tool: git\n- tool: no-such-tool-xyz, the plan shells out to it\n- human: the sign-up inbox\n", ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.equal(plan.requirements.length, 4);
  const checks = await preflight({ projectPath: dir, repoPaths: [dir], requirements: [...plan.requirements, { kind: "runtime", value: "node >=99", note: "" }, { kind: "credential", value: "okta", note: "" }], rioAgent: "no-such-agent-xyz", remote: [] });
  const by = Object.fromEntries(checks.map((c) => [c.name, c]));
  assert.equal(by["git"].status, "ok");
  assert.deepEqual([by["no-such-tool-xyz"].status, by["no-such-tool-xyz"].refuses], ["fail", true], "a declared tool refuses approval when missing");
  assert.match(by["no-such-tool-xyz"].detail, /not on PATH; the plan shells out to it/);
  assert.deepEqual([by["agent no-such-agent-xyz"].status, by["agent no-such-agent-xyz"].refuses], ["fail", true], "a RIO that would run without its standing orders");
  assert.equal(by[`node pin in ${dir.split("/").pop()}`].refuses, true, "a repo's own pin refuses the same way a runtime line does");
  assert.equal(by["the sign-up inbox"].refuses, false);
  assert.equal(by["the sign-up inbox"].status, "human");
  assert.equal(by["okta"].status, "human", "a credential this check cannot read is the person's");
  assert.equal(by["node"].status, "fail", "a runtime line with a version is a pin to meet");
  assert.equal(by[`node pin in ${dir.split("/").pop()}`].status, "fail");
  assert.match(by[`node pin in ${dir.split("/").pop()}`].detail, /wants 99, the shell has v\d+/);
  assert.equal(by["host"].status, "ok");
  assert.ok(checks.some((c) => c.name === "disk"));
});

test("a repo Claude Code has not trusted fails loud, and a trusted parent does not count for it", async () => {
  const state = JSON.stringify({ projects: { "/w": { hasTrustDialogAccepted: true }, "/w/front": { hasTrustDialogAccepted: false } } });
  assert.deepEqual(untrusted(state, ["/w", "/w/contracts", "/w/front"]), ["/w/contracts", "/w/front"]);
  assert.equal(untrusted("", ["/w"]), null, "an unreadable state file is not a verdict");
  const { dir } = tempRepo("mv-trust");
  const trustOf = async () => (await preflight({ projectPath: dir, repoPaths: [dir], requirements: [], rioAgent: "rio", remote: [] })).filter((c) => c.kind === "trust" || c.name === "workspace trust");
  await writeFile(join(claudeHome, ".claude.json"), JSON.stringify({ projects: {} }), "utf8");
  assert.deepEqual((await trustOf()).map((c) => [c.status, c.refuses]), [["fail", false]], "loud, but read from a file Claude Code owns, so it does not refuse");
  await writeFile(join(claudeHome, ".claude.json"), JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true } } }), "utf8");
  assert.deepEqual((await trustOf()).map((c) => c.status), ["ok"]);
});

test("a repo set to land remotely with no git remote refuses approval, with the fix in the line", async () => {
  const { dir, git } = tempRepo("mv-remote");
  const landing = async () => (await preflight({ projectPath: dir, repoPaths: [dir], requirements: [], rioAgent: "rio", remote: [{ label: "root", path: dir }] })).find((c) => c.kind === "landing")!;
  const none = await landing();
  assert.deepEqual([none.status, none.refuses], ["fail", true]);
  assert.match(none.detail, /has no git remote; add one, or set its land to merge in maverick\.json/);
  git("remote", "add", "origin", "https://example.test/r.git");
  const some = await landing();
  assert.deepEqual([some.status, some.detail], ["ok", "origin"]);
  assert.equal((await preflight({ projectPath: dir, repoPaths: [dir], requirements: [], rioAgent: "rio", remote: [] })).some((c) => c.kind === "landing"), false, "a repo that merges needs no remote");
});
