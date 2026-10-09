/**
 * The mission's report: what a person reads in the morning, generated from the record and the
 * RIO findings rather than written by the agent that flew it. The sections are fixed so nothing
 * is quietly left out: on the first mission the interim report missed three incidents and one
 * line claimed an audit that had not run. What the record does not hold is said to be missing.
 */
import type { Mission, MissionTask } from "./missions.ts";

const tasksOf = (mission: Mission): Array<{ n: number; task: MissionTask }> => mission.milestones.flatMap((m) => m.tasks.map((task) => ({ n: m.n, task })));

const line = (n: number, t: MissionTask): string => `${t.id} ${t.title} (milestone ${n})`;

/** The report as markdown. `findings` is each task's RIO text by task id, verbatim. */
export const reportFor = (mission: Mission, findings: Record<string, string>, log: string[] = []): string => {
  const all = tasksOf(mission);
  const passed = all.filter(({ task }) => task.status === "passed");
  const open = all.filter(({ task }) => task.status === "handed-back");
  const unfinished = all.filter(({ task }) => !["passed", "handed-back"].includes(task.status));
  const auto = log.filter((l) => !/by Cory\b/.test(l) && /(merged with \d+ note|carried:|could not|held|collided)/.test(l));
  const byCory = log.filter((l) => /by Cory\b/.test(l));
  const unverified = all.flatMap(({ n, task }) => (task.carried ?? []).filter((c) => c.startsWith("unverified: ")).map((c) => `${line(n, task)}: ${c.slice("unverified: ".length)}`));
  const carried = all.flatMap(({ n, task }) => (task.carried ?? []).filter((c) => !c.startsWith("unverified: ")).map((c) => `${line(n, task)}: ${c}`));
  const strayed = all.filter(({ task }) => task.strayed?.length).map(({ n, task }) => `${line(n, task)}: ${task.strayed!.join(", ")}`);
  const section = (title: string, body: string[], none: string): string[] => [`## ${title}`, "", ...(body.length ? body.map((b) => `- ${b}`) : [`_${none}_`]), ""];
  return [
    `# Mission report: ${mission.name}`,
    "",
    `${mission.status}${mission.finished ? `, finished ${mission.finished}` : ""}. ${passed.length} of ${all.length} tasks passed, ${open.length} handed back, ${unfinished.length} unfinished. ${mission.milestones.filter((m) => m.merged).length} of ${mission.milestones.length} milestones merged.${mission.escalation ? ` ${mission.escalation}` : ""}`,
    "",
    ...section("Decisions made without you", auto, "none recorded: every transition in the ledger was a pass, a retry, or a decision of yours"),
    ...section("Your decisions", byCory, "none"),
    ...section("Passed, with what rode along", passed.map(({ n, task }) => `${line(n, task)}: RIO ${task.verdict ?? "unrecorded"}${task.note ? `; ${task.note}` : ""}${task.commits?.length ? `; ${task.commits.length} commit(s)` : "; no commits"}`), "nothing passed"),
    ...section("Handed back, open", open.map(({ n, task }) => `${line(n, task)}: ${task.note ?? `the RIO said ${task.verdict}`}`), "nothing is waiting on you"),
    ...section("Unfinished", unfinished.map(({ n, task }) => `${line(n, task)}: ${task.status}`), "nothing left in the air"),
    ...section("Unverified, by the RIOs' own account", unverified, "no RIO reported a step it could not check"),
    ...section("Notes carried", carried, "none"),
    ...section("Files changed outside what the task owned", strayed, "none measured"),
    ...section("Held milestones", mission.milestones.filter((m) => m.held).map((m) => `milestone ${m.n}: ${m.held}`), "none"),
    "## Not recorded by Maverick",
    "",
    "- Actions an agent was denied and why: not captured; a Wingman says so in its final message, which is in its transcript.",
    "- Spend by key, and resources created outside the project's stacks: not captured here; read the usage view and the stacks.",
    "- Amendments to fixed decisions: in the project's decision log, in the same commit as the code, if the Wingman followed its brief.",
    "",
    "## The RIOs' findings, unedited",
    "",
    ...all.flatMap(({ n, task }) => (findings[task.id] ? [`### ${line(n, task)}`, "", findings[task.id].trim(), ""] : [])),
    ...(all.some(({ task }) => findings[task.id]) ? [] : ["_no findings on file_", ""]),
  ].join("\n");
};
