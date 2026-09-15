/**
 * Maverick wears the project it is flying. A project may carry `maverick.json` at its root:
 *   { "accent": "#1e88e5", "accentHot": "#7cc4ff", "font": "Outfit", "callsign": "Realtime" }
 * Anything missing falls back to Maverick's own jet palette. The client turns this into CSS
 * variables and a Google Fonts link at boot; nothing else in the UI knows which project it is.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Theme {
  /** Primary accent: buttons, live states, the runway numbers. */
  accent: string;
  /** A lighter tint of the accent for text and glows. */
  accentHot: string;
  /** Display font family name from Google Fonts; body text stays IBM Plex Sans. */
  font: string;
  /** Short name shown in the top bar next to MAVERICK. */
  callsign?: string;
}

/** Afterburner orange over carbon: Maverick's own colours when a project has none. */
export const DEFAULT_THEME: Theme = { accent: "#ff7a1a", accentHot: "#ffb36b", font: "Chakra Petch" };

const HEX = /^#[0-9a-f]{6}$/i;

export const themeFor = async (projectPath: string): Promise<Theme> => {
  try {
    const raw = JSON.parse(await readFile(join(projectPath, "maverick.json"), "utf8")) as Partial<Theme>;
    return {
      accent: HEX.test(raw.accent ?? "") ? (raw.accent as string) : DEFAULT_THEME.accent,
      accentHot: HEX.test(raw.accentHot ?? "") ? (raw.accentHot as string) : lighten(HEX.test(raw.accent ?? "") ? (raw.accent as string) : DEFAULT_THEME.accent),
      font: typeof raw.font === "string" && raw.font.trim() ? raw.font.trim() : DEFAULT_THEME.font,
      ...(typeof raw.callsign === "string" && raw.callsign.trim() ? { callsign: raw.callsign.trim() } : {}),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_THEME;
    throw err;
  }
};

/** Mix a hex colour 45% toward white, for the "hot" tint when a project only gives an accent. */
const lighten = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.45);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};
