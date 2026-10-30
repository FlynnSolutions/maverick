// The project's palette, shared by every page that wears it. A project picks the accent, so a
// fixed foreground on it cannot hold: white on a cyan accent is 3.2:1. Pages differ in what
// else they do with the theme (only the board can switch it live), so only the pure part is
// here; that is also the part that was already copied twice.

export const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const isHex = (hex) => /^#[0-9a-f]{6}$/i.test(hex ?? "");

/** The WCAG contrast ratio between two hex colours. */
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Ink or paper, whichever stands out on this colour. */
export const readableOn = (hex) => {
  if (!isHex(hex)) return "#ffffff";
  return contrast(hex, "#000000") > contrast(hex, "#ffffff") ? "#04101f" : "#ffffff";
};

/**
 * The colour, taken toward black a step at a time until it reads at `ratio` on `bg`: a project
 * accent picked against the dark deck still holds as text on the light one.
 */
export const holdsOn = (hex, bg, ratio = 4.5) => {
  if (!isHex(hex)) return hex;
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = () => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  for (let step = 0; step < 40 && contrast(out(), bg) < ratio; step += 1) [r, g, b] = [r, g, b].map((c) => c * 0.94);
  return out();
};

/** The light theme's bar (style.css `--bar`, rgba(198, 205, 211, 0.92)): the darkest light surface text in the hot accent sits on. */
export const LIGHT_BAR = "#c6cdd3";

/** What a project's palette sets on the root, so a page that drops it can clear exactly these. */
export const PROJECT_PROPS = ["--accent", "--project-hot", "--project-hot-light", "--on-accent", "--display"];

/**
 * A project's palette on a root style. The hot accent goes in twice: as picked, for the dark deck,
 * and held to 4.5:1 on the light bar; the stylesheet picks one per theme, so a switch needs no script.
 */
export const applyProjectTheme = (root, theme) => {
  root.setProperty("--accent", theme.accent);
  root.setProperty("--project-hot", theme.accentHot);
  root.setProperty("--project-hot-light", holdsOn(theme.accentHot, LIGHT_BAR));
  // A project picks its own accent, so what reads on top of it cannot be a fixed colour:
  // white on a cyan accent is 3.2:1. Take whichever of ink or paper contrasts better.
  root.setProperty("--on-accent", readableOn(theme.accent));
  root.setProperty("--display", `"${theme.font}", "Chakra Petch", "IBM Plex Sans", sans-serif`);
};

/** localStorage is unavailable in some contexts; a remembered preference is never load-bearing. */
export const recall = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
