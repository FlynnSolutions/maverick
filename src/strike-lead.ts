/**
 * The Strike Lead as a conversation. One headless Claude session per mission, resumed for every
 * turn (`claude -p --resume`), whose replies come back in a fixed shape: what it says, the
 * questions it is asking as options to click, and whether the plan is written. The page draws
 * that shape as a chat, so Cory writes and it writes back, before approval and after it.
 *
 * Pure: the shape, the words around it and the parsing. The turns themselves are run, and the
 * chat is kept on the mission record, by `src/missions.ts`.
 */
import type { Mission } from "./missions.ts";

export interface LeadQuestion {
  id: string;
  question: string;
  /** Two to four short answers, clickable as they are. */
  options: string[];
  /** The background a person may want before answering, kept out of the question itself. */
  context?: string;
  /** Whether more than one option may be picked. */
  multi?: boolean;
}

export interface ChatEntry {
  at: string;
  who: "you" | "Strike Lead" | "Maverick";
  text: string;
  questions?: LeadQuestion[];
  /** The Strike Lead says the plan document is written and ready to fly. */
  planReady?: boolean;
  /** A turn that failed: said by Maverick, so it is never mistaken for the Strike Lead's answer. */
  error?: boolean;
  /** Maverick sending a plan that cannot fly back to the Strike Lead; counted, so it is sent back a bounded number of times. */
  sentBack?: boolean;
}

/** What every turn must return; `claude --json-schema` holds the session to it. */
export const LEAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message", "questions", "planReady"],
  properties: {
    message: { type: "string", description: "What you say to Cory, as short markdown. Lead with the point; no preamble, no recap of what he said." },
    questions: {
      type: "array",
      description: "The questions you are asking this round, if any. Each one is a single clear question he can answer with a click.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "options"],
        properties: {
          id: { type: "string" },
          question: { type: "string", description: "One question, one sentence." },
          options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4, description: "Short answers, each a few words; put your recommendation first." },
          context: { type: "string", description: "Background he may want before answering: what you found, the tradeoff. Shown folded." },
          multi: { type: "boolean", description: "True when more than one option may apply." },
        },
      },
    },
    planReady: { type: "boolean", description: "True only once the plan document is written in full." },
  },
} as const;

/** How the chat changes the interview: rounds of clickable questions, and no instructions about where to approve. */
export const CHAT_RULES = [
  "You are talking to Cory in a chat inside Maverick, not a terminal. Every reply you give is returned in a fixed JSON shape: `message`, `questions` and `planReady`.",
  "Ask in rounds. Put each question in `questions`, never only in `message`: one clear sentence, two to four short options he can click (your recommendation first), and anything he may want to know before answering in `context`, which he sees folded. Ask what this round needs, five at most; he answers the round, and you ask the next from his answers. He can always answer in his own words instead.",
  "Keep `message` short: what you found, what you are asking and why. He skims; do not make him hunt for the question.",
  "When the plan document is written in full, set `planReady` to true and say so in one line. Maverick then shows him a Fire mission button under your message. You cannot start the mission yourself, and you do not need to tell him where to approve it.",
].join("\n");

/** Once the mission flies, the same session answers questions about it. */
export const flightRules = (planPath: string, ledgerPath: string | undefined): string => [
  "The mission is approved and Maverick is flying it. You are still Cory's Strike Lead, in the same chat: he asks, you answer.",
  `The plan is ${planPath}${ledgerPath ? `; the plan as it flies, with its ledger, is ${ledgerPath}` : ""}. Each of his messages arrives with a snapshot of the mission's state from Maverick.`,
  "How it flies: a milestone's tasks start when what they need has passed and nothing running owns the same paths; the next milestone starts only when the one before it has merged. A Wingman builds each task in its own worktree, a RIO reviews it, and a task that fails review is sent back once before it comes to Cory.",
  "You may read anything and run anything read-only, such as `git log` in a worktree or `claude logs <id>` for an agent's screen. You do not change the mission: you cannot launch, retry, pause, release or land anything. When he wants one of those, name the control on the mission page that does it.",
  "Lead with the answer. `questions` is for when you need him to choose; most replies need none. `planReady` stays false.",
].join("\n");

