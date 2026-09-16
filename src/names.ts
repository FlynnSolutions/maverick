/**
 * The names Cory gives sessions in Maverick. Claude Code titles a session from its first
 * prompt, which ages badly ("Okay, you also need to build it so we can…"), and its registry
 * is the CLI's to own, so the rename lives here instead, keyed by session id so it survives
 * the process, a resume, and a reattach.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.ts";

const file = config.namesFile;
/** Maverick is the only writer, so the file is read once and the map kept. */
let cache: Record<string, string> | null = null;

export const readNames = async (): Promise<Record<string, string>> => {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    cache = {};
  }
  return cache;
};

/** An empty name clears the rename and hands the session back its own title. */
export const setName = async (sessionId: string, name: string): Promise<{ sessionId: string; name: string | null }> => {
  const names = { ...(await readNames()) };
  const trimmed = name.trim().slice(0, 120);
  if (trimmed) names[sessionId] = trimmed;
  else delete names[sessionId];
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(names, null, 2)}\n`, "utf8");
  cache = names;
  return { sessionId, name: trimmed || null };
};
