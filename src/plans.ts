/**
 * The phases before an item reaches the board, and the rule that holds at the door.
 *
 * Three phases sit in front of the checklist: a brainstorm (one conversation, many ideas, one
 * dated document), a breakdown (that document proposed as items), and a plan (one document per
 * item that is about to be worked). Only the last was ever formal. The rule now is that an item
 * on the roadmap or in progress carries a `plan:` field that resolves to a real file, and a
 * session is not spawned on an item that has none. Backlog is free-form.
 *
 * The brainstorm and the plan are written by the CAG, the project level of the three
 * (decisions M5, M9): the agent that holds the whole landscape and never edits product code.
 * Its boundary is its tool list, not its prompt. No shell, no subagents.
 */
import { stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { Project } from "./projects.ts";
import { today, type Item } from "./trackers.ts";
import { slug } from "./audits.ts";
import { INTERVIEW_PROBES } from "./missions.ts";

/** What the CAG may do, enforced by the CLI (`claude --tools`). Reading, writing and searching; never running anything. */
export const CAG_TOOLS = "Read,Write,Edit,Grep,Glob";

/** The path in a `plan:` field: its first word, without a `#section` anchor. Realtime writes prose after the path. */
export const planPath = (value: string | undefined): string | null =>
  value?.match(/\S+/)?.[0].replace(/#.*$/, "").replace(/[.,;:)]+$/, "") || null;

/** The file a `plan:` field names, relative to the project, or null when no such file exists. Tried from the tracker's folder first, then the project root. */
export const resolvePlan = async (project: Project, trackerPath: string, value: string | undefined): Promise<string | null> => {
  const p = planPath(value);
  if (!p) return null;
  for (const base of [dirname(trackerPath), project.path]) {
    const full = join(base, p);
    if (!full.startsWith(`${project.path}/`)) continue;
    if (await stat(full).then((s) => s.isFile(), () => false)) return relative(project.path, full);
  }
  return null;
};

/**
 * The rule, written once: planned is the presence of a resolving `plan:` field, not a status
 * word, because a path can be checked and a word is a claim. A mission's tasks are planned by
 * the mission's plan, which Maverick itself wrote.
 */
export const planOf = async (project: Project, trackerPath: string, item: Item): Promise<{ file: string | null; planned: boolean }> => {
  const file = item.fields.mission ? null : await resolvePlan(project, trackerPath, item.fields.plan);
  return { file, planned: Boolean(item.fields.mission || file) };
};

/** Where a new plan goes: a `plans/` folder beside the tracker, named the way Realtime already names them. */
export const planFileFor = (trackerPath: string, item: Item): { field: string; full: string } => {
  const field = join("plans", `${slug(item.title)}-${today()}.md`);
  return { field, full: join(dirname(trackerPath), field) };
};

const cagOpening = (project: Project): string[] => [
  `You are the CAG for the project at ${project.path}: the one agent that holds the whole landscape, answers questions about it, and writes the documents work is planned from. You never edit product code. This session cannot: your tools are ${CAG_TOOLS.replaceAll(",", ", ")}, and you write only under deliverables/ and in the tracker.`,
  "",
  "Read the repo before you say anything: its rulebook, its decision log, its docs, and the code any idea would touch. Every question you ask should be informed by what is already there.",
];

/** One conversation, many ideas, one dated document. The tracker is not touched; that is the breakdown's job, later. */
export const brainstormPrompt = (project: Project, topic: string): string => [
  ...cagOpening(project),
  "",
  `Cory wants to brainstorm about: ${topic}`,
  "",
  "A brainstorm is many ideas with no structure. Draw him out, offer angles he has not named, say where an idea collides with what the repo already does, and do not converge early. Keep it a conversation in this terminal, one or two questions at a time.",
  "",
  `Write it down as you go, as one document for this conversation: ${join(project.path, "deliverables", "brainstorms", `${today()}-${slug(topic) || "untitled"}.md`)}. Ideas, the reasoning around them, what was rejected and why, open questions. Rewrite the document freely; it is this conversation's, not a running file.`,
  "",
  "Do not write to the tracker. Turning a brainstorm into items is a separate step that Cory approves in Maverick. When the conversation is done, say that the document is written and where, then stop.",
].join("\n");

/** One item, one plan document, and the field that points at it. A mission-sized item is named as one and left to the Strike Lead. */
export const planPrompt = (project: Project, trackerPath: string, item: Item, plan: { field: string; full: string }): string => [
  ...cagOpening(project),
  "",
  `Plan this item from ${trackerPath}:`,
  "",
  item.body,
  "",
  "Interview Cory in this terminal before you write, one or two questions at a time, until you can answer in his words:",
  ...INTERVIEW_PROBES,
  "Do not present a plan until he has answered.",
  "",
  `When you and he have agreed, write the plan to ${plan.full}. One document, in prose and lists, carrying everything a session with no other context needs: what it is, done when, the files it touches, the steps in order, what it must not touch, how it proves itself, and the walkthrough cards a person will check it by.`,
  "",
  `Then, in ${trackerPath}, add the line \`  - plan: ${plan.field}\` under that item's bullet, beside its other fields, and change nothing else in the file. That line is what makes the item planned: the field, and the file existing.`,
  "",
  "If the item is more than one session's work in a few milestones, say so and stop: that is a mission, the Strike Lead plans it, and it must not be planned twice.",
  "",
  "When the plan is written and the field is set, tell Cory, then stop.",
].join("\n");
