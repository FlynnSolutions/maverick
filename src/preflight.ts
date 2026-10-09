/**
 * Gate 1 preflight: what the mission needs, checked against the host before a person approves
 * and leaves. The Strike Lead declares it in the plan's `## Preflight` section; Maverick checks
 * what a machine can check (tools, runtimes, credentials and their lifetime, the agents it will
 * spawn, disk) and lists what only a person can (an inbox, a passkey, a real sign-in) as theirs
 * to confirm. On the first overnight mission every one of these was discovered at 2 a.m.
 */
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type RequirementKind = "tool" | "runtime" | "credential" | "secret" | "human" | "duration";
export interface Requirement { kind: RequirementKind; value: string; note: string }
export interface Check { name: string; status: "ok" | "warn" | "fail" | "human"; detail: string }

/** `- tool: docker`, `- credential: aws, 8h`, `- human: the sign-up email inbox`. Anything else is a problem. */
const REQUIREMENT_LINE = /^(tool|runtime|credential|secret|human|duration):\s*([^,]+?)\s*(?:,\s*(.*))?$/i;

export const parseRequirements = (bullets: string[]): { requirements: Requirement[]; problems: string[] } => {
  const requirements: Requirement[] = [];
  const problems: string[] = [];
  for (const line of bullets) {
    const m = line.match(REQUIREMENT_LINE);
    if (m) requirements.push({ kind: m[1].toLowerCase() as RequirementKind, value: m[2].trim(), note: (m[3] ?? "").trim() });
    else problems.push(`preflight line "${line.slice(0, 60)}" is not "<tool|runtime|credential|secret|human|duration>: <what>[, <note>]"`);
  }
  return { requirements, problems };
};

/** `8h`, `90m`, `2d` as hours. */
export const hoursOf = (text: string): number | undefined => {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*(h|m|d)$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2].toLowerCase() === "h" ? n : m[2].toLowerCase() === "m" ? n / 60 : n * 24;
};

/** Whether a host version meets a pin like `22`, `>=22.18`, `^20`, `22.x`. Major and minor only; a pin it cannot read is taken as met. */
export const versionMeets = (pin: string, host: string): boolean | undefined => {
  const want = pin.trim().match(/^[\^~>=\s]*v?(\d+)(?:\.(\d+))?/);
  const have = host.trim().match(/v?(\d+)(?:\.(\d+))?/);
  if (!want || !have) return undefined;
  const [wMaj, wMin] = [Number(want[1]), Number(want[2] ?? 0)];
  const [hMaj, hMin] = [Number(have[1]), Number(have[2] ?? 0)];
  if (/^\s*>=/.test(pin)) return hMaj > wMaj || (hMaj === wMaj && hMin >= wMin);
  return hMaj === wMaj && hMin >= wMin;
};

