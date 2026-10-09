/**
 * The mission's report: what a person reads in the morning, generated from the record and the
 * RIO findings rather than written by the agent that flew it. The sections are fixed so nothing
 * is quietly left out: on the first mission the interim report missed three incidents and one
 * line claimed an audit that had not run. What the record does not hold is said to be missing.
 */
import type { Mission, MissionTask } from "./missions.ts";

const tasksOf = (mission: Mission): Array<{ n: number; task: MissionTask }> => mission.milestones.flatMap((m) => m.tasks.map((task) => ({ n: m.n, task })));

const line = (n: number, t: MissionTask): string => `${t.id} ${t.title} (milestone ${n})`;

/** The ledger says what each line is right after its stamp (`decision:`, `auto:`, `held:`); nothing in the prose after that is read. */
const DECISION = /^\S+ \S+ decision: /;
const AUTOMATIC = /^\S+ \S+ auto: /;

/** The report as markdown. `findings` is each task's RIO text by task id, verbatim; `log` is the ledger's, or undefined when it could not be read. */
export const reportFor = (mission: Mission, findings: Record<string, string>, log?: string[]): string => {
  const all = tasksOf(mission);
  const passed = all.filter(({ task }) => task.status === "passed");
  const open = all.filter(({ task }) => task.status === "handed-back");
  const unfinished = all.filter(({ task }) => !["passed", "handed-back"].includes(task.status));
  const auto = (log ?? []).filter((l) => AUTOMATIC.test(l));
  const byCory = (log ?? []).filter((l) => DECISION.test(l));
  const unverified = all.flatMap(({ n, task }) => (task.carried ?? []).filter((c) => c.startsWith("unverified: ")).map((c) => `${line(n, task)}: ${c.slice("unverified: ".length)}`));
  const carried = all.flatMap(({ n, task }) => (task.carried ?? []).filter((c) => !c.startsWith("unverified: ")).map((c) => `${line(n, task)}: ${c}`));
  const strayed = all.filter(({ task }) => task.strayed?.length).map(({ n, task }) => `${line(n, task)}: ${task.strayed!.join(", ")}`);
  const section = (title: string, body: string[], none: string): string[] => [`## ${title}`, "", ...(body.length ? body.map((b) => `- ${b}`) : [`_${none}_`]), ""];
  return [
    `# Mission report: ${mission.name}`,
    "",
    `${mission.status}${mission.finished ? `, finished ${mission.finished}` : ""}. ${passed.length} of ${all.length} tasks passed, ${open.length} handed back, ${unfinished.length} unfinished. ${mission.milestones.filter((m) => m.merged).length} of ${mission.milestones.length} milestones merged.${mission.escalation ? ` ${mission.escalation}` : ""}`,
    "",
    ...section("Decisions made without you", auto, log ? "none: every transition in the ledger was a pass, a retry, or a decision of yours" : "the ledger could not be read, so this section is unknown, not empty"),
    ...section("Your decisions", byCory, log ? "none" : "the ledger could not be read"),
    ...section("Passed, with what rode along", passed.map(({ n, task }) => `${line(n, task)}: RIO ${task.verdict ?? "unrecorded"}${task.note ? `; ${task.note}` : ""}${task.commits?.length ? `; ${task.commits.length} commit(s)` : "; no commits"}`), "nothing passed"),
    ...section("Handed back, open", open.map(({ n, task }) => `${line(n, task)}: ${task.note ?? (task.verdict ? `the RIO said ${task.verdict}` : "no verdict recorded")}`), "nothing is waiting on you"),
    ...section("Unfinished", unfinished.map(({ n, task }) => `${line(n, task)}: ${task.status}`), "nothing left in the air"),
    ...section("Unverified, by the RIOs' own account", unverified, "no RIO reported a step it could not check"),
    ...section("Notes carried", carried, "none"),
    ...section("Files changed outside what the task owned", strayed, "none measured"),
    ...section("Held milestones", mission.milestones.filter((m) => m.hold).map((m) => `milestone ${m.n} (${m.hold!.kind}): ${m.hold!.reason}`), "none"),
    ...section("The proof on each merged tree", mission.milestones.filter((m) => m.proof).map((m) => `milestone ${m.n}: ${m.proof!.ok ? "passed" : "failed"} at ${m.proof!.at}`), "no proof result yet: either nothing has merged, or the project sets no proof command"),
    "## Not recorded by Maverick",
    "",
    "- Actions an agent was denied and why: not captured; a Wingman says so in its final message, which is in its transcript.",
    "- Spend by key, and resources created outside the project's stacks: not captured here; read the usage view and the stacks.",
    "- Amendments to fixed decisions: in the project's decision log, in the same commit as the code, if the Wingman followed its brief.",
    "",
    "## The RIOs' findings, unedited",
    "",
    // Fenced, so a finding cannot pose as a section of this report.
    ...all.flatMap(({ n, task }) => (findings[task.id] ? [`### ${line(n, task)}`, "", "~~~", findings[task.id].trim().replace(/~~~/g, "~ ~ ~"), "~~~", ""] : [])),
    ...(all.some(({ task }) => findings[task.id]) ? [] : ["_no findings on file_", ""]),
  ].join("\n");
};
