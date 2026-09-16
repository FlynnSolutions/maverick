// Drawn icons, one stroke weight, one 16x16 box. Not a glyph font and not emoji: an icon that
// has to sit next to the jet needs the same hand. Every caller supplies its own accessible name.

const NS = "http://www.w3.org/2000/svg";

const PATHS = {
  /** Dismiss: two strokes crossing. Never used for anything that ends a process. */
  close: ["M4.5 4.5 L11.5 11.5", "M11.5 4.5 L4.5 11.5"],
  /** Settings: a slider bank, three rails with a handle on each. */
  settings: ["M2.5 4.5h11", "M2.5 8h11", "M2.5 11.5h11", "M6 4.5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0", "M11 8m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0", "M5 11.5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0"],
  /** Theme: a disc split light and dark. */
  theme: ["M8 2.2a5.8 5.8 0 1 0 0 11.6a5.8 5.8 0 1 0 0-11.6", "M8 2.2 L8 13.8"],
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
