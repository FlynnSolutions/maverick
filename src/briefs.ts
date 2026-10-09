/**
 * Every brief a mission sends is generated here, from one template. A lesson learned once (a
 * plan path an agent could not find, a foreground sleep that hung a session) is fixed here and
 * reaches every later Wingman and RIO. On the first overnight mission the briefs were written by
 * hand and the same miss happened six times in five hours; this file is the fix for that class.
 */
import { join, relative } from "node:path";
import type { Milestone, Mission, MissionRepo, MissionTask } from "./missions.ts";

/** The tools a RIO runs with: no Edit, no Write. Passed at spawn, so the fence holds whether or not `rio.md` is installed. */
export const RIO_TOOLS = "Bash,Read,Grep,Glob";

export interface BriefContext {
  projectPath: string;
  mission: Pick<Mission, "id" | "name" | "plan" | "repos" | "milestones" | "contracts">;
  milestone: Pick<Milestone, "n" | "title" | "done" | "tasks">;
  task: MissionTask;
  repo: MissionRepo;
}

/**
 * The plan as it lives on the mission branch: in the integration worktree of the repo that holds
 * it, at the same relative path. A plan no mission repo holds (a multi-repo project whose root is
 * not a repo, or is not named by the plan) goes on the first repo's mission branch, at its path
 * relative to the project. It never stays where the Lead wrote it: that is the main checkout, on
 * whatever branch it has out, and a ledger committed there is a commit on a base branch (M8).
 */
