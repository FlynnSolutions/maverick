/**
 * One shape for every reply an agent writes back to the console. Maverick appends it to the
 * system prompt of every session it launches (`--append-system-prompt`), so a Wingman, a RIO,
 * a ship step, the Strike Lead and the CAG all answer in the same six sections, and the page
 * can show a reply as labelled blocks to scan rather than a wall of prose. A reply that does
 * not follow it is still shown; it is shown as prose.
 *
 * The sections, in order. The TL;DR goes last, where the eye lands after scrolling.
 */
export const REPLY_SECTIONS = ["Answer", "What changed", "Decisions", "Verified", "Open", "TL;DR"] as const;
export type ReplyLabel = (typeof REPLY_SECTIONS)[number];

export interface ReplySection {
  label: ReplyLabel;
  /** Markdown, as written, with the label stripped. */
  body: string;
}

export const REPLY_FORMAT = [
  "Every reply you write ends in six short sections, each opened by its label in bold at the start of a paragraph, in this order:",
  "",
  "**Answer.** The direct reply to what was asked, one to three lines.",
  "**What changed.** Files and behaviours, one line each. \"Nothing\" is a valid answer.",
  "**Decisions.** Each one: the call, what it was chosen over, and whether it is easy to reverse.",
  "**Verified.** What you actually ran and what the output said, and what you did not run. Never let \"should work\" stand for \"works\".",
  "**Open.** Questions for Cory, assumptions you took, blockers.",
  "**TL;DR.** Two lines, last.",
  "",
  "Keep each section to a few lines; a section with nothing in it says so in one word. Prose before the first label is fine. A reply that is only a question still ends in the six.",
].join("\n");

/** The arguments every launched session carries. Spread into the `claude` command line. */
export const REPLY_FORMAT_ARGS = ["--append-system-prompt", REPLY_FORMAT];

/* None of the labels carries a regex character, so they go in as written. A colon after the label reads the same as a full stop. */
const LABEL = new RegExp(`^\\*\\*(${REPLY_SECTIONS.join("|")})[.:]?\\*\\*[.:]?[ \\t]*`, "i");
const AT_LABEL = new RegExp(`^(?=\\*\\*(?:${REPLY_SECTIONS.join("|")})[.:]?\\*\\*)`, "im");

/**
 * The sections of a reply written in the format, in the order they appear, and whatever prose
 * came before the first one. Null when the reply is not in the format: fewer than two of the
 * labels, so a reply that happens to bold the word "Answer" is not mistaken for one.
 */
export const parseReply = (text: string): { lead: string; sections: ReplySection[] } | null => {
  const chunks = text.replace(/\r\n/g, "\n").split(AT_LABEL);
  const lead = LABEL.test(chunks[0]) ? "" : chunks.shift()!.trim();
  const sections = chunks.map((c) => {
    const m = c.match(LABEL)!;
    return { label: REPLY_SECTIONS.find((s) => s.toLowerCase() === m[1].toLowerCase())!, body: c.slice(m[0].length).trim() };
  });
  return sections.length < 2 ? null : { lead, sections };
};
