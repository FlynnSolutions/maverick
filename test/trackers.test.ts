/**
 * The board's own writes: an item typed into a lane lands where it was typed, as an ordinary item.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMove, newItem, parseTracker, today } from "../src/trackers.ts";

const TRACKER = `# T

## 🔥 Priority

### Harbor docks

- [ ] \`[ENG]\` **Chart the north pier**
  - created: 2026-01-02

## 📋 Backlog
`;

test("an item typed into a group lands last in it, open and dated today", () => {
  const text = newItem(TRACKER, "🔥 Priority", "Harbor docks", "  Paint the bollards  ");
  const items = parseTracker(text).sections[0].groups.find((g) => g.name === "Harbor docks").items;
  assert.deepEqual(items.map((i) => i.title), ["Chart the north pier", "Paint the bollards"]);
  assert.equal(items[1].checked, false);
  assert.equal(items[1].fields.created, today());
});

test("an item typed into a lane with no groups lands in the lane, and moves like any other", () => {
  const text = newItem(TRACKER, "📋 Backlog", "", "Survey the breakwater");
  const item = parseTracker(text).sections[1].groups.flatMap((g) => g.items)[0];
  assert.equal(item.title, "Survey the breakwater");
  const moved = applyMove(text, { itemStart: item.start, itemFirstLine: item.firstLine, targetHeading: "🔥 Priority", targetGroup: "Harbor docks", targetIndex: 0 });
  assert.deepEqual(parseTracker(moved).sections[0].groups.find((g) => g.name === "Harbor docks").items.map((i) => i.title), ["Survey the breakwater", "Chart the north pier"]);
});

test("a title is one non-empty line", () => {
  assert.throws(() => newItem(TRACKER, "📋 Backlog", "", "   "), /one non-empty line/);
  assert.throws(() => newItem(TRACKER, "📋 Backlog", "", "two\nlines"), /one non-empty line/);
});
