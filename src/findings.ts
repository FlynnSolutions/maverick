/**
 * A RIO's finding as a record: what kind it is, what it is about, what it asks of Cory, the
 * one sentence he reads, and the evidence under it. Pure; `findingsOf` sorts the lines, this
 * reads each one, and the Result section draws what this returns.
 */
import { createHash } from "node:crypto";

export type Severity = "fix" | "ship" | "check";

export interface Finding { kind: "BLOCKER" | "NOTE" | "UNVERIFIED"; area: string; severity: Severity; headline: string; detail: string; raw: string }

/** What a finding asks for when its line does not say: a blocker is fixed, a claim checked, a note shipped. */
const SEVERITY: Record<Finding["kind"], Severity> = { BLOCKER: "fix", UNVERIFIED: "check", NOTE: "ship" };

/** A headline with no sentence break is the whole line while it is shorter than this. */
const HEADLINE_MAX = 120;

/** `web/signin/` and `web/signin` are one area; a plain name is left as it was written. */
export const areaName = (area: string): string => area.trim().replace(/\/+$/, "");

/** A `. ` that ends a sentence: not the one inside `e.g. `, `i.e. `, `etc. ` or `vs. `. */
const STOP = /(?<!\b(?:e\.g|i\.e|etc|vs))\. /i;

/**
 * The first sentence and the rest. A first sentence (or, with no `. `, a whole line) shorter
 * than 120 characters is the headline; a longer one is cut at the last space before 120, and
 * what follows is the detail.
 */
const split = (text: string): { headline: string; detail: string } => {
  const stop = text.search(STOP);
  const end = stop >= 0 ? stop + 1 : text.length;
  if (end < HEADLINE_MAX) return { headline: text.slice(0, end), detail: text.slice(end).trim() };
  const space = text.lastIndexOf(" ", HEADLINE_MAX);
  const cut = space > 0 ? space : HEADLINE_MAX;
  return { headline: text.slice(0, cut), detail: text.slice(cut).trim() };
};

/**
 * One list item's text, as `findingsOf` hands it over or as `settleReview` carried it.
 * `KIND(area, severity): headline. detail` says everything; `KIND: prose`, a carried
 * `unverified: prose` and bare prose (a carried note) are read in area `general` with the
 * kind's severity. A severity the line names but this does not know falls back to the kind's,
 * and a parenthetical that is only a severity leaves the area `general`. A line that leads with
 * a kind keeps it whatever follows: a space before the colon or the parenthetical, parentheses
 * inside the area, or a parenthetical with no colon after it.
 * `taskId` is part of the signature callers share with `keyOf`; the record itself does not carry it.
 */
export const parseFinding = (line: string, taskId: string): Finding => {
  const raw = line.trim();
  const lead = raw.match(/^(BLOCKER|NOTE|UNVERIFIED)\s*[(:]/i);
  const kind = (lead?.[1].toUpperCase() ?? "NOTE") as Finding["kind"];
  const m = raw.match(/^(?:BLOCKER|NOTE|UNVERIFIED)\s*(?:\((.*?)\)\s*)?:\s*(.*)$/i) ?? raw.match(/^(?:BLOCKER|NOTE|UNVERIFIED)\s*\((.*)\)\s*(.*)$/i);
  let area = "general";
  let severity = SEVERITY[kind];
  if (m?.[1] !== undefined) {
    const comma = m[1].lastIndexOf(",");
    const named = m[1].slice(comma + 1).trim().toLowerCase();
    const known = named === "fix" || named === "ship" || named === "check";
    if (known) severity = named;
    area = areaName(known ? m[1].slice(0, Math.max(comma, 0)) : m[1]) || "general";
  }
  return { kind, area, severity, ...split(m ? m[2].trim() : raw), raw };
};

/** A finding's name across views: the task it came from and the first 8 hex of the sha1 of its line. */
export const keyOf = (finding: Finding, taskId: string): string => `${taskId}:${createHash("sha1").update(finding.raw).digest("hex").slice(0, 8)}`;

/** Findings by what they ask for, each bucket grouped by area in the order the areas first appear. */
export const triage = (findings: Finding[]): { fix: Finding[]; check: Finding[]; ship: Finding[] } => {
  const bucket = (severity: Severity): Finding[] => {
    const areas = new Map<string, Finding[]>();
    for (const f of findings.filter((f) => f.severity === severity)) {
      const area = areaName(f.area);
      areas.set(area, [...(areas.get(area) ?? []), f]);
    }
    return [...areas.values()].flat();
  };
  return { fix: bucket("fix"), check: bucket("check"), ship: bucket("ship") };
};
