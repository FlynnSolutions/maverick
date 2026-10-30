// The project's palette, shared by every page that wears it. A project picks the accent, so a
// fixed foreground on it cannot hold: white on a cyan accent is 3.2:1. Pages differ in what
// else they do with the theme (only the board can switch it live), so only the pure part is
// here; that is also the part that was already copied twice.

export const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG ratio between two colours, 1 to 21. */
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Ink or paper, whichever stands out on this colour. */
export const readableOn = (hex) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) return "#ffffff";
  return contrast(hex, "#000000") > contrast(hex, "#ffffff") ? "#04101f" : "#ffffff";
};

const hex2 = (n) => Math.round(n).toString(16).padStart(2, "0");
/**
 * The accent as text: the same hue, taken toward black on a light ground or white on a dark one
 * until it reads at 4.5:1 on that ground. A project's accent is chosen to fill a button, and the
 * same value set as a link on the light deck can fall to 2.9:1.
 */
export const inkOn = (hex, ground) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) return hex;
  const toward = luminance(ground) > 0.4 ? 0 : 255;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let t = 0; t <= 1; t += 0.04) {
    const out = `#${rgb.map((c) => hex2(c + (toward - c) * t)).join("")}`;
    if (contrast(out, ground) >= 4.6) return out;
  }
  return toward ? "#ffffff" : "#000000";
};

/** localStorage is unavailable in some contexts; a remembered preference is never load-bearing. */
export const recall = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
