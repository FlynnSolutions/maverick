/**
 * Planned is the presence of a `plan:` field that resolves to a real file, not a status word:
 * a path can be checked and a word is a claim. The field is written by hand in more than one
 * shape already (a bare path, a path with prose after it, a path with a section anchor), so
 * resolution has to read all of them.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { planFileFor, planPath, resolvePlan } from "../src/plans.ts";

const root = await mkdtemp(join(tmpdir(), "mv-plans-"));
await mkdir(join(root, "deliverables", "plans"), { recursive: true });
await writeFile(join(root, "deliverables", "plans", "shared-boards.md"), "# plan\n", "utf8");
await writeFile(join(root, "deliverables", "ROOT-PLAN.md"), "# plan\n", "utf8");
const project = { id: "p", name: "P", path: root, trackers: [] } as never;
const tracker = join(root, "deliverables", "CHECKLIST.md");

test("the path in a plan field is its first word, without an anchor or trailing punctuation", () => {
  assert.equal(planPath("plans/shared-boards.md"), "plans/shared-boards.md");
  assert.equal(planPath("plans/shared-boards.md (PLAN OF RECORD, written Thursday)"), "plans/shared-boards.md");
  assert.equal(planPath("plans/shared-boards.md#5-the-thumbnail"), "plans/shared-boards.md");
  assert.equal(planPath("plans/shared-boards.md."), "plans/shared-boards.md");
  assert.equal(planPath(undefined), null);
  assert.equal(planPath("   "), null);
});

test("a plan resolves from the tracker's folder first, then the project root, and never outside the project", async () => {
  assert.equal(await resolvePlan(project, tracker, "plans/shared-boards.md"), "deliverables/plans/shared-boards.md");
  assert.equal(await resolvePlan(project, tracker, "deliverables/ROOT-PLAN.md"), "deliverables/ROOT-PLAN.md");
  assert.equal(await resolvePlan(project, tracker, "plans/missing.md"), null, "a field naming no file is not a plan");
  assert.equal(await resolvePlan(project, tracker, "../../../etc/passwd"), null);
  assert.equal(await resolvePlan(project, tracker, undefined), null);
});

test("a new plan lands beside the tracker, named after the item and the day", () => {
  const item = { title: "Checkbox flips from the board", start: 0, end: 1, checked: false, tags: [], firstLine: "", body: "", fields: {}, description: "" };
  const plan = planFileFor(tracker, item);
  assert.match(plan.field, /^plans\/checkbox-flips-from-the-board-\d{4}-\d{2}-\d{2}\.md$/);
  assert.equal(plan.full, join(root, "deliverables", plan.field));
});
