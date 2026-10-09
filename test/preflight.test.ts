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
  const { requirements, problems } = parseRequirements(["duration: 8h", "tool: docker", "credential: aws, the dev stack", "human: the sign-up inbox, the plan marks sign-in as human-verified", "something else"]);
  assert.deepEqual(requirements, [
    { kind: "duration", value: "8h", note: "" },
    { kind: "tool", value: "docker", note: "" },
    { kind: "credential", value: "aws", note: "the dev stack" },
    { kind: "human", value: "the sign-up inbox", note: "the plan marks sign-in as human-verified" },
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
});

test("the plan's Preflight section is read, and the checks say ok, fail or yours", async () => {
  const { dir } = tempRepo("mv-preflight");
  await writeFile(join(dir, ".nvmrc"), "99\n", "utf8");
  const plan = parsePlan("# Mission: p\n\nP.\n\n## Milestone 1 — m\n\n_done when: d._\n\n- [ ] **t**\n  Build it.\n\n## Preflight\n\n- duration: 8h\n- tool: git\n- tool: no-such-tool-xyz, the plan shells out to it\n- human: the sign-up inbox\n", ["root"]);
  assert.equal(plan.problems.length, 0, plan.problems.join("; "));
  assert.equal(plan.requirements.length, 4);
  const checks = await preflight({ projectPath: dir, repoPaths: [dir], requirements: plan.requirements, rioAgent: "no-such-agent-xyz", landsRemotely: false });
  const by = Object.fromEntries(checks.map((c) => [c.name, c]));
  assert.equal(by["git"].status, "ok");
  assert.equal(by["no-such-tool-xyz"].status, "fail");
  assert.match(by["no-such-tool-xyz"].detail, /not on PATH; the plan shells out to it/);
  assert.equal(by["agent no-such-agent-xyz"].status, "fail", "a RIO that would fall back to an agent that can edit");
  assert.equal(by["the sign-up inbox"].status, "human");
  assert.equal(by[`node pin in ${dir.split("/").pop()}`].status, "fail");
  assert.match(by[`node pin in ${dir.split("/").pop()}`].detail, /wants 99, host has v22/);
  assert.equal(by["host"].status, "ok");
  assert.ok(checks.some((c) => c.name === "disk"));
});
