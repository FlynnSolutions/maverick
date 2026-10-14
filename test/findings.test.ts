/** The finding record: a RIO's line read into kind, area, severity, headline and detail. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { areaName, keyOf, parseFinding, triage, type Finding } from "../src/findings.ts";

test("parseFinding reads the new shape: kind, area, severity, headline and detail", () => {
  const line = "NOTE(web/signin, ship): focus is lost. The Wingman called it out of scope.";
  assert.deepEqual(parseFinding(line), { kind: "NOTE", area: "web/signin", severity: "ship", headline: "focus is lost.", detail: "The Wingman called it out of scope.", raw: line });
  const blocker = parseFinding("blocker(the sign-in form, fix): the button submits twice. Two POSTs in the log.");
  assert.equal(blocker.kind, "BLOCKER");
  assert.equal(blocker.area, "the sign-in form");
  assert.equal(blocker.severity, "fix");
  assert.equal(blocker.headline, "the button submits twice.");
  assert.equal(blocker.detail, "Two POSTs in the log.");
});

test("the line names the severity, even against the kind's default", () => {
  assert.equal(parseFinding("NOTE(src/worker, fix): retries forever. No cap.").severity, "fix");
  assert.equal(parseFinding("BLOCKER(src/worker, ship): fine as is.").severity, "ship");
  assert.equal(parseFinding("NOTE(src/worker, CHECK): the deploy.").severity, "check");
});

test("a parenthetical without a known severity is all area, and the kind decides", () => {
  const f = parseFinding("UNVERIFIED(web/signin/): the deploy.");
  assert.equal(f.area, "web/signin");
  assert.equal(f.severity, "check");
  const g = parseFinding("NOTE(retries, backoff, minor): too slow.");
  assert.equal(g.area, "retries, backoff, minor");
  assert.equal(g.severity, "ship");
  assert.equal(parseFinding("NOTE(): empty.").area, "general");
});

test("a line that leads with a kind keeps it when the parenthetical is untidy", () => {
  const cases: [string, Finding["kind"], string, Finding["severity"], string][] = [
    ["BLOCKER(web/signin (form), fix): the button submits twice. Two POSTs.", "BLOCKER", "web/signin (form)", "fix", "the button submits twice."],
    ["BLOCKER (src/worker, fix): never stops.", "BLOCKER", "src/worker", "fix", "never stops."],
    ["BLOCKER(src/worker, fix) : never stops.", "BLOCKER", "src/worker", "fix", "never stops."],
    ["BLOCKER(src/worker, fix) never stops.", "BLOCKER", "src/worker", "fix", "never stops."],
    ["blocker : spaced colon.", "BLOCKER", "general", "fix", "spaced colon."],
    ["BLOCKER(a, fix): x (y): z", "BLOCKER", "a", "fix", "x (y): z"],
  ];
  for (const [line, kind, area, severity, headline] of cases) {
    const f = parseFinding(line);
    assert.deepEqual([f.kind, f.area, f.severity, f.headline], [kind, area, severity, headline], line);
  }
  assert.equal(parseFinding("Blocker removed, all good.").kind, "NOTE");
});

test("a parenthetical that is only a severity leaves the area general", () => {
  const f = parseFinding("NOTE(fix): bare severity.");
  assert.deepEqual([f.area, f.severity], ["general", "fix"]);
});

test("the old shape is read in area general with the kind's severity", () => {
  const cases: [string, Finding["kind"], Finding["severity"]][] = [
    ["BLOCKER: the worker never stops. It loops.", "BLOCKER", "fix"],
    ["NOTE: a stray log line. In src/worker.ts.", "NOTE", "ship"],
    ["UNVERIFIED: the deploy. No access to staging.", "UNVERIFIED", "check"],
    ["note: lowercase kind.", "NOTE", "ship"],
  ];
  for (const [line, kind, severity] of cases) {
    const f = parseFinding(line);
    assert.deepEqual([f.kind, f.area, f.severity], [kind, "general", severity], line);
  }
  assert.equal(parseFinding("BLOCKER: the worker never stops. It loops.").headline, "the worker never stops.");
  assert.equal(parseFinding("BLOCKER: the worker never stops. It loops.").detail, "It loops.");
});

test("bare prose is a note: how settleReview carries a note", () => {
  assert.deepEqual(parseFinding("tidy the log"), { kind: "NOTE", area: "general", severity: "ship", headline: "tidy the log", detail: "", raw: "tidy the log" });
});

test("a carried line starting unverified: is an UNVERIFIED", () => {
  const f = parseFinding("unverified: the deploy. Staging was down.");
  assert.deepEqual([f.kind, f.area, f.severity, f.headline, f.detail], ["UNVERIFIED", "general", "check", "the deploy.", "Staging was down."]);
});

test("headline: the first sentence, else the whole line under 120 characters, else cut at a word", () => {
  const short = "no sentence break here, just a note";
  assert.deepEqual([parseFinding(short).headline, parseFinding(short).detail], [short, ""]);
  assert.equal(parseFinding("v1.2 ships. The rest").headline, "v1.2 ships.");
  const long = `${"word ".repeat(30)}end`;
  const f = parseFinding(long);
  assert.ok(f.headline.length <= 120, `headline is ${f.headline.length} characters`);
  assert.ok(!f.headline.endsWith(" ") && f.detail.length > 0);
  assert.equal(`${f.headline} ${f.detail}`, long);
  const edge = `${"x".repeat(115)} yyy`;
  assert.equal(edge.length, 119);
  assert.equal(parseFinding(edge).headline, edge);
  assert.equal(parseFinding(`${edge}y`).headline, "x".repeat(115));
  assert.equal(parseFinding(`${edge}. tail`).headline, `${edge}.`);
  const late = parseFinding(`${"word ".repeat(40)}end. tail`);
  assert.ok(late.headline.length <= 120, `headline is ${late.headline.length} characters`);
  assert.ok(late.detail.endsWith("end. tail"));
});

test("an abbreviation does not end the headline", () => {
  const f = parseFinding("BLOCKER: use e.g. a cap here. More.");
  assert.deepEqual([f.headline, f.detail], ["use e.g. a cap here.", "More."]);
  assert.equal(parseFinding("NOTE: one i.e. two. Three.").headline, "one i.e. two.");
});

test("areaName drops a trailing slash and leaves plain names alone", () => {
  assert.equal(areaName("web/signin/"), "web/signin");
  assert.equal(areaName("web/signin"), "web/signin");
  assert.equal(areaName("the sign-in form"), "the sign-in form");
});

test("keyOf is the task id and the first 8 hex of the sha1 of the raw line, the same every time", () => {
  const line = "NOTE(web/signin, ship): focus is lost.";
  const sha = createHash("sha1").update(line).digest("hex").slice(0, 8);
  assert.equal(keyOf(parseFinding(line), "m1-t1"), `m1-t1:${sha}`);
  assert.equal(keyOf(parseFinding(` ${line} `), "m1-t1"), `m1-t1:${sha}`);
  assert.notEqual(keyOf(parseFinding("NOTE: other."), "m1-t1"), `m1-t1:${sha}`);
});

test("triage buckets by severity and groups each bucket by area in first-seen order", () => {
  const lines = [
    "NOTE(web/a, ship): one.",
    "BLOCKER(src/x, fix): two.",
    "NOTE(web/b, ship): three.",
    "UNVERIFIED: four.",
    "NOTE(web/a/, ship): five.",
    "BLOCKER(src/y, fix): six.",
    "NOTE(src/x, fix): seven.",
    "unverified: eight.",
  ];
  const t = triage(lines.map((l) => parseFinding(l)));
  const heads = (fs: Finding[]): string[] => fs.map((f) => f.headline);
  assert.deepEqual(heads(t.fix), ["two.", "seven.", "six."]);
  assert.deepEqual(heads(t.check), ["four.", "eight."]);
  assert.deepEqual(heads(t.ship), ["one.", "five.", "three."]);
  assert.deepEqual(Object.keys(t), ["fix", "check", "ship"]);
});
