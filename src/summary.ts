/**
 * The summary a mission keeps is three bullets, whatever the session that wrote it sent back. The
 * brief asks for exactly three; this is the server holding it to that, so a session that adds a
 * heading, a fourth bullet or a paragraph under each still reads as three lines on the page.
 */

/** A list item's marker, bulleted or numbered, and the first line of its text. */
const ITEM = /^((?:[-*+]|\d{1,9}[.)])[ \t]+)(\S.*)$/;
/** A thematic break: three or more of one of `-`, `*` or `_`, spaces allowed between them. */
const BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A setext underline, which turns the paragraph above it into a heading. */
const UNDERLINE = /^(?:=+|-+)[ \t]*$/;
/** The opening or closing line of a fenced code block. */
const FENCE = /^(?:`{3,}|~{3,})/;
/** The end of a sentence: a full stop, question or exclamation mark before a space or the end. */
const STOP = /[.!?](?=\s|$)/g;
/** Abbreviations whose full stop does not end the sentence. */
const ABBREVIATION = /(?:^|\s)(?:e\.g|i\.e|vs|cf)\.$/i;

/**
 * The first three top-level list items of a markdown text, each cut at its first line, as `- `
 * lines. With fewer than three items, the first sentence of any prose (a paragraph outside a list
 * item, not a heading, a break or a code block) follows them as a bullet, unless it ends in a
 * colon and so only leads into the list; never more than three lines, and an empty text is "".
 */
export const threeBullets = (text: string): string => {
  const items: string[] = [];
  const prose: string[] = [];
  let itemCol = -1;
  let blankBefore = false;
  let fence = "";
  let proseEnded = false;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const rest = line.trimStart();
    if (fence) { if (rest.startsWith(fence)) fence = ""; continue; }
    if (!rest) { blankBefore = true; proseEnded = prose.length > 0; continue; }
    const wasBlank = blankBefore;
    blankBefore = false;
    const indent = indentOf(line);
    // Anything indented to the open item's text belongs to it, and so is past its first line.
    if (itemCol >= 0 && indent >= itemCol) continue;
    const fenceOpen = rest.match(FENCE);
    if (fenceOpen) { fence = fenceOpen[0]; itemCol = -1; proseEnded = prose.length > 0; continue; }
    // A paragraph with an underline under it was a heading, not prose.
    if (itemCol < 0 && !wasBlank && !proseEnded && prose.length > 0 && UNDERLINE.test(rest)) { prose.length = 0; continue; }
    // A top-level line starts within three spaces of the margin, or a single tab in.
    const topLevel = indent <= 3 || /^\t\S/.test(line);
    if (topLevel && BREAK.test(rest)) { itemCol = -1; proseEnded = prose.length > 0; continue; }
    const item = topLevel ? rest.match(ITEM) : null;
    if (item) { items.push(item[2].trim()); itemCol = indent + item[1].length; proseEnded = prose.length > 0; continue; }
    // A line straight after an item, with no blank between, is its lazy continuation.
    if (itemCol >= 0 && !wasBlank) continue;
    itemCol = -1;
    if (!topLevel || rest.startsWith("#")) continue;
    if (!proseEnded) prose.push(rest.trim());
  }
  const sentence = firstSentence(prose.join(" "));
  const tail = sentence && !sentence.endsWith(":") ? [sentence] : [];
  return [...items, ...tail].slice(0, 3).map((b) => `- ${b}`).join("\n");
};

/** The column a line's text starts at, a tab moving to the next multiple of four. */
const indentOf = (line: string): number => {
  let col = 0;
  for (const ch of line) {
    if (ch === " ") col++;
    else if (ch === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
};

/** The first sentence of a paragraph, past any abbreviation's full stop; the whole of it if none ends. */
const firstSentence = (text: string): string => {
  for (const stop of text.matchAll(STOP)) {
    const upTo = text.slice(0, stop.index + 1);
    if (!ABBREVIATION.test(upTo)) return upTo;
  }
  return text;
};
