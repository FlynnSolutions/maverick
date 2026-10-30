/**
 * The page's palette helpers are pure, so the rule that a project's accent stays readable in
 * either mode is pinned here rather than found in a screenshot.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { holdsOn, luminance } from "../web/theme.js";

const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test("a project accent picked for the dark deck is taken darker until it reads at 4.5:1 on the light bar", () => {
  const held = holdsOn("#ffb36b", "#c6cdd3");
  assert.ok(contrast("#ffb36b", "#c6cdd3") < 4.5, "the orange as picked does not hold");
  assert.ok(contrast(held, "#c6cdd3") >= 4.5, `${held} holds`);
  assert.equal(holdsOn("#2b5296", "#c6cdd3"), "#2b5296", "an accent that already holds is left as it is");
  assert.equal(holdsOn("not a colour", "#c6cdd3"), "not a colour", "anything that is not a hex colour passes through");
});
