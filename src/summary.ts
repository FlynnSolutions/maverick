/**
 * The summary a mission keeps is three bullets, whatever the session that wrote it sent back. The
 * brief asks for exactly three; this is the server holding it to that, so a session that adds a
 * heading, a fourth bullet or a paragraph under each still reads as three lines on the page.
 */

/** A top-level list item, bulleted or numbered, at the start of a line with no indent. */
const ITEM = /^(?:[-*+]|\d+[.)])[ \t]+(\S.*)$/;
/** The first sentence of the first paragraph of prose: up to the first full stop, question or exclamation mark. */
const SENTENCE = /^(.+?[.!?])(?=\s|$)/;

/**
 * The first three top-level list items of a markdown text, each cut at its first line, as `- `
 * lines. With fewer than three items, the first sentence of any prose (a line outside a list item,
 * not a heading) follows them as a bullet; never more than three lines, and an empty text is "".
 */
export const threeBullets = (text: string): string => {
  const items: string[] = [];
  const prose: string[] = [];
  let inItem = false;
  let proseEnded = false;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const item = line.match(ITEM);
    if (item) { items.push(item[1].trim()); inItem = true; continue; }
    if (!line.trim()) { inItem = false; proseEnded = prose.length > 0; continue; }
    // An indented line belongs to the item above it; an unindented one straight after an item is
    // its lazy continuation. Either way it is past the item's first line, so it is cut.
    if (/^\s/.test(line) || inItem || line.startsWith("#")) continue;
    if (!proseEnded) prose.push(line.trim());
  }
  const lead = prose.join(" ");
  const sentence = lead.match(SENTENCE)?.[1] ?? lead;
  return [...items, ...(sentence ? [sentence] : [])].slice(0, 3).map((b) => `- ${b}`).join("\n");
};