/**
 * One round of answers, as the message the Strike Lead reads. An unanswered question is said to
 * be unanswered rather than dropped, so the numbering it asked in still holds.
 */
export const answersText = (questions: LeadQuestion[], picked: Record<string, { options?: string[]; other?: string }>): string =>
  questions.map((q, i) => {
    const a = picked[q.id] ?? {};
    const said = [...(a.options ?? []), ...(a.other?.trim() ? [a.other.trim()] : [])];
    return `${i + 1}. ${q.question}\n   ${said.length ? said.join("; ") : "(no answer)"}`;
  }).join("\n");

/** The result of a `claude -p --output-format json` turn: the structured reply, or why there is none. */
export const parseTurn = (stdout: string): { ok: true; message: string; questions: LeadQuestion[]; planReady: boolean } | { ok: false; why: string } => {
  let out: { is_error?: boolean; result?: string; structured_output?: { message?: unknown; questions?: unknown; planReady?: unknown } };
  try {
    out = JSON.parse(stdout);
  } catch {
    return { ok: false, why: `the session printed something that is not its JSON: ${stdout.trim().slice(0, 200) || "nothing"}` };
  }
  const s = out.structured_output;
  if (out.is_error || !s || typeof s.message !== "string") return { ok: false, why: out.result?.trim().slice(0, 300) || "the session ended without a reply" };
  const questions = Array.isArray(s.questions)
    ? (s.questions as LeadQuestion[]).filter((q) => q && typeof q.question === "string" && Array.isArray(q.options))
      .map((q, i) => ({ ...q, id: String(q.id || `q${i + 1}`) }))
    : [];
  return { ok: true, message: s.message, questions, planReady: s.planReady === true };
};

/**
 * The mission's state as the Strike Lead reads it with each message in flight: every milestone
 * and task, what each is waiting on, the open questions, and the last of the ledger.
 */
export const snapshot = (mission: Mission, questions: Array<{ title: string }>, log: string[], waiting: { tasks: Record<string, string>; milestones: Record<number, string> }): string => {
  const lines = [`Mission status: ${mission.status}${mission.trouble ? ` (${mission.trouble})` : ""}.`];
  for (const m of mission.milestones) {
    const state = m.hold ? `held: ${m.hold.kind}, ${m.hold.reason}` : m.merged ? "merged" : m.dispatched ? "in the air" : `not sent yet, ${waiting.milestones[m.n] ?? "waiting"}`;
    lines.push(`Milestone ${m.n}, ${m.title}: ${state}.`);
    for (const t of m.tasks) {
      const agent = t.status === "reviewing" ? t.review?.claudeId : t.claudeId;
      lines.push(`  - ${t.id} ${t.title}: ${t.status}, attempt ${t.attempts}${agent ? `, agent ${agent}` : ""}${t.needs?.length ? `, needs ${t.needs.join(", ")}` : ""}${t.worktree ? `, worktree ${t.worktree}` : ""}${waiting.tasks[t.id] ? `, ${waiting.tasks[t.id]}` : ""}${t.note ? `. ${t.note}` : ""}`);
    }
  }
  lines.push(questions.length ? `Waiting on Cory: ${questions.map((q) => q.title).join("; ")}.` : "Nothing is waiting on Cory.");
  if (log.length) lines.push("Latest in the ledger:", ...log.slice(-12).map((l) => `  ${l}`));
  return lines.join("\n");
};

/** The chat entries the Strike Lead has not answered yet: everything after its last reply, Maverick's notes included. */
export const unheard = (chat: ChatEntry[]): ChatEntry[] => {
  // A failed turn closes what it carried, as a reply would: sending it again is the person's call, not a loop's.
  const last = chat.findLastIndex((e) => e.who === "Strike Lead" || e.error);
  return chat.slice(last + 1).filter((e) => !e.error);
};
