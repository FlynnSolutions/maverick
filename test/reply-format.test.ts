/**
 * The reply shape is a contract between the prompt and the page: the prompt asks for six bold
 * labels, the page shows them as blocks. The parser has to read what agents actually write
 * (a colon instead of a full stop, a label it was not asked for, prose before the first one)
 * and refuse what only looks like the shape.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { REPLY_FORMAT, REPLY_SECTIONS, parseReply } from "../src/reply-format.ts";
import { toolKind } from "../src/transcript-view.ts";

const REPLY = `Looked at the three files you named.

**Answer.** The bug is in the parser, not the renderer.

**What changed.**
- \`src/trackers.ts\`: the field regex allows a dash.
- nothing else

**Decisions.** Kept the regex rather than a tokenizer; easy to reverse.

**Verified:** ran \`npm test\`, 27 pass.

**Open.** Nothing.

**TL;DR.** One regex, tests green.`;

test("a reply in the format parses into its sections, in order, with the prose before the first label kept", () => {
  const r = parseReply(REPLY)!;
  assert.ok(r);
  assert.equal(r.lead, "Looked at the three files you named.");
  assert.deepEqual(r.sections.map((s) => s.label), [...REPLY_SECTIONS]);
  assert.equal(r.sections[0].body, "The bug is in the parser, not the renderer.");
  assert.match(r.sections[1].body, /^- `src\/trackers.ts`/);
  assert.equal(r.sections[3].body, "ran `npm test`, 27 pass.", "a colon after the label reads the same as a full stop");
  assert.equal(r.sections.at(-1)!.body, "One regex, tests green.");
});

test("one bold label is not the format", () => {
  assert.equal(parseReply("**Answer.** yes\n\nand then a lot of prose with **bold** in it"), null);
  assert.equal(parseReply("plain prose"), null);
});

test("the prompt names every section the parser knows, in the same order", () => {
  const named = [...REPLY_FORMAT.matchAll(/^\*\*(.+?)\.\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(named, [...REPLY_SECTIONS]);
});

test("a tool call is classified by what it does, and a test run is told apart from any other command", () => {
  assert.equal(toolKind("Edit", { file_path: "a.ts" }), "edit");
  assert.equal(toolKind("Write", {}), "edit");
  assert.equal(toolKind("Bash", { command: "npm test" }), "test");
  assert.equal(toolKind("Bash", { command: "cd x && node --test test/a.test.ts" }), "test");
  assert.equal(toolKind("Bash", { command: "git status" }), "run");
  assert.equal(toolKind("Read", { file_path: "a" }), "read");
  assert.equal(toolKind("Grep", {}), "search");
  assert.equal(toolKind("Agent", {}), "agent");
  assert.equal(toolKind("WebFetch", {}), "web");
  assert.equal(toolKind("mcp__something", {}), "other");
});
