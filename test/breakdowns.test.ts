/**
 * The breakdown is the mission's gate shape pointed at a brainstorm: a document in a fixed
 * shape, parsed into items plus the reasons it cannot be written yet, and one write into the
 * tracker through the same group-and-item path. The parse and the write are pure.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBreakdown, writeBreakdown } from "../src/breakdowns.ts";
import { parseTracker } from "../src/trackers.ts";

const PROPOSAL = `# Breakdown: what the breakdown step should look like

The brainstorm asked how a brainstorm becomes items. This takes the three calls out of it.

## Items

- [ ] **A brainstorms rack on the workspace**
  - kind: feature
  - size: S
  - call: now
  List the documents under deliverables/brainstorms with their state.
  The verbs live there: propose, open the gate, read.

- [ ] **Per-item edits at the gate**
  - kind: feature
  - size: M
  - call: backlog
  Keep, drop, resize before one approve.

- [ ] **Breakdown as a mission**
  - kind: feature
  - size: L
  - call: mission
  The whole pipeline, across the console and the CAG.

## Already on the board

- the rule at the door — Brainstorm, breakdown, plan: the phases before an item reaches the board
`;

const TRACKER = `# Checklist

## 🔥 Priority

### Open source, for real

- [ ] **The public repo reads like one**
  - created: 2026-09-16

## 📋 Backlog

- [ ] **Checkbox flips from the board**
  - created: 2026-09-14

## ✅ Recently shipped
`;

test("a proposal parses into items with their kind, size and call, and the already-there list", () => {
  const b = parseBreakdown(PROPOSAL, ["Checkbox flips from the board"]);
  assert.deepEqual(b.problems, []);
  assert.equal(b.topic, "what the breakdown step should look like");
  assert.match(b.intro, /^The brainstorm asked/);
  assert.deepEqual(b.items.map((i) => [i.title, i.kind, i.size, i.call]), [
    ["A brainstorms rack on the workspace", "feature", "S", "now"],
    ["Per-item edits at the gate", "feature", "M", "backlog"],
    ["Breakdown as a mission", "feature", "L", "mission"],
  ]);
  assert.equal(b.items[0].body, "List the documents under deliverables/brainstorms with their state.\nThe verbs live there: propose, open the gate, read.", "the fields are not part of the body");
  assert.deepEqual(b.already, ["the rule at the door — Brainstorm, breakdown, plan: the phases before an item reaches the board"]);
});

test("a proposal that cannot be written says why: a bad call, a bad size, a one-line now item, a title already on the board", () => {
  const bad = PROPOSAL.replace("call: now\n  List the documents under deliverables/brainstorms with their state.\n  The verbs live there: propose, open the gate, read.", "call: now\n  One line.")
    .replace("size: M", "size: XL").replace("call: backlog", "call: later");
  const b = parseBreakdown(bad, ["Breakdown as a mission"]);
  assert.ok(b.problems.some((p) => /called now but says only one line/.test(p)), b.problems.join("; "));
  assert.ok(b.problems.some((p) => /size "XL"/.test(p)));
  assert.ok(b.problems.some((p) => /call "later"/.test(p)));
  assert.ok(b.problems.some((p) => /"Breakdown as a mission" is already on the board/.test(p)));
  assert.equal(parseBreakdown("# Notes\n\nnothing").problems.length, 2, "no heading and no items are both named");
});

test("approving writes now items to Priority and backlog items to Backlog under the brainstorm's group, and a mission item nowhere", () => {
  const b = parseBreakdown(PROPOSAL);
  const out = writeBreakdown(TRACKER, "CHECKLIST", b, "deliverables/brainstorms/2026-10-07-breakdown.md");
  const t = parseTracker(out);
  const priority = t.sections.find((s) => s.column === "priority")!;
  const backlog = t.sections.find((s) => s.column === "backlog")!;
  const group = "Brainstorm: what the breakdown step should look like";
  assert.deepEqual(priority.groups.find((g) => g.name === group)!.items.map((i) => i.title), ["A brainstorms rack on the workspace"]);
  assert.deepEqual(backlog.groups.find((g) => g.name === group)!.items.map((i) => i.title), ["Per-item edits at the gate"]);
  const landed = priority.groups.find((g) => g.name === group)!.items[0];
  assert.equal(landed.fields.kind, "feature");
  assert.equal(landed.fields.size, "S");
  assert.match(landed.fields.source ?? "", /^brainstorm deliverables\/brainstorms\/2026-10-07-breakdown\.md, \d{4}-\d{2}-\d{2}$/);
  assert.equal(landed.fields.plan, undefined, "a now item lands without a plan field: no plan file exists yet");
  assert.ok(!out.includes("Breakdown as a mission"), "the mission-sized item is the Strike Lead's to write");
  assert.deepEqual(priority.groups.map((g) => g.name), ["Open source, for real", group], "the existing group is untouched");
});

test("the stamp is the record: an approved proposal is recognised by it", async () => {
  const { isApproved } = await import("../src/breakdowns.ts");
  assert.equal(isApproved(PROPOSAL), false);
  assert.equal(isApproved(`${PROPOSAL}\n<!-- approved: 2026-10-08 · commit: ac1acb4 -->\n`), true);
});
