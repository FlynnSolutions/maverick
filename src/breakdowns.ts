/**
 * The breakdown: one brainstorm document proposed as items, approved once, written to the tracker.
 *
 * The middle phase of brainstorm, breakdown, plan (`src/plans.ts`). It has the mission's gate
 * shape exactly: a CAG writes a proposal document in a fixed format, the server parses it into
 * items plus problems, the page shows both, and one approve writes the tracker in one commit
 * through the insert-into-group path missions use. The approved document is stamped and kept
 * as the artifact of the gate, never read back as state (M1, M7).
 *
 * The CAG that proposes is a background read, not a conversation: the brainstorm was the
 * conversation. It carries the CAG's tool list, so it can read the brainstorm and the tracker
 * and write one file, and nothing else.
 *
 * Where items land is Cory's call of 2026-10-06: *now* goes to Priority, *backlog* goes to
 * Backlog, both under a group named after the brainstorm; *mission* is handed to a Strike Lead
 * interview instead of being written twice. A *now* item lands without a `plan:` field, because
 * no plan file exists yet and a path to nothing is the claim the rule at the door rejects; it
 * wears the unplanned badge, and *plan it* is its next verb.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FINISHED, commitFile, spawnBackgroundAgent } from "./git.ts";
import { agentsFor, startMission } from "./missions.ts";
import { CAG_TOOLS, cagOpening } from "./plans.ts";
import type { Project } from "./projects.ts";
import { BACKLOG, PRIORITY, allItems, documentHead, itemBlock, parseTracker, placeInGroup, today } from "./trackers.ts";

export type Call = "now" | "backlog" | "mission";
export const SIZES = ["S", "M", "L"] as const;

export interface ProposedItem {
  title: string;
  kind: string;
  size: string;
  call: Call;
  body: string;
}

export interface Breakdown {
  topic: string;
  intro: string;
  items: ProposedItem[];
  /** Ideas the CAG found already on the board, named rather than proposed again. */
  already: string[];
  problems: string[];
}

export const BREAKDOWN_FORMAT = `# Breakdown: <the brainstorm's topic>

<One paragraph: what the brainstorm was about and what this breakdown takes from it.>

## Items

- [ ] **<item title>**
  - kind: <feature | bug | chore | doc, or whatever this tracker already uses>
  - size: <S | M | L>
  - call: <now | backlog | mission>
  <What it is and why, enough for a plan session later to start from. Several lines for a
  "now" item; one line is not enough.>

- [ ] **<the next item>**
  - kind: <...>
  - size: <...>
  - call: <...>
  <...>

## Already on the board

- <the idea> — <the existing item's title>`;

const brainstormsDir = (project: Project): string => join(project.path, "deliverables", "brainstorms");
const breakdownsDir = (project: Project): string => join(project.path, "deliverables", "breakdowns");

/** The proposal for a brainstorm sits beside it under breakdowns/, with the same file name. */
export const proposalPathFor = (file: string): string => join("deliverables", "breakdowns", basename(file));

const CALLS: Call[] = ["now", "backlog", "mission"];

/**
 * Parse a proposal document. The items section is read in the tracker's own bullet shape, so an
 * item here is written exactly as it will be written into the tracker. `existingTitles` is what
 * the board already holds: proposing one of those again is a problem, not a new item.
 */
