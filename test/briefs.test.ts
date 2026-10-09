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
const milestone = { n: 1, title: "one", done: "both pass", tasks: [sibling, task] };
const ctx: BriefContext = {
  projectPath: "/p/app",
  mission: { id: "x", name: "X", plan: "deliverables/missions/x.md", repos: [repo], milestones: [milestone] },
  milestone,
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
  for (const needle of [task.worktree, repo.path, "/p/app/.claude/worktrees/x-integration-root/deliverables/missions/x.md", `${task.worktree}/.scratch/wingman`, "done when: both pass", task.intent, `git -C ${task.worktree} diff --name-only mission/x...HEAD`]) {
    assert.ok(brief.includes(needle), `missing: ${needle}`);
  }
  for (const line of [...STANDING_ORDERS, ...RIO_CHECKLIST]) assert.ok(brief.includes(`- ${line}`), `missing order: ${line.slice(0, 40)}`);
  assert.ok(!brief.includes("rejected your predecessor"), "a first attempt carries no findings");
});

test("both briefs carry what the task owns, what it builds on, and what strayed", () => {
  const owned = { ...task, touches: ["src/two.ts", "src/shared"], needs: ["m1-t1"], strayed: ["src/one.ts"] };
  const wingman = wingmanBrief({ ...ctx, task: owned });
  assert.match(wingman, /owns these paths and no others: src\/two\.ts, src\/shared\./);
  assert.match(wingman, /builds on m1-t1 \(The first thing\), which has passed its review and sits on branch mission\/x-m1-t1 in \/p\/app, not yet merged/);
  assert.match(wingman, /Merge that branch into yours \(`git merge mission\/x-m1-t1`\)/);
  assert.match(rioBrief({ ...ctx, task: owned }, "/f.md"), /Files outside them: src\/one\.ts\. Each is a finding unless/);
  const across = { ...ctx.milestone, tasks: [{ ...sibling, repo: "contracts" }, owned] };
  const crossRepo = wingmanBrief({ ...ctx, mission: { ...ctx.mission, repos: [repo, other], milestones: [across] }, milestone: across, task: owned });
  assert.match(crossRepo, /on branch mission\/x-m1-t1 in \/p\/contracts/, "a need in another repo is found there");
  const landed = { n: 0, title: "c", done: "d", merged: "2026-10-09T00:00:00Z", tasks: [{ ...sibling, id: "m0-t1", title: "The contract", repo: "contracts", status: "passed" as const }] };
  const earlierElsewhere = wingmanBrief({ ...ctx, mission: { ...ctx.mission, repos: [repo, other], milestones: [landed, ctx.milestone] }, task: { ...owned, needs: ["m0-t1"] } });
  assert.match(earlierElsewhere, /builds on m0-t1 \(The contract\), already merged on mission\/x and checked out at \/p\/contracts\/\.claude/, "a need whose milestone landed is read on the mission branch");
});

test("a Wingman is told the contracts it owns and the ones it uses, and so is its RIO", () => {
  const contracts = [{ name: "claimsCodec", owner: "m1-t1", shape: "encode/decode" }, { name: "Session", owner: "m1-t2", shape: "the cookie shape" }, { name: "unrelated", owner: "m0-t9", shape: "x" }];
  const user = { ...task, needs: ["m1-t1"] };
  const brief = wingmanBrief({ ...ctx, mission: { ...ctx.mission, contracts }, task: user });
  assert.match(brief, /Contracts this task owns, which other tasks will read from your branch, so write them first and exactly as declared: Session \(the cookie shape\)\./);
  assert.match(brief, /Contracts owned by other tasks, which you use as declared and never redefine: claimsCodec \(encode\/decode, owned by m1-t1\); unrelated \(x, owned by m0-t9\)\. If the owner's branch already has one, read it there; if not yet, stub it in a file of your own/);
  const parallel = wingmanBrief({ ...ctx, mission: { ...ctx.mission, contracts }, task: { ...task, needs: undefined } });
  assert.match(parallel, /claimsCodec \(encode\/decode, owned by m1-t1\)/, "a task flying beside the owner is told too; that is the case the step exists for");
  assert.match(rioBrief({ ...ctx, mission: { ...ctx.mission, contracts }, task: user }, "/f.md"), /Contracts this task owns.*Session/);
});

test("a retry brief carries the findings verbatim and says what must still pass", () => {
  const brief = wingmanBrief(ctx, "verdict: mixed\n- BLOCKER: the test is vacuous\n- NOTE: a stray log line");
  assert.ok(brief.includes("- BLOCKER: the test is vacuous"));
  assert.match(brief, /Fix every finding marked BLOCKER\. Fix a NOTE when it is cheap/);
  assert.match(brief, /must still pass/);
});

test("a RIO's brief names the branch to read, its own scratch path, its siblings and the findings file", () => {
  const brief = rioBrief(ctx, "/home/findings-2.md");
  for (const needle of [`git -C ${task.worktree} log mission/x..HEAD -p`, `${task.worktree}/.scratch/rio2`, "Write your findings to /home/findings-2.md", "Its siblings in this milestone", "The first thing", '"verdict: pass", "verdict: pass with notes", "verdict: fail", "verdict: mixed"', 'each starting "BLOCKER:"']) {
    assert.ok(brief.includes(needle), `missing: ${needle}`);
  }
  for (const line of RIO_CHECKLIST) assert.ok(brief.includes(`- ${line}`), `missing check: ${line.slice(0, 40)}`);
  assert.match(brief, /Do not fix anything\. Do not commit\./);
  assert.ok(!brief.includes("Commit as you go"), "a RIO is not told to commit");
  assert.ok(wingmanBrief(ctx).includes("- Commit as you go"), "a Wingman is");
  assert.throws(() => rioBrief({ ...ctx, task: { ...task, worktree: undefined } }, "/f.md"), /has no worktree yet/);
  const second = rioBrief(ctx, "/f2.md", "verdict: mixed\n- BLOCKER: x\n- NOTE: y");
  assert.match(second, /This is a retry\. The previous RIO's findings, verbatim/);
  assert.ok(second.includes("- BLOCKER: x\n- NOTE: y"));
  assert.match(second, /A note the Wingman deliberately left stays a note unless it got worse/);
  assert.ok(!rioBrief(ctx, "/f.md").includes("This is a retry"));
});

test("on a multi-repo mission the Wingman is told where the other repos' work is, and that none of it is on a base branch", () => {
  const brief = wingmanBrief({ ...ctx, mission: { ...ctx.mission, repos: [repo, other] } });
  assert.ok(brief.includes(`contracts: branch mission/x in /p/contracts, checked out at ${other.integration}`));
  assert.match(brief, /None of it has been merged to a base branch/);
});
