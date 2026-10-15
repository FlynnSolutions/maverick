/**
 * The summary is asked for as three bullets and kept as three, whatever the session wrote. These
 * pin the cut: the first three top-level items, each at its first line, prose only when the list
 * runs short, and nothing from nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { threeBullets } from "../src/summary.ts";

test("a summary that says too much is cut to its first three top-level items, each at its first line", () => {
  const text = [
    "# Summary",
    "",
    "Here is what matters.",
    "",
    "- Fix the worker that retries jobs before merge.",
    "  It never reads the attempt count.",
    "  - a nested point under it",
    "* The sign-in page was not checked.",
    "and a lazy second line",
    "+ The report page is fine to ship.",
    "- A fourth thing nobody asked for.",
  ].join("\n");
  assert.equal(threeBullets(text), [
    "- Fix the worker that retries jobs before merge.",
    "- The sign-in page was not checked.",
    "- The report page is fine to ship.",
  ].join("\n"));
});

test("a numbered list comes back as bullets", () => {
  assert.equal(threeBullets("1. One thing.\r\n2) Two things.\r\n3. Three things.\r\n4. Four."), "- One thing.\n- Two things.\n- Three things.");
});

test("a short list is topped up with the first sentence of its prose, never past three", () => {
  assert.equal(threeBullets("- Fix the worker.\n- Ship the page.\n\nAll else is safe to merge. Nothing more."), "- Fix the worker.\n- Ship the page.\n- All else is safe to merge.");
  assert.equal(threeBullets("- Only one.\n\nThe rest is fine.\n\nA second paragraph."), "- Only one.\n- The rest is fine.");
});

test("prose with no list is its first sentence as one bullet", () => {
  assert.equal(threeBullets("Everything is safe to merge as is. The RIOs agreed.\nNothing was left unchecked."), "- Everything is safe to merge as is.");
  assert.equal(threeBullets("No full stop at all"), "- No full stop at all");
});

test("an empty text is an empty string", () => {
  assert.equal(threeBullets(""), "");
  assert.equal(threeBullets("  \n\n"), "");
});