export const parseBreakdown = (text: string, existingTitles: string[] = []): Breakdown => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const { title: topic, intro } = documentHead(text, /^#\s*Breakdown:\s*(.+)$/m);
  const problems: string[] = [];
  if (!topic) problems.push('the document has no "# Breakdown: <topic>" heading');
  const sections = parseTracker(text).sections;
  const itemsSection = sections.find((s) => /^items$/i.test(s.heading));
  const alreadySection = sections.find((s) => /^already on the board$/i.test(s.heading));
  const items: ProposedItem[] = [];
  const seen = new Set<string>();
  const existing = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  for (const item of itemsSection?.groups.flatMap((g) => g.items) ?? []) {
    const body = item.description.trim();
    const call = (item.fields.call ?? "").trim().toLowerCase() as Call;
    const kind = (item.fields.kind ?? "").trim();
    const size = (item.fields.size ?? "").trim().toUpperCase();
    const key = item.title.trim().toLowerCase();
    if (!kind) problems.push(`"${item.title}" has no kind`);
    if (!SIZES.includes(size as (typeof SIZES)[number])) problems.push(`"${item.title}" has size "${item.fields.size ?? ""}"; it must be one of ${SIZES.join(", ")}`);
    if (!CALLS.includes(call)) problems.push(`"${item.title}" has call "${item.fields.call ?? ""}"; it must be one of ${CALLS.join(", ")}`);
    if (call === "now" && body.split("\n").filter(Boolean).length < 2) problems.push(`"${item.title}" is called now but says only one line; a plan session gets no context`);
    if (existing.has(key)) problems.push(`"${item.title}" is already on the board; list it under "Already on the board" instead`);
    if (seen.has(key)) problems.push(`"${item.title}" is proposed twice`);
    seen.add(key);
    items.push({ title: item.title.trim(), kind, size, call, body });
  }
  if (!itemsSection) problems.push('the document has no "## Items" section');
  else if (!items.length) problems.push("the document proposes no items");
  const already = (alreadySection ? lines.slice(alreadySection.start + 1, alreadySection.end) : []).map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  return { topic, intro, items, already, problems };
};

/* ---------- the brainstorms, and where each one stands ---------- */

export type BrainstormState = "not broken down" | "proposing" | "proposal waiting" | "broken down";

export interface BrainstormView {
  /** Relative to the project. */
  file: string;
  title: string;
  state: BrainstormState;
  proposal?: string;
  parsed?: Breakdown;
  /** From the stamp the approve wrote into the proposal document. */
  approved?: string;
  commit?: string;
}

const STAMP = /^<!-- approved: (\S+) · commit: (\S+) -->$/m;
/** The proposer's session name is also how it is found again: a brainstorm with no proposal and a live session of this name is "proposing". */
const proposerName = (file: string): string => `breakdown · ${basename(file, ".md")}`.slice(0, 60);

