/**
 * The mission's feed: the ledger (the plan's `## Log` on the mission branch) read back as typed
 * entries for the page. The ledger is append-only, so its order is already oldest first and is
 * kept as it is. Every line comes out as an entry: one this file cannot read is a `thought`
 * carrying the raw line, never dropped, so the page shows what the file says even when the
 * file says something new.
 */
import { countCarried } from "./findings.ts";
import type { Mission } from "./missions.ts";

export interface FeedEntry {
  at: string;
  kind: "thought" | "action" | "question" | "response" | "error";
  who: "you" | "Maverick" | "Wingman" | "RIO" | "Strike Lead";
  text: string;
  milestone?: number;
  taskId?: string;
  /** The task's transition the line records, when it is one (`movesOf` in `src/missions.ts` reads these). A person's words are never one. */
  move?: { taskId: string; was: string; now: string; verdict?: string };
  /**
   * What a pass carried or a hand-back left open, counted from the line; absent when it says
   * neither. Kept on the entry even though the findings carry the same lines, because the ledger
   * persists where a findings file may not.
   */
  counts?: { notes: number; unverified: number; blockers: number };
}

/** `2026-10-09 09:00` as `syncPlan` stamps it, or a full ISO time; either way `at` comes out as ISO, local when the stamp carries no zone. */
const STAMPED = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?) (.*)$/;
/** The word right after the stamp says what the line is (see `transitions` and `recorded` in `src/missions.ts`). */
const MARKED = /^(decision|auto|held|merged): (.*)$/;
/** A task's transition, as `transitions` writes it: `<id> <title>: <was> to <now>[ (RIO: <verdict>)][: <note>]`. */
const TRANSITION = /^(m\d+-t\d+) .+?: (new|pending|flying|built|reviewing|passed|handed-back) to (pending|flying|built|reviewing|passed|handed-back)(?: \(RIO: ([^)]+)\))?/;
const TASK = /\b(m(\d+)-t\d+)\b/;
const MILESTONE = /\bmilestone (\d+)\b/;
/** A pass with notes, as `transitions` writes it now: `(RIO: <verdict>) with N notes carried[, M unverified]`. */
const CARRIED = /\) with (\d+) notes carried(?:, (\d+) unverified)?/;
/** A pass with notes in an older ledger: the notes themselves, `; `-joined in a block at the end. */
const CARRIED_BLOCK = / \[carried: (.*)\]$/;
/** A hand-back by the review rule says how many blockers it left open. */
const BLOCKERS = /\b(\d+) blocker\(s\) open\b/;

const kindOf = (mark: string | undefined, move: FeedEntry["move"]): FeedEntry["kind"] => {
  if (mark === "decision") return "response";
  if (mark === "held") return "question";
  if (mark === "merged") return "response";
  if (move) {
    const { now, verdict } = move;
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

const whoOf = (mark: string | undefined, move: FeedEntry["move"]): FeedEntry["who"] => {
  if (mark === "decision") return "you";
  if (move?.verdict) return "RIO";
  // A Wingman hands its task off when it finishes: the task moves from flying to built.
  if (move && move.was === "flying" && move.now === "built") return "Wingman";
  return "Maverick";
};

/** The milestone a line is about: named outright, else the one holding the task it names, else the task id's own number. */
const milestoneOf = (text: string, task: RegExpMatchArray | null, mission: Mission): number | undefined => {
  const named = text.match(MILESTONE);
  if (named) return Number(named[1]);
  if (!task) return undefined;
  return mission.milestones.find((m) => m.tasks.some((t) => t.id === task[1]))?.n ?? Number(task[2]);
};

/**
 * The counts a transition's line carries, and its text with an older ledger's `[carried: ...]`
 * block taken off, so the page shows how many rather than the notes. Only a transition is read
 * for counts or cut. An old block's notes are prose that holds `; ` itself, so the block is
 * counted from the record's `task.carried` (final once the task passed), and split on `; `
 * only when the record has nothing for the task.
 */
const countsOf = (move: FeedEntry["move"], text: string, mission: Mission): { text: string; counts?: FeedEntry["counts"] } => {
  if (!move) return { text };
  const counted = text.match(CARRIED);
  if (counted) return { text, counts: { notes: Number(counted[1]), unverified: Number(counted[2] ?? 0), blockers: 0 } };
  const block = text.match(CARRIED_BLOCK);
  if (block) {
    const recorded = mission.milestones.flatMap((m) => m.tasks).find((t) => t.id === move.taskId)?.carried;
    const lines = recorded?.length ? recorded : block[1].split("; ");
    return { text: text.slice(0, block.index), counts: { ...countCarried(lines), blockers: 0 } };
  }
  const open = move.now === "handed-back" ? text.match(BLOCKERS) : null;
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
  const body = marked ? marked[2] : rest;
  // A person's words are never read as a move, however they are phrased.
  const moved = mark === "decision" ? null : body.match(TRANSITION);
  const move = moved ? { taskId: moved[1], was: moved[2], now: moved[3], ...(moved[4] ? { verdict: moved[4] } : {}) } : undefined;
  const { text, counts } = countsOf(move, body, mission);
  const task = body.match(TASK);
  const milestone = milestoneOf(text, task, mission);
  return {
    at: `${day}T${time}`, kind: kindOf(mark, move), who: whoOf(mark, move), text,
    ...(milestone !== undefined ? { milestone } : {}), ...(task ? { taskId: task[1] } : {}), ...(move ? { move } : {}), ...(counts ? { counts } : {}),
  };
});

/**
 * What Maverick says in the Strike Lead's chat while the mission flies: the moves a person would
 * want a text about, read off the ledger rather than stored twice. A task going out, sent back
 * out, passing or coming back; a milestone on the mission branch, a hold, a failure. A RIO being
 * sent in and every other step stay in Progress, and a person's own decisions are already their messages.
 */
const SAID: Record<string, (name: string, move: NonNullable<FeedEntry["move"]>) => string> = {
  flying: (name, move) => `${move.was === "pending" ? "out" : "sent back out"}: ${name}`,
  passed: (name, move) => `passed${move.verdict ? ` (${move.verdict})` : ""}: ${name}`,
  "handed-back": (name) => `came back and needs you: ${name}`,
};
export const updatesOf = (feed: FeedEntry[], mission: Pick<Mission, "milestones">): Array<{ at: string; text: string; kind: FeedEntry["kind"] }> => {
  const title = new Map(mission.milestones.flatMap((m) => m.tasks.map((t) => [t.id, t.title])));
  return feed.flatMap((e) => {
    if (!e.at || e.who === "you") return [];
    if (!e.move) return ["response", "question", "error"].includes(e.kind) ? [{ at: e.at, text: e.text, kind: e.kind }] : [];
    const say = SAID[e.move.now];
    return say ? [{ at: e.at, text: say(`${e.move.taskId} ${title.get(e.move.taskId) ?? ""}`.trim(), e.move), kind: e.kind }] : [];
  });
};
