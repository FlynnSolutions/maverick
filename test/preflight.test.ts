/** The gate-1 preflight: what a machine can check before a person approves and leaves. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { hoursOf, parseRequirements, preflight, versionMeets } from "../src/preflight.ts";
import { parsePlan } from "../src/missions.ts";
import { tempRepo } from "./fixtures.ts";

test("a preflight line names its kind, what, and a note", () => {
  const { requirements, problems } = parseRequirements(["duration: 8h", "**tool**: `docker`", "credential: aws dev, the dev stack, and staging", "human: check the inbox, then click the link", "something else"]);
  assert.deepEqual(requirements, [
    { kind: "duration", value: "8h", note: "" },
    { kind: "tool", value: "docker", note: "" },
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
});

test("the plan's Preflight section is read, and the checks say ok, fail or yours", async () => {
  const { dir } = tempRepo("mv-preflight");
  await writeFile(join(dir, ".nvmrc"), "99\n", "utf8");
  const plan = parsePlan("# Mission: p\n\nP.\n\n## Milestone 1 — m\n\n_done when: d._\n\n- [ ] **t**\n  Build it.\n\n## Preflight\n\n- duration: 8h\n- tool: git\n- tool: no-such-tool-xyz, the plan shells out to it\n- human: the sign-up inbox\n", ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.equal(plan.requirements.length, 4);
  const checks = await preflight({ projectPath: dir, repoPaths: [dir], requirements: [...plan.requirements, { kind: "runtime", value: "node >=99", note: "" }, { kind: "credential", value: "okta", note: "" }], rioAgent: "no-such-agent-xyz", landsRemotely: false });
  const by = Object.fromEntries(checks.map((c) => [c.name, c]));
  assert.equal(by["git"].status, "ok");
  assert.deepEqual([by["no-such-tool-xyz"].status, by["no-such-tool-xyz"].blocking], ["fail", true], "a declared tool refuses approval when missing");
  assert.match(by["no-such-tool-xyz"].detail, /not on PATH; the plan shells out to it/);
  assert.deepEqual([by["agent no-such-agent-xyz"].status, by["agent no-such-agent-xyz"].blocking], ["fail", true], "a RIO that would run without its standing orders");
  assert.equal(by["the sign-up inbox"].status, "human");
  assert.equal(by["okta"].status, "human", "a credential this check cannot read is the person's");
  assert.equal(by["node"].status, "fail", "a runtime line with a version is a pin to meet");
  assert.equal(by[`node pin in ${dir.split("/").pop()}`].status, "fail");
  assert.match(by[`node pin in ${dir.split("/").pop()}`].detail, /wants 99, the shell has v\d+/);
  assert.equal(by["host"].status, "ok");
  assert.ok(checks.some((c) => c.name === "disk"));
});