/** Every brainstorm document, newest first, with its proposal parsed when there is one. */
export const listBrainstorms = async (project: Project): Promise<BrainstormView[]> => {
  let names: string[];
  try {
    names = (await readdir(brainstormsDir(project))).filter((n) => n.endsWith(".md")).sort().reverse();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  if (!names.length) return [];
  // The agent listing is a subprocess and the board titles are a parse; each is fetched once, and only when a brainstorm needs it.
  let agents: Promise<Awaited<ReturnType<typeof agentsFor>>> | undefined;
  let existing: Promise<string[]> | undefined;
  return Promise.all(names.map(async (name) => {
    const file = join("deliverables", "brainstorms", name);
    const text = await readFile(join(project.path, file), "utf8");
    const title = text.match(/^#\s+(.+)$/m)?.[1].trim() ?? name;
    const proposal = proposalPathFor(file);
    const ptext = await readFile(join(project.path, proposal), "utf8").catch(() => null);
    if (ptext === null) {
      const busy = (await (agents ??= agentsFor(project.path).catch(() => []))).some((a) => a.name === proposerName(file) && !FINISHED.test(a.state ?? ""));
      return { file, title, state: busy ? "proposing" : "not broken down" } as BrainstormView;
    }
    const stamp = ptext.match(STAMP);
    return { file, title, proposal, parsed: parseBreakdown(ptext, await (existing ??= existingTitles(project))), ...(stamp ? { state: "broken down", approved: stamp[1], commit: stamp[2] } : { state: "proposal waiting" }) } as BrainstormView;
  }));
};

const existingTitles = async (project: Project): Promise<string[]> => {
  const titles: string[] = [];
  for (const tracker of project.trackers) titles.push(...allItems(parseTracker(await readFile(tracker.path, "utf8").catch(() => ""))).map((i) => i.title));
  return titles;
};

/* ---------- the proposer: a CAG, in the background, reading rather than talking ---------- */

const breakdownPrompt = (project: Project, file: string, proposal: string, trackerPath: string): string => [
  ...cagOpening(project, "exactly one file in this session"),
  "",
  `Break down the brainstorm at ${join(project.path, file)} into items for the tracker at ${trackerPath}.`,
  "",
  "Read the brainstorm whole. Then read the tracker: its lanes, the tags and kinds it already uses (use those words, not your own), and every title already on the board. An idea that is already an item is not proposed again; it is listed under \"Already on the board\" with the existing title.",
  "",
  `Write the proposal to ${join(project.path, proposal)} in exactly this shape, then stop:`,
  "",
  BREAKDOWN_FORMAT,
  "",
  "Rules. Fewer, sharper items beat a long list; a brainstorm of twenty ideas usually breaks into four to eight items. Each item's body says what it is and why, so a plan session can start from it. The call is yours: \"now\" for roadmap work worth planning next, \"backlog\" for the rest, \"mission\" for anything that is more than one session's work in a few milestones (that goes to a Strike Lead interview, so do not plan it here). Size S, M or L in the tracker's own sense.",
  "",
  "Do not write to the tracker, do not edit the brainstorm, do not write any other file. Cory approves the proposal in Maverick, and Maverick writes the tracker.",
].join("\n");

/** Send a CAG to read the brainstorm and write its proposal. Returns the background session id. */
export const proposeItems = async (project: Project, file: string, trackerIndex = 0): Promise<string> => {
  const tracker = project.trackers[trackerIndex];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${trackerIndex}`);
  await readFile(join(project.path, file), "utf8").catch(() => { throw new Error(`no brainstorm at ${file}`); });
  return spawnBackgroundAgent(project.path, proposerName(file), breakdownPrompt(project, file, proposalPathFor(file), tracker.path), undefined, CAG_TOOLS);
};

/* ---------- the approve: the tracker write, the missions, the stamp ---------- */

/**
 * The tracker text after a breakdown lands: "now" under a group named after the brainstorm in
 * Priority, "backlog" under the same name in Backlog, "mission" not written (the mission's own
 * approve writes it). Pure, so it is tested without a repo.
 */
export const writeBreakdown = (text: string, label: string, breakdown: Breakdown, sourceFile: string): string => {
  const group = `Brainstorm: ${breakdown.topic}`;
  const blocks = (call: Call) => breakdown.items.filter((i) => i.call === call).map((it) => itemBlock(it.title, { created: today(), source: `brainstorm ${sourceFile}, ${today()}`, kind: it.kind, size: it.size }, [it.body]));
  return placeInGroup(placeInGroup(text, PRIORITY, label, group, blocks("now")), BACKLOG, label, group, blocks("backlog"));
};

export interface ApproveResult {
  commit: string;
  missions: string[];
}

/** Cory's one approval of a breakdown. Writes the tracker in one commit, opens a mission per mission-sized item, stamps the proposal. */
export const approveBreakdown = async (project: Project, file: string, trackerIndex = 0): Promise<ApproveResult> => {
  const tracker = project.trackers[trackerIndex];
  if (!tracker) throw new Error(`project "${project.id}" has no tracker at index ${trackerIndex}`);
  const proposal = proposalPathFor(file);
  const ptext = await readFile(join(project.path, proposal), "utf8").catch(() => { throw new Error(`no proposal at ${proposal}; nothing has been proposed yet`); });
  if (STAMP.test(ptext)) throw new Error(`${proposal} was already approved`);
  const breakdown = parseBreakdown(ptext, await existingTitles(project));
  if (breakdown.problems.length) throw new Error(`the proposal cannot be written as it stands: ${breakdown.problems.join("; ")}`);
  await writeFile(tracker.path, writeBreakdown(await readFile(tracker.path, "utf8"), tracker.label, breakdown, file), "utf8");
  const count = (call: Call) => breakdown.items.filter((i) => i.call === call).length;
  const commit = await commitFile(tracker.path, `console: break down "${breakdown.topic}" (${count("now")} on the roadmap, ${count("backlog")} in backlog)`);
  // A mission-sized item is not written twice: the Strike Lead interviews from it, and the mission's approve writes it.
  const missions: string[] = [];
  for (const it of breakdown.items.filter((i) => i.call === "mission")) {
    const { mission } = await startMission(project, it.title, it.title, trackerIndex, proposal);
    missions.push(mission.id);
  }
  await writeFile(join(project.path, proposal), `${ptext.replace(/\n+$/, "")}\n\n<!-- approved: ${today()} · commit: ${commit} -->\n`, "utf8");
  await commitFile(join(project.path, proposal), `console: breakdown "${breakdown.topic}" approved`);
  return { commit, missions };
};
