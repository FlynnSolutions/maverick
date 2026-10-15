/**
 * The mission's feed: the ledger (the plan's `## Log` on the mission branch) read back as typed
 * entries for the page. The ledger is append-only, so its order is already oldest first and is
 * kept as it is. Every line comes out as an entry: one this file cannot read is a `thought`
 * carrying the raw line, never dropped, so the page shows what the file says even when the
 * file says something new.
 */
import { parseFinding } from "./findings.ts";
import type { Mission } from "./missions.ts";

export interface FeedEntry {
  at: string;
  kind: "thought" | "action" | "question" | "response" | "error";
  who: "you" | "Maverick" | "Wingman" | "RIO" | "Strike Lead";
  text: string;
  milestone?: number;
  taskId?: string;
  /** What a pass carried or a hand-back left open, counted from the line; absent when it says neither. */
  counts?: { notes: number; unverified: number; blockers: number };
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
/** A pass with notes, as `transitions` writes it now: `(RIO: <verdict>) with N notes carried[, M unverified]`. */
const CARRIED = /\) with (\d+) notes carried(?:, (\d+) unverified)?/;
/** A pass with notes in an older ledger: the notes themselves, `; `-joined in a block at the end. */
const CARRIED_BLOCK = / \[carried: (.*)\]$/;
/** A hand-back by the review rule says how many blockers it left open. */
const BLOCKERS = /\b(\d+) blocker\(s\) open\b/;

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

/**
 * The counts a task's line carries, and its text with an older ledger's `[carried: ...]` block
 * taken off, so the page shows how many rather than the notes. A decision is a person's words
 * and is never read for counts or cut. An old block's notes are prose that holds `; ` itself, so
 * the block is counted from the record's `task.carried` (final once the task passed), and split
 * on `; ` only when the record has nothing for the task.
 */
const countsOf = (mark: string | undefined, text: string, mission: Mission): { text: string; counts?: FeedEntry["counts"] } => {
  if (mark === "decision") return { text };
  const counted = text.match(CARRIED);
  if (counted) return { text, counts: { notes: Number(counted[1]), unverified: Number(counted[2] ?? 0), blockers: 0 } };
  const block = text.match(CARRIED_BLOCK);
  if (block) {
    const taskId = text.match(TASK)?.[1];
    const recorded = mission.milestones.flatMap((m) => m.tasks).find((t) => t.id === taskId)?.carried;
    const lines = recorded?.length ? recorded : block[1].split("; ");
    const unverified = lines.filter((l) => parseFinding(l).kind === "UNVERIFIED").length;
    return { text: text.slice(0, block.index), counts: { notes: lines.length - unverified, unverified, blockers: 0 } };
  }
  const open = text.match(TRANSITION)?.[3] === "handed-back" ? text.match(BLOCKERS) : null;
  if (open) return { text, counts: { notes: 0, unverified: 0, blockers: Number(open[1]) } };
  return { text };
};

/** The ledger's lines as feed entries, in the ledger's order. Pure. */
export const feedOf = (log: string[], mission: Mission): FeedEntry[] => log.map((line) => {
  const stamped = line.match(STAMPED);
  if (!stamped) return { at: "", kind: "thought", who: "Maverick", text: line };
  const [, day, time, rest] = stamped;
  const marked = rest.match(MARKED);
  const mark = marked?.[1];
  const { text, counts } = countsOf(mark, marked ? marked[2] : rest, mission);
  const taskId = text.match(TASK)?.[1];
  const milestone = milestoneOf(text, taskId, mission);
  return { at: `${day}T${time}`, kind: kindOf(mark, text), who: whoOf(mark, text), text, ...(milestone !== undefined ? { milestone } : {}), ...(taskId ? { taskId } : {}), ...(counts ? { counts } : {}) };
});
