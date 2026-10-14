/**
 * The mission's feed: the ledger (the plan's `## Log` on the mission branch) read back as typed
 * entries for the page. The ledger is append-only, so its order is already oldest first and is
 * kept as it is. Every line comes out as an entry: one this file cannot read is a `thought`
 * carrying the raw line, never dropped, so the page shows what the file says even when the
 * file says something new.
 */
import type { Mission } from "./missions.ts";

export interface FeedEntry {
  at: string;
  kind: "thought" | "action" | "question" | "response" | "error";
  who: "you" | "Maverick" | "Wingman" | "RIO" | "Strike Lead";
  text: string;
  milestone?: number;
  taskId?: string;
}

/** `2026-10-09 09:00` as `syncPlan` stamps it, or a full ISO time; either way `at` comes out as ISO, local when the stamp carries no zone. */
const STAMPED = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?) (.*)$/;
/** The word right after the stamp says what the line is (see `transitions` and `recorded` in `src/missions.ts`). */
const MARKED = /^(decision|auto|held): (.*)$/;
/** A task's transition, as `transitions` writes it: `<id> <title>: <was> to <now>[ (RIO: <verdict>)][: <note>]`. */
const TRANSITION = /^(m\d+-t\d+) .+?: (new|pending|flying|built|reviewing|passed|handed-back) to (pending|flying|built|reviewing|passed|handed-back)(?: \(RIO: ([^)]+)\))?/;
const VERDICT = /\(RIO: (pass with notes|pass|fail|mixed)\)/;
const TASK = /\b(m(\d+)-t\d+)\b/;
const MILESTONE = /\bmilestone (\d+)\b/;

const kindOf = (mark: string | undefined, text: string): FeedEntry["kind"] => {
  if (mark === "decision") return "response";
  if (mark === "held") return "question";
  const move = text.match(TRANSITION);
  if (move) {
    const [, , , now, verdict] = move;
    if (now === "handed-back") return "question";
    if (now === "passed") return "response";
    if (verdict === "fail") return "error";
    if (now === "built" && verdict?.startsWith("pass")) return "response";
    // Out to a Wingman (a launch, or a retry's spawn), or a RIO sent in.
    if (now === "flying" || now === "reviewing") return "action";
    return "thought";
  }
  // Everything the ledger types is a mark or a transition; a line that is neither is kept as read.
  return "thought";
};

const whoOf = (mark: string | undefined, text: string): FeedEntry["who"] => {
  if (mark === "decision") return "you";
  if (VERDICT.test(text)) return "RIO";
  // A Wingman hands its task off when it finishes: the task moves from flying to built.
  const move = text.match(TRANSITION);
  if (move && move[2] === "flying" && move[3] === "built") return "Wingman";
  return "Maverick";
};

/** The milestone a line is about: named outright, else the one holding the task it names, else the task id's own number. */
const milestoneOf = (text: string, taskId: string | undefined, mission: Mission): number | undefined => {
  const named = text.match(MILESTONE);
  if (named) return Number(named[1]);
  if (!taskId) return undefined;
  return mission.milestones.find((m) => m.tasks.some((t) => t.id === taskId))?.n ?? Number(taskId.match(TASK)![2]);
};

/** The ledger's lines as feed entries, in the ledger's order. Pure. */
export const feedOf = (log: string[], mission: Mission): FeedEntry[] => log.map((line) => {
  const stamped = line.match(STAMPED);
  if (!stamped) return { at: "", kind: "thought", who: "Maverick", text: line };
  const [, day, time, rest] = stamped;
  const marked = rest.match(MARKED);
  const mark = marked?.[1];
  const text = marked ? marked[2] : rest;
  const taskId = text.match(TASK)?.[1];
  const milestone = milestoneOf(text, taskId, mission);
  return { at: `${day}T${time}`, kind: kindOf(mark, text), who: whoOf(mark, text), text, ...(milestone !== undefined ? { milestone } : {}), ...(taskId ? { taskId } : {}) };
});
