/**
 * What a mission is asking its person, and the one word for where it stands. Pure: both read
 * the record (or the view, which is the record plus the RIOs' findings) and never touch disk,
 * so the mission page, the inbox and the workspace cannot disagree about either.
 */
import { findingsOf } from "./audits.ts";
import { parseFinding } from "./findings.ts";
import type { Milestone, Mission, MissionTask, WalkthroughState } from "./missions.ts";

export interface Question {
  id: string;
  kind: "handed-back" | "collision" | "landing" | "proof" | "plan" | "paused" | "gate" | "walk" | "review";
  title: string;
  body: string;
  at: string;
  taskId?: string;
  milestone?: number;
  /**
   * `path` is relative to `/api/missions/<id>/`; `body` names the keys the page must supply. Only
   * what the server takes in the mission's state is listed, primary first, so a page renders them
   * as given. Empty while the mission is paused and the only move is resume, which the paused
   * question offers once. An answer with `go` posts nothing: it opens the place on the mission page
   * where the person acts (`milestone-<n>` for a milestone's walkthrough, `close` for the close),
   * because walking is done there and closing asks twice there.
   */
  answers: Array<{ label: string; primary?: boolean } & ({ method: "POST"; path: string; body?: string[] } | { go: string })>;
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
  return questions.length ? "waiting for you" : "working";
};

export const walkthroughState = (m: Milestone): WalkthroughState => {
  const w = m.walkthrough;
  if (!w) return "none";
  if (w.waived) return "waived";
  if (w.failed) return "failed";
  if (!w.doc) return "building";
  return w.progress && w.progress.total > 0 && w.progress.answered >= w.progress.total ? "walked" : "walking";
};

/** A milestone that changed nothing has nothing to walk; every other one is walked or waived before the mission lands. */
export const needsWalking = (m: Milestone): boolean =>
  m.tasks.some((t) => t.commits?.length) && !["walked", "waived"].includes(walkthroughState(m));

/** How far a walkthrough still to walk has got, in the question's words: answered of total, and what came back failed or blocked. */
const walkLeft = (m: Milestone): string => {
  const state = walkthroughState(m);
  if (state === "failed") return `no walkthrough to walk: ${m.walkthrough?.failed}`;
  if (state === "none") return "no walkthrough yet";
  if (state === "building") return "its walkthrough is still being written";
  const p = m.walkthrough?.progress;
  if (!p?.total) return "not opened yet";
  const said = Object.values(p.verdicts);
  const n = (v: string) => said.filter((x) => x === v).length;
  return [`${p.answered} of ${p.total} answered`, n("fail") && `${n("fail")} failed`, n("blocked") && `${n("blocked")} blocked`].filter(Boolean).join(", ");
};

/**
 * A change asked of the Strike Lead once the work was done has nowhere to go: a mission takes no
 * new work at review, and the Strike Lead's seat is read-only. Said in the review question so it
 * is not lost in the chat.
 */
const strandedNote = (mission: Mission): string => {
  const { finished } = mission;
  const stranded = finished === undefined ? [] : (mission.chat ?? []).filter((c) => c.who === "you" && c.at > finished);
  if (!stranded.length) return "";
  const last = stranded.at(-1)!.text.split("\n")[0];
  const quoted = last.length > 80 ? `${last.slice(0, 80)}…` : last;
  const times = stranded.length === 1 ? "for a change" : `${stranded.length} times`;
  return ` You asked the Strike Lead ${times} after the work was done (last: "${quoted}"). A mission at review takes no new work, so that is not in it: put it on the checklist or fly it as its own mission.`;
};

/**
 * The walk, asked as one question whenever a merged milestone waits on it, in flight as much as at
 * review: which milestones, how far through each is (answered of total, what failed or was
 * blocked), and an answer per milestone that opens its walkthrough. Read from whatever
 * walkthroughs the milestones carry, so it holds however many there are. Its id names the latest
 * milestone in it, so a newly merged one asks again and progress through one already asked does
 * not. At review it ends "then close"; with nothing left to walk, the review question asks the close.
 */
const walkQuestion = (mission: Mission, left: Milestone[]): Question => {
  const review = mission.status === "review";
  const which = left.length === 1 ? `milestone ${left[0].n}` : `${left.length} milestones`;
  return {
    id: `walk:${left.at(-1)!.n}`,
    kind: "walk",
    title: review ? `ready to review: walk ${which}, then close` : `walk ${which}`,
    body: `${left.map((m) => `milestone ${m.n}, ${m.title}: ${walkLeft(m)}`).join(". ")}.${review ? " Then close the mission." : ""}${review ? strandedNote(mission) : ""}`,
    at: left.map((m) => m.merged!).sort()[0] ?? mission.created,
    answers: left.map((m, i) => ({ label: `walk milestone ${m.n}`, go: `milestone-${m.n}`, ...(i === 0 && { primary: true }) })),
  };
};

const closeQuestion = (mission: Mission): Question => ({
  id: "review",
  kind: "review",
  title: "ready to close",
  body: `Every milestone is walked or waived. Closing ticks the tracker and lands the work.${strandedNote(mission)}`,
  at: mission.finished ?? mission.created,
  answers: [{ label: "close", go: "close", primary: true }],
});

/** The first blocker's headline: the one sentence, not the line with its kind and evidence. */
const blockerOf = (findings: string | undefined): string | undefined => {
  const line = findings ? findingsOf(findings).blockers[0] : undefined;
  return line === undefined ? undefined : parseFinding(line).headline;
};

type Answer = Question["answers"][number];

const handedBack = (mission: Mission & { findings?: Record<string, string> }, task: MissionTask): Question => {
  const why = blockerOf(mission.findings?.[task.id]) ?? task.note ?? "no reason recorded";
  const retry: Answer = { label: "send it out again", method: "POST", path: `tasks/${task.id}/retry`, primary: true };
  const accept: Answer = { label: "accept it over the RIO", method: "POST", path: `tasks/${task.id}/accept`, body: ["note"] };
  const base = { id: `task:${task.id}`, kind: "handed-back" as const, taskId: task.id };
  // No Wingman id: its agent never started, so there is no work to accept, only a launch to fix.
  if (!task.claudeId) return { ...base, title: `${task.title} never started`, body: why, at: task.started ?? mission.created, answers: mission.status === "paused" ? [] : [retry] };
  return {
    ...base,
    title: `${task.title} came back`,
    body: `${task.title}, attempt ${task.attempts}, the RIO said ${task.verdict ?? "nothing"}: ${why}`,
    at: task.review?.started ?? task.ended ?? mission.created,
    // The server refuses `retry` while paused and says resume first; accept it takes in any state.
    answers: mission.status === "paused" ? [{ ...accept, primary: true }] : [retry, accept],
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
  const left = mission.milestones.filter((m) => m.merged && needsWalking(m));
  if (left.length) out.push(walkQuestion(mission, left));
  else if (mission.status === "review") out.push(closeQuestion(mission));
  return out.sort((a, b) => a.at.localeCompare(b.at));
};
