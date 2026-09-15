/**
 * Markdown tracker parsing and editing.
 *
 * A tracker (CHECKLIST.md, PUNCHLIST.md) is the source of truth. This module reads one
 * into columns of items, and turns a "move this item there" request into a new file body.
 * It never writes; the server does that and commits.
 */

export type ColumnId = "priority" | "in-progress" | "backlog" | "shipped";

/** Structured lines an item may carry, as `  - key: value` under its bullet. */
export const FIELD_KEYS = ["created", "source", "due", "release", "size", "kind", "status", "owner", "plan", "pr", "links", "blocked-by"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

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
  /** `key: value` lines under the bullet (see FIELD_KEYS). Empty for legacy prose items. */
  fields: Partial<Record<FieldKey, string>>;
  /** The italic `_source, date._` right after the title on legacy items, else the `source` field. */
  source?: string;
  /** The `created` field, else the first ISO date found in the source text. */
  created?: string;
  /** Everything that is not title, source, or a field line: the prose. */
  description: string;
}

export interface Group {
  /** `### ` heading inside the section, or "" for items directly under the section. */
  name: string;
  /** `deploy <ISO date>` in a release heading (`### v1.10 (deploy 2026-09-28)`) is its deploy date; a bare date in a heading is not. */
  due?: string;
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
/** Sections that exist but are never shown as a lane. */
const HIDDEN_SECTION = "🗑️ Removed";

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

const FIELD_LINE = /^\s{2,}- ([a-z][a-z-]*):\s*(.*)$/;

const parseItem = (lines: string[], start: number): Item => {
  const end = blockEnd(lines, start);
  const firstLine = lines[start];
  const fields: Partial<Record<FieldKey, string>> = {};
  const prose: string[] = [];
  for (const line of lines.slice(start + 1, end)) {
    const m = line.match(FIELD_LINE);
    if (m && (FIELD_KEYS as readonly string[]).includes(m[1])) fields[m[1] as FieldKey] = m[2].trim();
    else prose.push(line.replace(/^\s{2}/, ""));
  }
  // Legacy shape: `**Title** (em dash) _source, date._ prose...` all on the bullet line.
  const afterTitle = firstLine
    .replace(/^- \[[ x]\]\s*/i, "")
    .replace(/^.*?\*\*.+?\*\*\s*/, "") // drop everything through the bold title, emoji and tags included
    .replace(/`\[[A-Za-z]+\]`\s*/g, "")
    .replace(/^[\s\u2014:-]+/, ""); // legacy items join title and source with an em dash
  const italic = afterTitle.match(/^_(.+?)_\s*/);
  const source = fields.source ?? italic?.[1];
  const created = fields.created ?? source?.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  const lead = italic ? afterTitle.slice(italic[0].length) : afterTitle;
  return {
    start,
    end,
    checked: /^- \[x\]/i.test(firstLine),
    title: titleOf(firstLine),
    tags: tagsOf(firstLine),
    firstLine,
    body: lines.slice(start, end).join("\n"),
    fields,
    source,
    ...(created ? { created } : {}),
    description: [lead, ...prose].join("\n").trim(),
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
      const name = line.slice(4).trim();
      const due = name.match(/\b(?:deploy|ship)\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1];
      group = { name, ...(due ? { due } : {}), items: [] };
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
 * Replace an item's block (bullet plus continuation lines) with new text. The first line
 * must still be a bullet so the item stays an item; everything else is the author's.
 */
export const applyEdit = (text: string, itemStart: number, itemFirstLine: string, body: string): string => {
  const lines = text.split("\n");
  if (lines[itemStart] !== itemFirstLine) {
    throw new StaleMoveError(`line ${itemStart} is no longer "${itemFirstLine.slice(0, 60)}"; reload the board`);
  }
  const replacement = body.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  if (!isBullet(replacement[0])) throw new Error("the first line must stay a bullet (\"- [ ] ...\")");
  const end = blockEnd(lines, itemStart);
  return [...lines.slice(0, itemStart), ...replacement, ...lines.slice(end)].join("\n");
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

/**
 * Move an item to the tracker's `## 🗑️ Removed` section (created at the end when absent) with
 * a `removed:` field carrying the date and the reason. Nothing is deleted; the Removed
 * section is simply not a lane.
 */
export const removeItem = (text: string, itemStart: number, itemFirstLine: string, reason: string): string => {
  const lines = text.split("\n");
  if (lines[itemStart] !== itemFirstLine) {
    throw new StaleMoveError(`line ${itemStart} is no longer "${itemFirstLine.slice(0, 60)}"; reload`);
  }
  const end = blockEnd(lines, itemStart);
  const block = lines.slice(itemStart, end);
  const stamped = [block[0], `  - removed: ${new Date().toISOString().slice(0, 10)}, ${reason.replace(/\s+/g, " ").trim()}`, ...block.slice(1)];
  const remaining = [...lines.slice(0, itemStart), ...lines.slice(end)];
  const heading = `## ${HIDDEN_SECTION}`;
  let at = remaining.findIndex((l) => l === heading);
  if (at < 0) {
    while (remaining.length && isBlank(remaining[remaining.length - 1])) remaining.pop();
    remaining.push("", "---", "", heading, "", "_Swiped away in the phone review. Each carries the date and the reason. Move an item back up to restore it._", "");
    at = remaining.indexOf(heading);
  }
  let insertAt = at + 1;
  while (insertAt < remaining.length && !remaining[insertAt].startsWith("## ")) insertAt += 1;
  while (insertAt > at + 1 && isBlank(remaining[insertAt - 1])) insertAt -= 1;
  remaining.splice(insertAt, 0, "", ...stamped);
  return remaining.join("\n");
};

/** Remove an empty `### ` group heading (a group with items is never deleted from here). */
export const deleteGroup = (text: string, heading: string, name: string): string => {
  const lines = text.split("\n");
  const section = parseTracker(text).sections.find((s) => s.heading === heading);
  if (!section) throw new Error(`no section headed "${heading}"`);
  const group = section.groups.find((g) => g.name === name);
  if (!group) throw new Error(`no group "### ${name}" under "${heading}"`);
  if (group.items.length) throw new Error(`"${name}" still holds ${group.items.length} item(s); move them first`);
  const at = lines.findIndex((l, i) => i > section.start && i < section.end && l === `### ${name}`);
  let from = at;
  let to = at + 1;
  while (to < lines.length && isBlank(lines[to])) to += 1;
  while (from > 0 && isBlank(lines[from - 1]) && isBlank(lines[from - 2] ?? "x")) from -= 1;
  return [...lines.slice(0, from), ...lines.slice(to - 1)].join("\n");
};

/** Rename a `### ` group heading in place (used to stamp a deploy date on a release). */
export const renameGroup = (text: string, heading: string, oldName: string, newName: string): string => {
  const lines = text.split("\n");
  const section = parseTracker(text).sections.find((s) => s.heading === heading);
  if (!section) throw new Error(`no section headed "${heading}"`);
  const at = lines.findIndex((l, i) => i > section.start && i < section.end && l === `### ${oldName}`);
  if (at < 0) throw new Error(`no group "### ${oldName}" under "${heading}"`);
  if (newName !== oldName && section.groups.some((g) => g.name === newName)) throw new Error(`"${heading}" already has a group "${newName}"`);
  lines[at] = `### ${newName}`;
  return lines.join("\n");
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
