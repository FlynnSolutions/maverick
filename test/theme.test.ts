/**
 * The page's palette helpers are pure, so the rule that a project's accent stays readable in
 * either mode is pinned here rather than found in a screenshot.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LIGHT_BAR, applyProjectTheme, contrast, holdsOn } from "../web/theme.js";

test("a project accent picked for the dark deck is taken darker until it reads at 4.5:1 on the light bar", () => {
  const held = holdsOn("#ffb36b", "#c6cdd3");
  assert.ok(contrast("#ffb36b", "#c6cdd3") < 4.5, "the orange as picked does not hold");
  assert.ok(contrast(held, "#c6cdd3") >= 4.5, `${held} holds`);
  assert.equal(holdsOn("#2b5296", "#c6cdd3"), "#2b5296", "an accent that already holds is left as it is");
  assert.equal(holdsOn("not a colour", "#c6cdd3"), "not a colour", "anything that is not a hex colour passes through");
});

test("a project's palette sets the hot accent twice, as picked for the dark deck and held on the light bar, and the stylesheet picks per theme", () => {
  const set = new Map<string, string>();
  applyProjectTheme({ setProperty: (k: string, v: string) => set.set(k, v) } as never, { accent: "#ff8a1f", accentHot: "#ffb36b", font: "Chakra Petch" });
  assert.equal(set.get("--project-hot"), "#ffb36b");
  assert.ok(contrast(set.get("--project-hot-light")!, LIGHT_BAR) >= 4.5);
  assert.ok(!set.has("--accent-hot"), "the page never sets the accent the stylesheet chooses per theme");
});
