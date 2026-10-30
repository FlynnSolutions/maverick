// The project's palette, shared by every page that wears it. A project picks the accent, so a
// fixed foreground on it cannot hold: white on a cyan accent is 3.2:1. Pages differ in what
// else they do with the theme (only the board can switch it live), so only the pure part is
// here; that is also the part that was already copied twice.

export const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Ink or paper, whichever stands out on this colour. */
export const readableOn = (hex) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) return "#ffffff";
  const l = luminance(hex);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? "#04101f" : "#ffffff";
};

/**
 * The colour, taken toward black a step at a time until it reads at `ratio` on `bg`: a project
 * accent picked against the dark deck still holds as text on the light one.
 */
export const holdsOn = (hex, bg, ratio = 4.5) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) return hex;
  const against = luminance(bg);
  const contrast = (h) => { const l = luminance(h); return (Math.max(l, against) + 0.05) / (Math.min(l, against) + 0.05); };
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = () => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  for (let step = 0; step < 40 && contrast(out()) < ratio; step += 1) [r, g, b] = [r, g, b].map((c) => c * 0.94);
  return out();
};

/** localStorage is unavailable in some contexts; a remembered preference is never load-bearing. */
export const recall = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
