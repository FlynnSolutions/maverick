/**
 * Markdown tracker parsing and editing.
 *
 * A tracker (CHECKLIST.md, PUNCHLIST.md) is the source of truth. This module reads one
 * into columns of items, and turns a "move this item there" request into a new file body.
 * It never writes; the server does that and commits.
 */

export type ColumnId = "priority" | "in-progress" | "backlog" | "shipped";

export interface Item {
  /** Stable within one read of the file: `<startLine>` (0-based line of the bullet). */
  start: number;
  /** Exclusive end line of the item's block (bullet + continuation lines). */
  end: number;
  checked: boolean;
  title: string;
  tags: string[];
  /** The bullet line as written, used to detect a stale move. */
  firstLine: string;
  body: string;
}

export interface Group {
  /** `### ` heading inside the section, or "" for items directly under the section. */
  name: string;
  items: Item[];
}

export interface Section {
  column: ColumnId | null;
  heading: string;
  start: number;
  end: number;
  groups: Group[];
}

export interface Tracker {
  sections: Section[];
}

const COLUMN_BY_EMOJI: Array<[string, ColumnId]> = [
  ["🔥", "priority"],
  ["🚧", "in-progress"],
  ["📋", "backlog"],
  ["🧊", "backlog"],
  ["🧹", "backlog"],
  ["✅", "shipped"],
];

const isSectionHeading = (line: string): boolean => line.startsWith("## ");
const isGroupHeading = (line: string): boolean => line.startsWith("### ");
const isBullet = (line: string): boolean => /^- /.test(line);
const isBlank = (line: string): boolean => line.trim() === "";
const isContinuation = (line: string): boolean => /^\s/.test(line);

const columnFor = (heading: string): ColumnId | null => {
  const hit = COLUMN_BY_EMOJI.find(([emoji]) => heading.includes(emoji));
  return hit ? hit[1] : null;
};

/** Where an item's block ends: after the bullet and every indented or blank-then-indented line. */
const blockEnd = (lines: string[], start: number): number => {
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (isContinuation(line)) {
      i += 1;
      continue;
    }
    if (isBlank(line)) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      if (j < lines.length && isContinuation(lines[j])) {
        i = j;
        continue;
      }
    }
    break;
  }
  return i;
};

const titleOf = (firstLine: string): string => {
  const bold = firstLine.match(/\*\*(.+?)\*\*/);
  if (bold) return bold[1].replace(/~~/g, "");
  const stripped = firstLine.replace(/^- \[[ x]\]\s*/, "").replace(/`\[[A-Z]+\]`\s*/g, "");
  return stripped.length > 140 ? `${stripped.slice(0, 137)}...` : stripped;
};

const tagsOf = (firstLine: string): string[] =>
  [...firstLine.matchAll(/`\[([A-Za-z]+)\]`/g)].map((m) => m[1]);

const parseItem = (lines: string[], start: number): Item => {
  const end = blockEnd(lines, start);
  const firstLine = lines[start];
  return {
    start,
    end,
    checked: /^- \[x\]/i.test(firstLine),
    title: titleOf(firstLine),
    tags: tagsOf(firstLine),
    firstLine,
    body: lines.slice(start, end).join("\n"),
  };
};

export const parseTracker = (text: string): Tracker => {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let section: Section | null = null;
  let group: Group | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isSectionHeading(line)) {
      if (section) section.end = i;
      section = { column: columnFor(line), heading: line.slice(3).trim(), start: i, end: lines.length, groups: [] };
      group = { name: "", items: [] };
      section.groups.push(group);
      sections.push(section);
      i += 1;
      continue;
    }
    if (section && group && isGroupHeading(line)) {
      group = { name: line.slice(4).trim(), items: [] };
      section.groups.push(group);
      i += 1;
      continue;
    }
    if (section && group && isBullet(line)) {
      const item = parseItem(lines, i);
      group.items.push(item);
      i = item.end;
      continue;
    }
    i += 1;
  }
  return { sections: sections.map((s) => ({ ...s, groups: s.groups.filter((g) => g.name !== "" || g.items.length > 0) })) };
};