export const planOnBranch = (projectPath: string, plan: string, repos: MissionRepo[]): string => {
  const source = join(projectPath, plan);
  const holder = repos.filter((r) => source.startsWith(`${r.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  if (holder) return join(holder.integration, relative(holder.path, source));
  if (!repos.length) throw new Error(`the plan ${plan} has no mission branch to live on: the mission names no repos`);
  return join(repos[0].integration, relative(projectPath, source));
};

/** Where an agent may make a mess: inside the task's worktree, in a folder git ignores (see `excludeLocally`). */
export const scratchFor = (task: Pick<MissionTask, "id" | "worktree">, role: string): string => {
  if (!task.worktree) throw new Error(`task ${task.id} has no worktree yet, so it has nowhere to work; a brief is written after dispatch`);
  return join(task.worktree, ".scratch", role);
};

/** The RIO's role name for a task, numbered by review, so two reviews never share a scratch folder. */
export const rioRole = (task: Pick<MissionTask, "reviews">): string => `rio${task.reviews ?? 1}`;

const planLine = (ctx: BriefContext, who: string): string =>
  `The plan, with where every task stands, is on the mission branch at ${planOnBranch(ctx.projectPath, ctx.mission.plan, ctx.mission.repos)}. Read it; do not edit it${who}.`;

/** A fact about this host, read from the host, so the brief stays true on another one. */
const hostLine = (): string => process.platform === "darwin"
  ? "The host is macOS with BSD tools: there is no `timeout`, `sed -i` needs `''`, `date -d` does not exist. Do not go looking for GNU versions."
  : `The host is ${process.platform}; check which coreutils it has before assuming GNU or BSD flags.`;

/**
 * How to behave in the harness. Each line was a real stumble on the first overnight mission, and
 * the list only grows: a stumble seen twice is a template bug, not a one-off.
 */
export const STANDING_ORDERS: readonly string[] = [
  hostLine(),
  "Anything that takes more than a few seconds is started in the background (the Bash tool's background option, or `&` with its output to a file under your scratch path) and checked with short polls. A foreground `sleep`, a blocking server start, or a wait loop in the foreground hangs your session.",
  "Probes, copies, downloads and installs go under your scratch path and nowhere else. Delete only literal paths you created yourself, never a path read from a variable or a file, and never with `rm -rf` on anything you did not make.",
  "One check per command, so a failure names itself. Each command runs in a fresh shell: an environment variable is exported in the same command that needs it, never relied on from an earlier one.",
  "Never put a secret or an option into a shell variable that is then expanded into a command line, never print a secret, and never write one into a file you commit.",
  "Stop every process you started (servers, watchers, containers) before you stop, and name the ports you used in your final message.",
];

/** The builder's own orders; a RIO commits nothing, so it does not get these. */
const BUILDER_ORDERS: readonly string[] = [
  "Commit as you go, in small commits with plain lowercase subjects. Never amend a commit that has been reviewed; append a new one.",
];

/**
 * What a RIO checks. The Wingman gets the same list up front, so the first review confirms
 * rather than discovers: on the first mission none of the first eight tasks passed first time.
 */
export const RIO_CHECKLIST: readonly string[] = [
  "Vacuous proof: a test that cannot fail, asserts on what it set up, or also passes on the parent commit. Run the new tests against the parent to know.",
  "Secrets: nothing printed, logged or committed; environment read by export, never interpolated.",
  "Deployed state: where the task deploys or configures something live, the claim is verified against the live thing, not against the code.",
  "Accessibility, for anything a person looks at: keyboard focus, labels, contrast.",
  "Background processes: none left running, no port held.",
  "Scope: the diff stays within the files the task was given; a file outside them is justified in the message of the commit that changes it, or is a finding.",
  "Generated output is read against its input: schema-valid is not the same as correct.",
  "The repo's own rules: its rulebook, its decision log, its design contract, before the task's own words.",
];

const list = (lines: readonly string[]): string[] => lines.map((l) => `- ${l}`);

/** What the task owns and what it builds on, as the plan declared them. */
const ownership = (ctx: BriefContext): string[] => {
  const { task, milestone: m, repo } = ctx;
  const out: string[] = [];
  if (task.touches?.length) out.push(`This task owns these paths and no others: ${task.touches.join(", ")}. A file outside them is a finding unless the commit that changes it says why in its message; if it needs more, add a new file rather than editing a shared one.`);
  for (const need of task.needs ?? []) {
    const where = ctx.mission.milestones.find((x) => x.tasks.some((t) => t.id === need));
    const target = where?.tasks.find((t) => t.id === need);
    const home = ctx.mission.repos.find((r) => r.label === target?.repo) ?? repo;
    // A task starts when what it needs has passed, so the need is either merged on the mission
    // branch (its milestone landed) or still on its own branch, passed and no longer changing.
    out.push(where?.merged
      ? `It builds on ${need}${target ? ` (${target.title})` : ""}, already merged on ${home.branch} and checked out at ${home.integration}.`
      : `It builds on ${need}${target ? ` (${target.title})` : ""}, which has passed its review and sits on branch ${home.branch}-${need} in ${home.path}, not yet merged; read it there.`);
  }
  const owned = (ctx.mission.contracts ?? []).filter((c) => c.owner === task.id);
  const used = (ctx.mission.contracts ?? []).filter((c) => c.owner !== task.id && task.needs?.includes(c.owner));
  if (owned.length) out.push(`Contracts this task owns, which other tasks will read from your branch, so write them first and exactly as declared: ${owned.map((c) => `${c.name} (${c.shape})`).join("; ")}.`);
  if (used.length) out.push(`Contracts this task uses, owned elsewhere: ${used.map((c) => `${c.name} (${c.shape}, from ${c.owner})`).join("; ")}. Read them from the owner's branch; if one is not there yet, stub it in a file of your own, never at the owner's path.`);
  return out.length ? ["", ...out] : [];
};

const otherRepos = (ctx: BriefContext): string[] =>
  ctx.mission.repos.length > 1
    ? ["",
       "This mission spans more than one repo, and the milestones before yours have already landed their work on their own branches. **None of it has been merged to a base branch**, so do not expect to find it on main or develop. Where you need to read what an earlier milestone did, read it there:",
       ...ctx.mission.repos.filter((r) => r.label !== ctx.repo.label).map((r) => `  - ${r.label}: branch ${r.branch} in ${r.path}, checked out at ${r.integration}`),
       "If your task depends on something upstream that is not on that branch either, stop and say so rather than inventing it."]
    : [];

/** The Wingman's brief; with `retry`, the brief for the fresh Wingman that follows a RIO's rejection. */
export const wingmanBrief = (ctx: BriefContext, findings?: string): string => {
  const { mission, milestone: m, task, repo } = ctx;
  return [
    `You are a Wingman on the mission "${mission.name}" in the project at ${ctx.projectPath}. You own one task and nothing else.`,
    "",
    `Your repo is ${repo.label}, at ${repo.path}. Your worktree is ${task.worktree}, on branch ${task.branch}, branched from ${repo.branch}. Work there and only there: do not touch the project's other repos, do not touch their main worktrees, do not switch branches, and do not merge anything.`,
    planLine(ctx, ", Maverick writes it"),
    `Your scratch path is ${scratchFor(task, "wingman")}; git ignores it.`,
    ...otherRepos(ctx),
    "",
    `Milestone ${m.n} — ${m.title}. That milestone is done when: ${m.done}`,
    "",
    `Your task: ${task.title}`,
    "",
    task.intent,
    ...ownership(ctx),
    "",
    ...(findings ? [
      `A RIO who did not write this code rejected your predecessor's attempt. Its findings, verbatim:\n\n${findings}\n\nStart from the code that is already on your branch. Fix every finding marked BLOCKER. Fix a NOTE when it is cheap; otherwise leave it and say why in your final message. Everything the RIO did not flag passed, and must still pass: re-run the repo's tests and the checks the RIO ran before you stop, because a retry that fixes the list and breaks what the list did not mention costs another full round. Do not argue with the RIO in the code; where you believe a finding is wrong, say so in your commit message and leave the evidence.`,
      "",
    ] : []),
    "Read the repo's own rules before you write anything: its rulebook, its decision log and its design contract if it has them. Match the code around you.",
    "",
    "Standing orders:",
    ...list([...STANDING_ORDERS, ...BUILDER_ORDERS]),
    "",
    "A RIO that is not you will check the work against this list; check it yourself first, so its review confirms rather than discovers:",
    ...list(RIO_CHECKLIST),
    "",
    `Before you stop, run \`git -C ${task.worktree} diff --name-only ${repo.branch}...HEAD\` (three dots: your branch since it left the mission branch) and make sure every file in it belongs to this task${task.touches?.length ? ", which means inside: " + task.touches.join(", ") : ""}.`,
    "",
    "Do not write to the project's trackers; Maverick owns those for this mission. Do not open a pull request. Do not spawn other agents.",
    "",
    "When you are done, stop. Do not grade yourself in the commit messages: say what you did, what you could not verify, and that every process you started is stopped.",
  ].join("\n");
};

/** The RIO's brief. It reads, runs and judges; it never fixes, and its tool list says so. */
export const rioBrief = (ctx: BriefContext, file: string, previous?: string): string => {
  const { mission, milestone: m, task, repo } = ctx;
  return [
    `You are the RIO for one Wingman on the mission "${mission.name}" in the project at ${ctx.projectPath}. You fly in its back seat: you read what it did and you call it. You did not write this code and you will not fix it.`,
    "",
    `The work is in the ${repo.label} repo, on branch ${task.branch}, in the worktree at ${task.worktree}. Read every commit on it that ${repo.branch} does not have (\`git -C ${task.worktree} log ${repo.branch}..HEAD -p\`). Run things in that worktree; if you need a checkout of your own, make a detached one under ${scratchFor(task, rioRole(task))} and remove it when you are done.`,
    planLine(ctx, ""),
    `Your scratch path is ${scratchFor(task, rioRole(task))}; git ignores it.`,
    "",
    `The task it was given: ${task.title}`,
    "",
    task.intent,
    "",
    `The milestone it belongs to is done when: ${m.done}`,
    ...ownership(ctx),
    ...(task.strayed?.length ? ["", `Maverick diffed the branch against the paths the task owns. Files outside them: ${task.strayed.join(", ")}. Each is a finding unless the commit that changed it says why in its message.`] : []),
    ...(previous ? ["", `This is a retry. The previous RIO's findings, verbatim, and the Wingman was told to fix every BLOCKER and any NOTE that was cheap, and to say in its final message which notes it left and why:\n\n${previous}\n\nCheck that each blocker is fixed and that nothing which passed before broke. A note the Wingman deliberately left stays a note unless it got worse.`] : []),
    ...(m.tasks.length > 1 ? ["", `Its siblings in this milestone, which will merge with it: ${m.tasks.filter((t) => t.id !== task.id).map((t) => t.title).join("; ")}. Say what happens when they land together.`] : []),
    "",
    "Judge whether the work does what the task says, in the repo's own terms. Run the thing: its tests, its build, its checks, whatever the repo actually has. Where it has none, say so and verify by reading and by running the code by hand. Check it against the repo's binding rules, not only against the task. Then check every line of this list:",
    ...list(RIO_CHECKLIST),
    "",
    "Standing orders:",
    ...list(STANDING_ORDERS),
    "",
    `Write your findings to ${file}, with a shell redirect. The FIRST line must be exactly one of: "verdict: pass", "verdict: pass with notes", "verdict: fail", "verdict: mixed". Then a markdown list, one finding per line, each starting "BLOCKER:" (the task does not pass until it is fixed), "NOTE:" (fix if cheap, else carried into the report) or "UNVERIFIED:" (what you could not check; it is carried too), with the evidence (file, line, command output) and whether it contradicts what the Wingman claimed. In a fail or a mixed, a list line with none of those words is read as a blocker. A pass that disagreed with nothing is a pass that read the commit messages.`,
    "",
    "Do not fix anything. Do not commit. Do not touch the trackers. Do not spawn other agents.",
  ].join("\n");
};
