/**
 * a workflow template: the mission flow written down as ordered stages, so a mission can pin the
 * flow it started with. this module only answers questions about a template. it reads no mission
 * state, spawns nothing, and knows a mission only by the one field `workflowOf` asks for.
 */
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT } from "./project-config.ts";

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
  name?: string;
  description?: string;
  stages: Stage[];
}

/** one template a person may pick, or a project file that could not be one, with why in `error`. */
export interface TemplateChoice {
  id: string;
  name: string;
  description?: string;
  source: "built-in" | "project";
  unverified: boolean;
  template?: Workflow;
  error?: string;
}

/** where the built-in templates live. the packed app carries `src/**` as plain files. */
const MISSION_TEMPLATE = fileURLToPath(new URL("./workflows/mission.json", import.meta.url));
const LIGHT_TEMPLATE = fileURLToPath(new URL("./workflows/light.json", import.meta.url));

/** an id names a file and reaches a url, so it is lowercase letters, digits and dashes. */
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** the fields a workflow may carry at the top. */
const TOP = new Set(["id", "name", "description", "stages"]);

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
          { id: "review", kind: "agent", slot: "rioAgent", optional: true, named: true },
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
  if (!ID.test(raw.id)) throw new Error(`workflow ${JSON.stringify(raw.id)}: an id is lowercase letters, digits and dashes`);
  for (const key of Object.keys(raw)) {
    if (!TOP.has(key)) throw new Error(`workflow "${raw.id}": unknown field ${JSON.stringify(key)}`);
  }
  for (const key of ["name", "description"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") throw new Error(`workflow "${raw.id}": ${key} must be a string`);
  }
  checkStages(raw.stages, TODAY, `workflow "${raw.id}"`);
  const w = raw as unknown as Workflow;
  if (hasStage(w, "walkthrough") !== hasStage(w, "walk")) {
    const [present, absent] = hasStage(w, "walk") ? ["walk", "walkthrough"] : ["walkthrough", "walk"];
    throw new Error(`${named(present)}: needs "${absent}", the two are left out only together`);
  }
  return w;
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const load = (file: string): Workflow => deepFreeze(validateWorkflow(JSON.parse(readFileSync(file, "utf8"))));

let builtIn: Workflow | undefined;
let light: Workflow | undefined;

/**
 * the built-in template, synchronous so the pure gates can call it. every caller shares the one
 * cached copy, so it is frozen: a caller that changes it fails loud instead of changing the flow
 * for everyone else.
 */
export const defaultWorkflow = (): Workflow => (builtIn ??= load(MISSION_TEMPLATE));

/** the templates that ship with maverick, mission first. each is the one cached, frozen copy. */
export const builtInWorkflows = (): Workflow[] => [defaultWorkflow(), (light ??= load(LIGHT_TEMPLATE))];

/** a template that leaves out review, proof or walk is unverified. this is the only place that asks. */
export const unverified = (w: Workflow): boolean => !["review", "proof", "walk"].every((id) => hasStage(w, id));

const choiceOf = (w: Workflow, source: TemplateChoice["source"]): TemplateChoice => ({
  id: w.id,
  name: w.name ?? w.id,
  ...(w.description !== undefined && { description: w.description }),
  source,
  unverified: unverified(w),
  template: w,
});

/** one project file as a choice. a file that is not a template is still listed, with `error` saying why. */
const projectChoice = async (dir: string, file: string): Promise<TemplateChoice> => {
  const id = file.slice(0, -".json".length);
  const path = join(dir, file);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`);
  }
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`not JSON: ${(err as Error).message}`);
    }
    const w = validateWorkflow(raw);
    if (w.id !== id) throw new Error(`its id is "${w.id}", and it must be its file name, "${id}"`);
    return choiceOf(w, "project");
  } catch (err) {
    return { id, name: id, source: "project", unverified: false, error: `${file}: ${(err as Error).message}` };
  }
};

/**
 * the templates a project can start a mission from: the built-ins first, then the project's own
 * `.maverick/workflows/*.json` by id. a project file with a built-in's id takes its place in the
 * list. a missing folder is no project templates; any other failure to read it throws.
 */
export const templatesFor = async (projectPath: string): Promise<TemplateChoice[]> => {
  const dir = join(projectPath, ".maverick", "workflows");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") files = [];
    else throw new Error(`cannot read ${dir}: ${(err as Error).message}`);
  }
  const choices = builtInWorkflows().map((w) => choiceOf(w, "built-in"));
  const project = await Promise.all(files.map((f) => projectChoice(dir, f)));
  for (const choice of project.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const at = choices.findIndex((c) => c.id === choice.id);
    if (at >= 0) choices[at] = choice;
    else choices.push(choice);
  }
  return choices;
};

/** the template a mission starts from. a broken project file refuses the start, never falling back to the built-in. */
export const chooseTemplate = async (projectPath: string, id = "mission"): Promise<Workflow> => {
  const choice = (await templatesFor(projectPath)).find((c) => c.id === id);
  if (!choice) throw new Error(`no template ${id}`);
  if (!choice.template) throw new Error(choice.error ?? `no template ${id}`);
  return choice.template;
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

/** every agent the template launches, in stage order, each name once. */
export const agentsLaunched = (w: Workflow, slots: { wingmanAgent?: string; rioAgent?: string }): string[] => {
  const walk = (stages: Stage[]): string[] => stages.flatMap((s) => (s.kind === "agent" ? (agentFor(w, s.id, slots) ?? []) : walk(s.stages ?? [])));
  return [...new Set(walk(w.stages))];
};
