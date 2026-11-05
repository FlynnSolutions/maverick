/**
 * a workflow template: the mission flow written down as ordered stages, so a mission can pin the
 * flow it started with. this module only answers questions about a template. it reads no mission
 * state, spawns nothing, and knows a mission only by the one field `workflowOf` asks for.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface Stage {
  id: string;
  kind: "interview" | "gate" | "preflight" | "for-each" | "agent" | "merge" | "command" | "land" | "walk" | "close";
  over?: "milestones" | "tasks";
  stages?: Stage[];
  slot?: "wingmanAgent" | "rioAgent" | "proof";
  agent?: string;
}

export interface Workflow {
  id: string;
  stages: Stage[];
}

/** where the built-in template lives. the packed app carries `src/**` as plain files. */
const MISSION_TEMPLATE = fileURLToPath(new URL("./workflows/mission.json", import.meta.url));

/** the same pattern as `AGENT` in `src/project-config.ts`: an agent name reaches the CLI as argv. */
const AGENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const KINDS = new Set<string>(["interview", "gate", "preflight", "for-each", "agent", "merge", "command", "land", "walk", "close"]);

/** the fields a stage may carry, so a misspelt `agnet` is refused and not quietly ignored. */
const FIELDS = new Set(["id", "kind", "over", "stages", "slot", "agent"]);

/**
 * today's flow, which is the only flow the validator accepts. it is written here and not read
 * from `mission.json`, so that file cannot vouch for itself. `optional` may be left out, and
 * `named` may carry its own `agent`.
 */
interface Rule extends Pick<Stage, "id" | "kind" | "over" | "slot"> {
  stages?: Rule[];
  optional?: boolean;
  named?: boolean;
}

const TODAY: Rule[] = [
  { id: "interview", kind: "interview" },
  { id: "plan-gate", kind: "gate" },
  { id: "preflight", kind: "preflight" },
  {
    id: "milestones",
    kind: "for-each",
    over: "milestones",
    stages: [
      {
        id: "tasks",
        kind: "for-each",
        over: "tasks",
        stages: [
          { id: "build", kind: "agent", slot: "wingmanAgent", named: true },
          { id: "review", kind: "agent", slot: "rioAgent", named: true },
        ],
      },
      { id: "merge", kind: "merge" },
      { id: "proof", kind: "command", slot: "proof", optional: true },
      { id: "land", kind: "land" },
      { id: "walkthrough", kind: "agent", optional: true, named: true },
      { id: "walk", kind: "walk", optional: true },
    ],
  },
  { id: "close", kind: "close" },
  { id: "summary", kind: "agent", slot: "rioAgent", optional: true, named: true },
];

const idsOf = (rules: Rule[]): string[] => rules.flatMap((r) => [r.id, ...idsOf(r.stages ?? [])]);
const KNOWN = new Set(idsOf(TODAY));

const named = (id: unknown): string => `stage ${JSON.stringify(id)}`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const checkStage = (stage: Record<string, unknown>, rule: Rule): void => {
  const refuse = (why: string): never => {
    throw new Error(`${named(rule.id)}: ${why}`);
  };
  for (const key of Object.keys(stage)) if (!FIELDS.has(key)) refuse(`unknown field ${JSON.stringify(key)}`);
  if (stage.kind !== rule.kind) refuse(`must be kind "${rule.kind}", not ${JSON.stringify(stage.kind)}`);
  if (stage.over !== rule.over) refuse(rule.over ? `must run over "${rule.over}"` : "takes no over");
  if (stage.slot !== rule.slot) refuse(rule.slot ? `must take slot "${rule.slot}"` : "takes no slot");
  if (stage.agent !== undefined) {
    if (!rule.named) refuse("may not name an agent");
    if (typeof stage.agent !== "string" || !AGENT.test(stage.agent)) refuse(`agent ${JSON.stringify(stage.agent)} is not an agent name`);
  }
  if (rule.stages) checkStages(stage.stages, rule.stages, named(rule.id));
  else if (stage.stages !== undefined) refuse("holds no stages");
};

