// Drawn icons, one stroke weight, one 16x16 box. Not a glyph font and not emoji: an icon that
// has to sit next to the jet needs the same hand. Every caller supplies its own accessible name.

const NS = "http://www.w3.org/2000/svg";

const PATHS = {
  /** Dismiss: two strokes crossing. Never used for anything that ends a process. */
  close: ["M4.5 4.5 L11.5 11.5", "M11.5 4.5 L4.5 11.5"],
  /** Settings: two rails with a handle on each. Three at 16px is mush. */
  settings: ["M2.4 5.6h3.1", "M9.1 5.6h4.5", "M2.4 10.4h5.5", "M11.5 10.4h2.1",
             "M7.3 5.6a1.8 1.8 0 1 1-3.6 0a1.8 1.8 0 1 1 3.6 0", "M11.3 10.4a1.8 1.8 0 1 1-3.6 0a1.8 1.8 0 1 1 3.6 0"],
  /** Theme: a disc split light and dark. */
  theme: ["M8 2.2a5.8 5.8 0 1 0 0 11.6a5.8 5.8 0 1 0 0-11.6", "M8 2.2 L8 13.8"],
  /** Board: kanban columns, unequal because a board never fills evenly. */
  board: ["M2.6 3.4h3.3v9.2h-3.3z", "M6.35 3.4h3.3v5.9h-3.3z", "M10.1 3.4h3.3v7.6h-3.3z"],
  /** Calendar: a month grid with its header rail and two hangers. */
  calendar: ["M2.4 4.3h11.2v9.3h-11.2z", "M2.4 7.1h11.2", "M5.4 2.5v2.6", "M10.6 2.5v2.6"],
  /** Workspace: the rack, strips with a lamp at the head of each. */
  workspace: ["M6 4.2h7.6", "M6 8h7.6", "M6 11.8h7.6",
              "M3.9 4.2a1 1 0 1 1-2 0a1 1 0 1 1 2 0", "M3.9 8a1 1 0 1 1-2 0a1 1 0 1 1 2 0", "M3.9 11.8a1 1 0 1 1-2 0a1 1 0 1 1 2 0"],
  /** Chevron: a small caret, for anything that opens. */
  chevron: ["M4.8 6.4 L8 9.6 L11.2 6.4"],
  /** Plus. */
  plus: ["M8 3.6v8.8", "M3.6 8h8.8"],
  /** Terminal: a screen, a prompt caret and the line you type on. */
  terminal: ["M2.3 3.3h11.4v9.4h-11.4z", "M4.9 6.5 L7 8.3 L4.9 10.1", "M8.4 10.3h3"],
  /** Refresh: an open circle with an arrowhead closing it. */
  refresh: ["M11.6 4.4 A5 5 0 1 0 13 8", "M8.6 4.1 L11.9 4.5 L11.5 1.2"],
};

/** An `svg` carrying one icon. `cls` lands on the element; the stroke is set in CSS. */
export const icon = (name, cls = "icon") => {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[name] ?? []) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};
