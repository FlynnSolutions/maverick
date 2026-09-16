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

/**
 * A session started into a formation that Claude Code has not registered yet. It is named by
 * the pty it is starting in, because that is the only handle that exists before the session id
 * does; it takes its slot the moment a session appears in that terminal.
 */
export interface Pending {
  terminal: string;
  as: "lead" | "member";
  title: string;
}

export interface Formation {
  id: string;
  /** Alpha, Bravo, Charlie… assigned on creation, renameable. */
  name: string;
  project: string;
  /** The orchestrator. Everything else in the formation reports into it. */
  lead: string | null;
  /** Session ids of the flight, in the order Cory put them there. */
  members: string[];
  /** Slots held for sessions that are still starting. Absent on formations made before this. */
  pending?: Pending[];
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
    pending: [],
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

/** Hold a slot for a session that is starting in `entry.terminal`. */
export const addPending = async (id: string, entry: Pending): Promise<Formation> => {
  const all = await load();
  const i = all.findIndex((f) => f.id === id);
  if (i < 0) throw new Error(`no formation "${id}"`);
  const out = [...all];
  out[i] = { ...all[i], pending: [...(all[i].pending ?? []).filter((p) => p.terminal !== entry.terminal), entry] };
  await save(out);
  return out[i];
};

/**
 * Settle every held slot against what is actually running: a pty Claude Code has registered a
 * session in hands that session its slot, and a pty that is gone without ever registering drops
 * its claim, so a start that failed does not hold a slot forever. Writes only when something
 * moved, because this runs on every poll.
 */
export const resolvePending = async (
  formations: Formation[],
  sessionByTerminal: Map<string, string>,
  liveTerminals: Set<string>,
): Promise<Formation[]> => {
  if (!formations.some((f) => f.pending?.length)) return formations;
  const all = await load();
  let moved = false;
  const out = all.map((f) => {
    if (!f.pending?.length) return f;
    let { lead, members } = f;
    const held: Pending[] = [];
    for (const p of f.pending) {
      const sessionId = sessionByTerminal.get(p.terminal);
      if (sessionId) {
        if (p.as === "lead") lead = sessionId;
        else members = [...members, sessionId];
      } else if (liveTerminals.has(p.terminal)) {
        held.push(p);
      }
      // Anything not still held has either taken its slot or lost its pty: either way it goes.
    }
    if (held.length === f.pending.length) return f;
    moved = true;
    members = [...new Set(members)].filter((m) => m !== lead);
    return { ...f, lead, members, pending: held };
  });
  if (!moved) return formations;
  await save(out);
  const mine = new Set(formations.map((f) => f.id));
  return out.filter((f) => mine.has(f.id));
};

export const deleteFormation = async (id: string): Promise<void> => {
  const all = await load();
  await save(all.filter((f) => f.id !== id));
};
