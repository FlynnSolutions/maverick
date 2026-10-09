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
export type CheckKind = "host" | "tool" | "agent" | "runtime" | "credential" | "secret" | "human" | "disk";
export interface Check { kind: CheckKind; name: string; status: "ok" | "warn" | "fail" | "human"; detail: string; refuses?: boolean }

/** What a failing check means for approval is its kind, in one place: a tool, a runtime or an agent the mission cannot run without refuses; the rest is the person's to settle by approving. */
const REFUSING: ReadonlySet<CheckKind> = new Set(["tool", "runtime", "agent"]);
export const refuses = (c: Pick<Check, "kind" | "status">): boolean => c.status === "fail" && REFUSING.has(c.kind);

/** `- tool: docker`, `- credential: aws dev, the dev stack`, `- human: the sign-up email inbox`. Bold around the kind is tolerated; anything else is a problem. */
const REQUIREMENT_LINE = /^\**(tool|runtime|credential|secret|human|duration)\**:\**\s*(.+)$/i;

export const parseRequirements = (bullets: string[]): { requirements: Requirement[]; problems: string[] } => {
  const requirements: Requirement[] = [];
  const problems: string[] = [];
  for (const line of bullets) {
    const m = line.match(REQUIREMENT_LINE);
    if (!m) { problems.push(`preflight line "${line.slice(0, 60)}" is not "<tool|runtime|credential|secret|human|duration>: <what>[, <note>]"`); continue; }
    const kind = m[1].toLowerCase() as RequirementKind;
    const rest = m[2].replace(/`/g, "").trim();
    // A human step is prose and may hold commas; everything else is "<what>, <note>".
    const [value, note] = kind === "human" ? [rest, ""] : [rest.split(/,\s*/)[0], rest.split(/,\s*/).slice(1).join(", ")];
    requirements.push({ kind, value: value.trim(), note: note.trim() });
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

/**
 * Whether a host version meets a pin the way a repo writes one: `22`, `22.x`, `>=22.18`,
 * `^20`, `~22.21`, `>22`, `>=18 <23`, `20 || 22`. Major and minor only. A pin it cannot read
 * (`lts/iron`, `node`, `*`) is undefined, which the gate shows as a warning, not as met.
 */
export const versionMeets = (pin: string, host: string): boolean | undefined => {
  const have = host.trim().match(/v?(\d+)(?:\.(\d+))?/);
  if (!have) return undefined;
  const [hMaj, hMin] = [Number(have[1]), Number(have[2] ?? 0)];
  const one = (part: string): boolean | undefined => {
    const m = part.trim().match(/^(>=|<=|>|<|\^|~|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.[\dx*]+)?$/i);
    if (!m) return undefined;
    const [op, maj, min] = [m[1] ?? "", Number(m[2]), m[3] && /^\d+$/.test(m[3]) ? Number(m[3]) : 0];
    const cmp = hMaj !== maj ? hMaj - maj : hMin - min;
    // A pin with no minor means the whole major: `<=22` admits 22.21, `>22` wants 23 or more.
    const whole = m[3] === undefined || !/^\d+$/.test(m[3]);
    if (op === ">=") return cmp >= 0;
    if (op === ">") return whole ? hMaj > maj : cmp > 0;
    if (op === "<=") return whole ? hMaj <= maj : cmp <= 0;
    if (op === "<") return cmp < 0;
    return hMaj === maj && hMin >= min;
  };
  const alternatives = pin.trim().split(/\s*\|\|\s*/).map((alt) => alt.trim().split(/\s+/).map(one));
  if (alternatives.some((parts) => parts.some((p) => p === undefined))) return undefined;
  return alternatives.some((parts) => parts.every(Boolean));
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

/**
 * AWS credentials for a profile and when the CLI's current ones end. What the CLI reports is
 * the credentials it holds now: a static key refreshes a role for ever, an SSO session can end
 * before the role credentials it minted do. So this says what it knows and no more; the person
 * settles the rest.
 */
const awsCredential = async (profile?: string): Promise<{ who: string; expires?: Date } | undefined> => {
  const env = { ...process.env, ...(profile ? { AWS_PROFILE: profile } : {}) };
  try {
    const { stdout: who } = await run("aws", ["sts", "get-caller-identity", "--query", "Arn", "--output", "text"], { env, timeout: 15_000 });
    const exp = await run("aws", ["configure", "export-credentials", "--format", "process"], { env, timeout: 15_000 }).then(({ stdout }) => (JSON.parse(stdout) as { Expiration?: string }).Expiration).catch(() => undefined);
    // Neither the account nor the person's name reaches the page or anything pasted from it; that the call answered is the fact.
    void who;
    return { who: "signed in", ...(exp ? { expires: new Date(exp) } : {}) };
  } catch {
    return undefined;
  }
};

/** A tool's own version, for a `runtime: node >=24` line. */
const versionOf = async (tool: string): Promise<string | undefined> => {
  try {
    const { stdout } = await run(tool, ["--version"], { timeout: 10_000 });
    return stdout.trim().split("\n")[0];
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
  const push = (c: Omit<Check, "refuses">): void => { checks.push({ ...c, refuses: refuses(c) }); };
  push({ kind: "host", name: "host", status: "ok", detail: `${platform()} ${arch()}${platform() === "darwin" ? ", BSD tools: no timeout, sed -i needs '', no date -d" : ""}; node ${process.version}` });
  for (const tool of ["claude", "git", "python3", ...(input.landsRemotely ? ["gh"] : [])]) {
    const path = await has(tool);
    push({ kind: "tool", name: tool, status: path ? "ok" : "fail", detail: path ?? `not on PATH; every ${tool === "python3" ? "embedded terminal" : "agent"} needs it` });
  }
  for (const agent of [input.rioAgent, ...(input.wingmanAgent ? [input.wingmanAgent] : [])]) {
    const ok = await agentResolves(agent, input.projectPath);
    push({ kind: "agent", name: `agent ${agent}`, status: ok ? "ok" : "fail", detail: ok ? "installed" : `no ${agent}.md in ~/.claude/agents or the project's .claude/agents; the session would run without its standing orders (the README says how to install it)` });
  }
  for (const repo of input.repoPaths) {
    // `.nvmrc` first, then `engines.node`; a repo that pins nothing says nothing.
    const pin = await readFile(join(repo, ".nvmrc"), "utf8").catch(() => undefined)
      ?? await readFile(join(repo, "package.json"), "utf8").then((text) => (JSON.parse(text) as { engines?: { node?: string } }).engines?.node).catch(() => undefined);
    if (!pin) continue;
    // Against the node a Wingman's shell finds, not the one serving this page.
    const shellNode = (await versionOf("node")) ?? process.version;
    const met = versionMeets(pin, shellNode);
    push({ kind: "runtime", name: `node pin in ${repo.split("/").pop()}`, status: met === false ? "fail" : met === undefined ? "warn" : "ok", detail: met === false ? `wants ${pin.trim()}, the shell has ${shellNode}; a Wingman will go hunting for another node` : met === undefined ? `${pin.trim()} is a pin this check cannot read; compare it with ${shellNode} yourself` : `${pin.trim()} against ${shellNode}` });
  }
  for (const r of input.requirements) {
    if (r.kind === "tool" || r.kind === "runtime") {
      // `runtime: node >=24` is a version to meet; `tool: docker` is a binary to find.
      const [tool, ...pin] = r.value.split(/\s+/);
      const path = await has(tool);
      if (!path) push({ kind: r.kind, name: tool, status: "fail", detail: `not on PATH${r.note ? `; ${r.note}` : ""}` });
      else if (pin.length) {
        const have = await versionOf(tool);
        const met = have ? versionMeets(pin.join(" "), have) : undefined;
        push({ kind: "runtime", name: tool, status: met === false ? "fail" : met === undefined ? "warn" : "ok", detail: `${path}, ${have ?? "version unknown"} against ${pin.join(" ")}` });
      } else push({ kind: r.kind, name: tool, status: "ok", detail: path });
    } else if (r.kind === "credential" && /^aws\b/i.test(r.value)) {
      // `credential: aws`, or `credential: aws profile dev` / `aws dev` / `aws (dev)` to name the profile.
      const profile = r.value.match(/^aws(?:\s+profile)?[\s(]+([\w.-]+)\)?\s*$/i)?.[1];
      const cred = await awsCredential(profile);
      if (!cred) push({ kind: "credential", name: r.value, status: "fail", detail: `no AWS credentials resolve${profile ? ` for profile ${profile}` : " for the default profile"}; sign in before approving` });
      else {
        const left = cred.expires ? (cred.expires.getTime() - Date.now()) / 3_600_000 : undefined;
        const short = left !== undefined && hours !== undefined && left < hours;
        const caveat = "what the CLI holds now; a static key refreshes a role for ever, an SSO session can end sooner than the role credentials it minted, so check the session itself";
        push({ kind: "credential", name: r.value, status: short || hours === undefined || left === undefined ? "warn" : "ok", detail: `${cred.who}${left !== undefined ? `, current credentials end in ${left.toFixed(1)}h` : ", no expiry reported"}${hours === undefined ? "; the plan declares no duration, so the lifetime is not compared" : short ? ` but the mission expects ${duration!.value}` : ""}; ${caveat}` });
      }
    } else if (r.kind === "credential") {
      push({ kind: "credential", name: r.value, status: "human", detail: `confirm it is signed in and outlives the mission${r.note ? `: ${r.note}` : ""}` });
    } else if (r.kind === "secret") {
      push({ kind: "secret", name: `secret ${r.value}`, status: "human", detail: `confirm it exists where the plan reads it${r.note ? `: ${r.note}` : ""}` });
    } else if (r.kind === "human") {
      push({ kind: "human", name: r.value, status: "human", detail: r.note || "a person does this; the plan must not expect an agent to" });
    }
  }
  if (duration && hours === undefined) push({ kind: "host", name: "duration", status: "warn", detail: `"${duration.value}" is not a duration like 8h` });
  try {
    const { stdout } = await run("df", ["-k", input.projectPath]);
    const free = Number(stdout.trim().split("\n").pop()?.split(/\s+/)[3]) / 1_048_576;
    if (Number.isFinite(free)) push({ kind: "disk", name: "disk", status: free < 5 ? "warn" : "ok", detail: `${free.toFixed(0)} GB free; worktrees and node_modules per task add up` });
  } catch { /* no df: nothing to say */ }
  return checks;
};