/** one level of the tree, in order: each stage known, in its place, once, and none missing. */
const checkStages = (raw: unknown, rules: Rule[], where: string): void => {
  if (!Array.isArray(raw)) throw new Error(`${where}: stages must be a list`);
  const seen = new Set<string>();
  let at = -1;
  for (const stage of raw) {
    if (!isObject(stage) || typeof stage.id !== "string") throw new Error(`${where}: every stage inside it needs an id`);
    const rule = rules.find((r) => r.id === stage.id);
    if (!rule) throw new Error(`${named(stage.id)}: ${KNOWN.has(stage.id) ? `does not belong in ${where}` : "unknown stage"}`);
    if (!KINDS.has(stage.kind as string)) throw new Error(`${named(stage.id)}: unknown kind ${JSON.stringify(stage.kind)}`);
    if (seen.has(rule.id)) throw new Error(`${named(rule.id)}: appears twice`);
    const place = rules.indexOf(rule);
    if (place < at) throw new Error(`${named(rule.id)}: out of order, it comes before "${rules[at].id}"`);
    at = place;
    seen.add(rule.id);
    checkStage(stage, rule);
  }
  for (const rule of rules) {
    if (!rule.optional && !seen.has(rule.id)) throw new Error(`${named(rule.id)}: may not be left out`);
  }
};

const findStage = (stages: Stage[], id: string): Stage | undefined => {
  for (const stage of stages) {
    const found = stage.id === id ? stage : findStage(stage.stages ?? [], id);
    if (found) return found;
  }
  return undefined;
};

export const hasStage = (w: Workflow, id: string): boolean => findStage(w.stages, id) !== undefined;

/** accepts only today's order, with only the permitted stages left out. throws, naming the stage. */
export const validateWorkflow = (raw: unknown): Workflow => {
  if (!isObject(raw)) throw new Error("a workflow must be an object");
  if (typeof raw.id !== "string" || !raw.id) throw new Error("a workflow needs an id");
  for (const key of Object.keys(raw)) {
    if (key !== "id" && key !== "stages") throw new Error(`workflow "${raw.id}": unknown field ${JSON.stringify(key)}`);
  }
  checkStages(raw.stages, TODAY, `workflow "${raw.id}"`);
  const w = raw as unknown as Workflow;
  if (hasStage(w, "walkthrough") !== hasStage(w, "walk")) {
    const [present, absent] = hasStage(w, "walk") ? ["walk", "walkthrough"] : ["walkthrough", "walk"];
    throw new Error(`${named(present)}: needs "${absent}", the two are left out only together`);
  }
  return w;
};

/** names the file on the way out, because neither a parse error nor a stage's message does. */
const parseWorkflow = (text: string, path: string): Workflow => {
  try {
    return validateWorkflow(JSON.parse(text));
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`, { cause: err });
  }
};

export const loadWorkflow = async (path: string): Promise<Workflow> => parseWorkflow(await readFile(path, "utf8"), path);

const deepFreeze = (stages: Stage[]): void => {
  for (const stage of stages) {
    deepFreeze(stage.stages ?? []);
    if (stage.stages) Object.freeze(stage.stages);
    Object.freeze(stage);
  }
};

let builtIn: Workflow | undefined;

/**
 * the built-in template, synchronous so the pure gates can call it. every caller shares the one
 * cached copy, so it is frozen: a caller that changes it fails loud instead of changing the flow
 * for everyone else.
 */
export const defaultWorkflow = (): Workflow => {
  if (!builtIn) {
    const w = parseWorkflow(readFileSync(MISSION_TEMPLATE, "utf8"), MISSION_TEMPLATE);
    deepFreeze(w.stages);
    Object.freeze(w.stages);
    builtIn = Object.freeze(w);
  }
  return builtIn;
};

/** the pinned copy, else the default. an older record has no copy, and reads as the default. */
export const workflowOf = (m: { template?: Workflow }): Workflow => m.template ?? defaultWorkflow();

/**
 * a stage's own agent, else its slot's value, else undefined. the `proof` slot holds a command,
 * not an agent, so it never answers here, even when the caller hands over a whole mission config.
 */
export const agentFor = (w: Workflow, id: string, slots: { wingmanAgent?: string; rioAgent?: string }): string | undefined => {
  const stage = findStage(w.stages, id);
  if (!stage) return undefined;
  if (stage.agent) return stage.agent;
  return stage.slot === "wingmanAgent" || stage.slot === "rioAgent" ? slots[stage.slot] : undefined;
};
