/**
 * Which of a project's questions are new since the last look, so the app can say each one once.
 * Pure: the caller polls the workspace and keeps the previous answer; this only compares two of
 * them. A question is the same question while its mission and its `id` are, whatever its title
 * or time says, so a question that is still open never fires twice.
 */
import type { Question } from "./questions.ts";

export interface MissionQuestions {
  missionId: string;
  missionName: string;
  questions: Question[];
}

export interface NewQuestion {
  missionId: string;
  missionName: string;
  question: Question;
}

/** The questions in `after` that `before` did not have, in `after`'s order. */
export const newQuestions = (before: MissionQuestions[], after: MissionQuestions[]): NewQuestion[] => {
  const seen = new Set(before.flatMap((m) => m.questions.map((q) => JSON.stringify([m.missionId, q.id]))));
  return after.flatMap((m) => m.questions
    .filter((q) => !seen.has(JSON.stringify([m.missionId, q.id])))
    .map((question) => ({ missionId: m.missionId, missionName: m.missionName, question })));
};
