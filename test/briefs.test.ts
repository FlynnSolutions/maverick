/**
 * Every brief comes from one template, so a path or an order that is right once is right for
 * every agent after it. These pin what each brief has to carry.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RIO_CHECKLIST, STANDING_ORDERS, planOnBranch, rioBrief, wingmanBrief, type BriefContext } from "../src/briefs.ts";

const repo = { label: "root", path: "/p/app", base: "main", branch: "mission/x", integration: "/p/app/.claude/worktrees/x-integration-root", land: "merge" as const };
const other = { label: "contracts", path: "/p/contracts", base: "main", branch: "mission/x", integration: "/p/contracts/.claude/worktrees/x-integration-contracts", land: "merge" as const };
const task = { id: "m1-t2", title: "The second thing", intent: "Build it in src/two.ts.", repo: "root", status: "flying" as const, attempts: 1, worktree: "/p/app/.claude/worktrees/x-m1-t2-root", branch: "mission/x-m1-t2", reviews: 2 };
const sibling = { id: "m1-t1", title: "The first thing", intent: "i", repo: "root", status: "flying" as const, attempts: 1 };
const ctx: BriefContext = {
  projectPath: "/p/app",
  mission: { id: "x", name: "X", plan: "deliverables/missions/x.md", repos: [repo] },
  milestone: { n: 1, title: "one", done: "both pass", tasks: [sibling, task] },
  task,
  repo,
};

test("the plan an agent is pointed at is the one on the mission branch, not the one on main", () => {
  assert.equal(planOnBranch("/p/app", "deliverables/missions/x.md", [repo]), "/p/app/.claude/worktrees/x-integration-root/deliverables/missions/x.md");
  // A plan no mission repo holds goes on the first repo's mission branch, never where the Lead wrote it (M8).
  assert.equal(planOnBranch("/p", "deliverables/missions/x.md", [repo, other]), `${repo.integration}/deliverables/missions/x.md`);
  assert.throws(() => planOnBranch("/p", "deliverables/missions/x.md", []), /names no repos/);
});

test("a Wingman's brief carries every absolute path, the standing orders and the RIO's checklist", () => {
  const brief = wingmanBrief(ctx);
  for (const needle of [task.worktree, repo.path, "/p/app/.claude/worktrees/x-integration-root/deliverables/missions/x.md", `${task.worktree}/.scratch/wingman`, "done when: both pass", task.intent, `git -C ${task.worktree} diff --name-only mission/x..HEAD`]) {
    assert.ok(brief.includes(needle), `missing: ${needle}`);
  }
  for (const line of [...STANDING_ORDERS, ...RIO_CHECKLIST]) assert.ok(brief.includes(`- ${line}`), `missing order: ${line.slice(0, 40)}`);
  assert.ok(!brief.includes("rejected your predecessor"), "a first attempt carries no findings");
});

test("a retry brief carries the findings verbatim and says what must still pass", () => {
  const brief = wingmanBrief(ctx, { findings: "verdict: mixed\n- BLOCKER: the test is vacuous\n- NOTE: a stray log line" });
  assert.ok(brief.includes("- BLOCKER: the test is vacuous"));
  assert.match(brief, /Fix every finding marked BLOCKER\. Fix a NOTE when it is cheap/);
  assert.match(brief, /must still pass/);
});

test("a RIO's brief names the branch to read, its own scratch path, its siblings and the findings file", () => {
  const brief = rioBrief(ctx, "/home/findings-2.md");
  for (const needle of [`git -C ${task.worktree} log mission/x..HEAD -p`, `${task.worktree}/.scratch/rio2`, "Write your findings to /home/findings-2.md", "Its siblings in this milestone", "The first thing", '"verdict: pass", "verdict: fail", "verdict: mixed"']) {
    assert.ok(brief.includes(needle), `missing: ${needle}`);
  }
  for (const line of RIO_CHECKLIST) assert.ok(brief.includes(`- ${line}`), `missing check: ${line.slice(0, 40)}`);
  assert.match(brief, /Do not fix anything\. Do not commit\./);
});

test("on a multi-repo mission the Wingman is told where the other repos' work is, and that none of it is on a base branch", () => {
  const brief = wingmanBrief({ ...ctx, mission: { ...ctx.mission, repos: [repo, other] } });
  assert.ok(brief.includes(`contracts: branch mission/x in /p/contracts, checked out at ${other.integration}`));
  assert.match(brief, /None of it has been merged to a base branch/);
});