const has = async (tool: string): Promise<string | undefined> => {
  try {
    const { stdout } = await run("which", [tool]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
};

const agentResolves = async (name: string, projectPath: string): Promise<boolean> => {
  for (const file of [join(homedir(), ".claude", "agents", `${name}.md`), join(projectPath, ".claude", "agents", `${name}.md`)]) {
    try { await access(file); return true; } catch { /* next */ }
  }
  return false;
};

/** AWS credentials and when they end, from the CLI's own resolution; undefined when there are none. */
const awsCredential = async (): Promise<{ who: string; expires?: Date } | undefined> => {
  try {
    const { stdout: who } = await run("aws", ["sts", "get-caller-identity", "--query", "Arn", "--output", "text"]);
    const exp = await run("aws", ["configure", "export-credentials", "--format", "process"]).then(({ stdout }) => (JSON.parse(stdout) as { Expiration?: string }).Expiration).catch(() => undefined);
    return { who: who.trim(), ...(exp ? { expires: new Date(exp) } : {}) };
  } catch {
    return undefined;
  }
};

export interface PreflightInput {
  projectPath: string;
  repoPaths: string[];
  requirements: Requirement[];
  wingmanAgent?: string;
  rioAgent: string;
  /** Whether any repo lands by pushing or a pull request, which needs `gh` or a remote. */
  landsRemotely: boolean;
}

export const preflight = async (input: PreflightInput): Promise<Check[]> => {
  const checks: Check[] = [];
  const duration = input.requirements.find((r) => r.kind === "duration");
  const hours = duration ? hoursOf(duration.value) : undefined;
  checks.push({ name: "host", status: "ok", detail: `${platform()} ${arch()}${platform() === "darwin" ? ", BSD tools: no timeout, sed -i needs '', no date -d" : ""}; node ${process.version}` });
  for (const tool of ["claude", "git", "python3", ...(input.landsRemotely ? ["gh"] : [])]) {
    const path = await has(tool);
    checks.push({ name: tool, status: path ? "ok" : "fail", detail: path ?? `not on PATH; every ${tool === "python3" ? "embedded terminal" : "agent"} needs it` });
  }
  for (const agent of [input.rioAgent, ...(input.wingmanAgent ? [input.wingmanAgent] : [])]) {
    const ok = await agentResolves(agent, input.projectPath);
    checks.push({ name: `agent ${agent}`, status: ok ? "ok" : "fail", detail: ok ? "installed" : `no ~/.claude/agents/${agent}.md; Claude Code would fall back to its default template (the README says how to install it)` });
  }
  for (const repo of input.repoPaths) {
    // `.nvmrc` first, then `engines.node`; a repo that pins nothing says nothing.
    const pin = await readFile(join(repo, ".nvmrc"), "utf8").catch(() => undefined)
      ?? await readFile(join(repo, "package.json"), "utf8").then((text) => (JSON.parse(text) as { engines?: { node?: string } }).engines?.node).catch(() => undefined);
    if (!pin) continue;
    const met = versionMeets(pin, process.version);
    checks.push({ name: `node pin in ${repo.split("/").pop()}`, status: met === false ? "fail" : "ok", detail: met === false ? `wants ${pin.trim()}, host has ${process.version}; a Wingman will go hunting for another node` : `${pin.trim()} against ${process.version}` });
  }
  for (const r of input.requirements) {
    if (r.kind === "tool" || r.kind === "runtime") {
      const path = await has(r.value);
      checks.push({ name: r.value, status: path ? "ok" : "fail", detail: path ?? `not on PATH${r.note ? `; ${r.note}` : ""}` });
    } else if (r.kind === "credential" && /^aws\b/i.test(r.value)) {
      const cred = await awsCredential();
      if (!cred) checks.push({ name: r.value, status: "fail", detail: "no AWS credentials resolve; sign in before approving" });
      else {
        const left = cred.expires ? (cred.expires.getTime() - Date.now()) / 3_600_000 : undefined;
        const short = left !== undefined && hours !== undefined && left < hours;
        checks.push({ name: r.value, status: short ? "fail" : left === undefined ? "warn" : "ok", detail: `${cred.who}${left !== undefined ? `, ends in ${left.toFixed(1)}h` : ", no expiry reported"}${short ? ` but the mission expects ${duration!.value}` : left === undefined ? "; check its lifetime against the mission yourself" : ""}` });
      }
    } else if (r.kind === "credential") {
      checks.push({ name: r.value, status: "human", detail: `confirm it is signed in and outlives the mission${r.note ? `: ${r.note}` : ""}` });
    } else if (r.kind === "secret") {
      checks.push({ name: `secret ${r.value}`, status: "human", detail: `confirm it exists where the plan reads it${r.note ? `: ${r.note}` : ""}` });
    } else if (r.kind === "human") {
      checks.push({ name: r.value, status: "human", detail: r.note || "a person does this; the plan must not expect an agent to" });
    }
  }
  if (duration && hours === undefined) checks.push({ name: "duration", status: "warn", detail: `"${duration.value}" is not a duration like 8h` });
  try {
    const { stdout } = await run("df", ["-k", input.projectPath]);
    const free = Number(stdout.trim().split("\n").pop()?.split(/\s+/)[3]) / 1_048_576;
    if (Number.isFinite(free)) checks.push({ name: "disk", status: free < 5 ? "warn" : "ok", detail: `${free.toFixed(0)} GB free; worktrees and node_modules per task add up` });
  } catch { /* no df: nothing to say */ }
  return checks;
};
