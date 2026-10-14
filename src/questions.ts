/**
 * What a mission is asking its person, and the one word for where it stands. Pure: both read
 * the record (or the view, which is the record plus the RIOs' findings) and never touch disk,
 * so the mission page, the inbox and the workspace cannot disagree about either.
 */
import { findingsOf } from "./audits.ts";
import type { Mission, MissionTask } from "./missions.ts";

export interface Question {
  id: string;
  kind: "handed-back" | "collision" | "landing" | "proof" | "plan" | "paused" | "gate";
  title: string;
  body: string;
  at: string;
  taskId?: string;
  milestone?: number;
  /**
   * `path` is relative to `/api/missions/<id>/`; `body` names the keys the page must supply. Only
   * what the server takes in the mission's state is listed, primary first, so a page renders them
   * as given. Empty while the mission is paused and the only move is resume, which the paused
   * question offers once.
   */
  answers: Array<{ label: string; method: "POST"; path: string; body?: string[]; primary?: boolean }>;
}

export type StatusWord = "working" | "waiting for you" | "error" | "done";

/**
 * The failures in `trouble` a person cannot answer: a report or ledger the console could not
 * write, and a proof whose runner was killed rather than failing on its own. Everything else
 * in `trouble` is a question, or the reason for one.
 */
const BROKEN = [/the report could not be written/, /the ledger .*could not be written/, /\(killed by SIG\w+\)/];

/** Ended missions ask nothing: every action on one is refused. */
export const over = (mission: Pick<Mission, "status">): boolean => mission.status === "closed" || mission.status === "abandoned";

/**
 * The word follows the questions (Cory's call on m1-t1): a mission with nothing open is never
 * "waiting for you", whatever escalation or trouble it carries. A stale escalation on a review
 * mission is history, not a question.
 */
export const statusWord = (mission: Mission, questions: Question[] = questionsOf(mission)): StatusWord => {
  if (mission.trouble && BROKEN.some((re) => re.test(mission.trouble!))) return "error";
  if (over(mission)) return "done";
  if (questions.length) return "waiting for you";
  return mission.status === "review" ? "done" : "working";
};

const blockerOf = (findings: string | undefined): string | undefined => (findings ? findingsOf(findings).blockers[0] : undefined);

type Answer = Question["answers"][number];

const handedBack = (mission: Mission & { findings?: Record<string, string> }, task: MissionTask): Question => {
  const why = blockerOf(mission.findings?.[task.id]) ?? task.note ?? "no reason recorded";
  return {
    id: `task:${task.id}`,
    kind: "handed-back",
    title: `${task.title} came back`,
    body: `${task.title}, attempt ${task.attempts}, the RIO said ${task.verdict ?? "nothing"}: ${why}`,
    at: task.review?.started ?? task.ended ?? mission.created,
    taskId: task.id,
    // The server refuses `retry` while paused and says resume first; accept it takes in any state.
    answers: mission.status === "paused"
      ? [{ label: "accept it over the RIO", method: "POST", path: `tasks/${task.id}/accept`, body: ["note"], primary: true }]
      : [
          { label: "send it out again", method: "POST", path: `tasks/${task.id}/retry`, primary: true },
          { label: "accept it over the RIO", method: "POST", path: `tasks/${task.id}/accept`, body: ["note"] },
        ],
  };
};

/**
 * The one answer the server takes for an escalation, which depends on where the mission is: it
 * pauses only a flying or blocked mission, with a reason, and resumes only a paused one. In any
 * other state (an escalation is never cleared, so it rides into `review`) nothing it would take
 * is an answer, so there is no question to ask.
 */
const escalationAnswer = (mission: Mission): Answer | undefined => {
  if (mission.status === "flying" || mission.status === "blocked") return { label: "pause", method: "POST", path: "pause", body: ["note"], primary: true };
  if (mission.status === "paused") return { label: "resume", method: "POST", path: "resume", primary: true };
  return undefined;
};

/**
 * One question per thing waiting on a person, oldest first. `at` is the best timestamp the
 * record has: the hold's, the review's start, else when the mission opened. A landing hold has
 * one answer, landing again: the server refuses `release` for a landing, because landing pushes,
 * and refuses `land` while paused.
 */
export const questionsOf = (mission: Mission & { findings?: Record<string, string> }): Question[] => {
  if (over(mission)) return [];
  const out: Question[] = [];
  for (const m of mission.milestones) for (const t of m.tasks) if (t.status === "handed-back") out.push({ ...handedBack(mission, t), milestone: m.n });
  for (const m of mission.milestones) {
    if (!m.hold) continue;
    const landing = m.hold.kind === "landing";
    out.push({
      id: `hold:${m.n}`,
      kind: m.hold.kind,
      title: `milestone ${m.n} is held: ${m.hold.kind}`,
      body: m.hold.reason,
      at: m.hold.at,
      milestone: m.n,
      answers: landing
        ? (mission.status === "paused" ? [] : [{ label: "try landing again", method: "POST", path: "land", primary: true }])
        : [{ label: "release", method: "POST", path: `milestones/${m.n}/release`, body: ["note"], primary: true }],
    });
  }
  const escalated = mission.escalation ? escalationAnswer(mission) : undefined;
  if (escalated) out.push({
    id: "escalation",
    kind: "plan",
    title: "the plan needs a look",
    body: mission.escalation!,
    at: mission.created,
    answers: [escalated],
  });
  if (mission.status === "paused") out.push({
    id: "paused",
    kind: "paused",
    title: "the mission is paused",
    body: mission.pausedFor || "paused, no reason given",
    at: mission.created,
    answers: [{ label: "resume", method: "POST", path: "resume", primary: true }],
  });
  if (mission.status === "planned") out.push({
    id: "gate",
    kind: "gate",
    title: "the plan is waiting for approval",
    body: mission.brief,
    at: mission.created,
    answers: [{ label: "approve", method: "POST", path: "approve", primary: true }],
  });
  return out.sort((a, b) => a.at.localeCompare(b.at));
};