export interface MoveRequest {
  /** Bullet line of the item to move, and its text at the time the board was read. */
  itemStart: number;
  itemFirstLine: string;
  /** Section heading (as parsed) and group name to land in. */
  targetHeading: string;
  targetGroup: string;
  /** Position among that group's items after the move; >= length appends. */
  targetIndex: number;
}

export class StaleMoveError extends Error {}

/**
 * Returns the new file text with the item relocated. Throws StaleMoveError when the
 * file no longer has that bullet at that line, so the caller reloads instead of guessing.
 */
export const applyMove = (text: string, move: MoveRequest): string => {
  const lines = text.split("\n");
  if (lines[move.itemStart] !== move.itemFirstLine) {
    throw new StaleMoveError(
      `line ${move.itemStart} is no longer "${move.itemFirstLine.slice(0, 60)}"; reload the board`,
    );
  }
  const end = blockEnd(lines, move.itemStart);
  const block = lines.slice(move.itemStart, end);

  const remaining = [...lines.slice(0, move.itemStart), ...lines.slice(end)];
  // Removing a block can leave two blank lines touching; collapse to one.
  if (
    move.itemStart > 0 &&
    move.itemStart < remaining.length &&
    isBlank(remaining[move.itemStart - 1]) &&
    isBlank(remaining[move.itemStart])
  ) {
    remaining.splice(move.itemStart, 1);
  }

  const tracker = parseTracker(remaining.join("\n"));
  const section = tracker.sections.find((s) => s.heading === move.targetHeading);
  if (!section) throw new Error(`no section headed "${move.targetHeading}"`);
  const group = section.groups.find((g) => g.name === move.targetGroup);

  let insertAt: number;
  if (group && move.targetIndex < group.items.length) {
    insertAt = group.items[move.targetIndex].start;
  } else if (group && group.items.length > 0) {
    insertAt = group.items[group.items.length - 1].end;
  } else {
    insertAt = groupBodyStart(remaining, section, move.targetGroup);
  }

  const out = [...remaining];
  // Adjacent bullets are fine markdown; only a heading or note line directly above needs a
  // blank between it and the block, so a move never introduces spacing the file did not have.
  const above = insertAt > 0 ? out[insertAt - 1] : "";
  const below = insertAt < out.length ? out[insertAt] : "";
  const needsBlankBefore = insertAt > 0 && !isBlank(above) && !isBullet(above) && !isContinuation(above);
  const needsBlankAfter = below.startsWith("#") || below.trim() === "---";
  out.splice(insertAt, 0, ...(needsBlankBefore ? [""] : []), ...block, ...(needsBlankAfter ? [""] : []));
  return out.join("\n");
};

/**
 * Add a `### name` group at the end of a section (before its closing `---`, if any). A
 * release on the roadmap is exactly this: a group inside the Priority section, so the
 * markdown stays the source of truth and a drag between releases is a plain group move.
 */
export const addGroup = (text: string, heading: string, name: string): string => {
  const lines = text.split("\n");
  const section = parseTracker(text).sections.find((s) => s.heading === heading);
  if (!section) throw new Error(`no section headed "${heading}"`);
  if (section.groups.some((g) => g.name === name)) throw new Error(`"${heading}" already has a group "${name}"`);
  let at = section.end;
  while (at > section.start + 1 && (isBlank(lines[at - 1]) || lines[at - 1].trim() === "---")) at -= 1;
  const out = [...lines];
  out.splice(at, 0, "", `### ${name}`, "");
  return out.join("\n");
};

/** First line after the section/group heading and its italic note lines, where a first item goes. */
const groupBodyStart = (lines: string[], section: Section, groupName: string): number => {
  let i = section.start + 1;
  if (groupName !== "") {
    while (i < section.end && lines[i] !== `### ${groupName}`) i += 1;
    if (i >= section.end) throw new Error(`no group "### ${groupName}" under "${section.heading}"`);
    i += 1;
  }
  while (i < section.end && (isBlank(lines[i]) || lines[i].startsWith("_") || lines[i].startsWith(">"))) i += 1;
  return i;
};
