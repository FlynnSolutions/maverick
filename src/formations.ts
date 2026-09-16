/**
 * Formations: a named group of sessions flying one job together. One of them is the lead, the
 * session that orchestrates; the rest are its flight. Named phonetically, in order, because
 * "Alpha" and "Bravo" are easier to hold in your head than "group 1" and "group 2".
 *
 * A formation holds session ids, not sessions. Sessions come and go; the formation is Cory's
 * grouping of them and outlives any of them.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.ts";

const file = config.formationsFile;

export interface Formation {
  id: string;
  /** Alpha, Bravo, Charlie… assigned on creation, renameable. */
  name: string;
  project: string;
  /** The orchestrator. Everything else in the formation reports into it. */
  lead: string | null;
  /** Session ids of the flight, in the order Cory put them there. */
  members: string[];
  created: string;
}

const CALLSIGNS = [
  "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett",
  "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango",
  "Uniform", "Victor", "Whiskey", "X-ray", "Yankee", "Zulu",
];

let cache: Formation[] | null = null;

const load = async (): Promise<Formation[]> => {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(file, "utf8")) as Formation[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    cache = [];
  }
  return cache;
};

const save = async (all: Formation[]): Promise<void> => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  cache = all;
};

export const listFormations = async (project: string): Promise<Formation[]> =>
  (await load()).filter((f) => f.project === project);

/** The first callsign this project is not already using. */
const nextCallsign = (taken: Formation[]): string =>
  CALLSIGNS.find((c) => !taken.some((f) => f.name === c)) ?? `Flight ${taken.length + 1}`;

export const createFormation = async (project: string, name?: string): Promise<Formation> => {
  const all = await load();
  const mine = all.filter((f) => f.project === project);
  const formation: Formation = {
    id: `f-${Date.now().toString(36)}`,
    name: name?.trim() || nextCallsign(mine),
    project,
    lead: null,
    members: [],
    created: new Date().toISOString(),
  };
  await save([...all, formation]);
  return formation;
};

export const updateFormation = async (id: string, patch: Partial<Pick<Formation, "name" | "lead" | "members">>): Promise<Formation> => {
  const all = await load();
  const i = all.findIndex((f) => f.id === id);
  if (i < 0) throw new Error(`no formation "${id}"`);
  // A session belongs to a formation once; promoting it to lead takes it out of the flight.
  const next: Formation = { ...all[i], ...patch };
  if (patch.lead !== undefined) next.members = next.members.filter((m) => m !== patch.lead);
  next.members = [...new Set(next.members)].filter((m) => m !== next.lead);
  const out = [...all];
  out[i] = next;
  await save(out);
  return next;
};

export const deleteFormation = async (id: string): Promise<void> => {
  const all = await load();
  await save(all.filter((f) => f.id !== id));
};
