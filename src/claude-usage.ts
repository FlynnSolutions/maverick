/**
 * Claude's own numbers for the plan's rate windows: the endpoint Claude Code's /usage command
 * reads. Authenticated with the CLI's OAuth token from the macOS keychain, which never leaves
 * this process. Cached for a minute; failures are reported, not hidden.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CACHE_MS = 60_000;

export interface LiveLimit {
  kind: string;
  group: string;
  percent: number;
  severity: string;
  resets_at: string | null;
  scope: Record<string, unknown> | null;
  is_active: boolean;
}

export interface LiveUsage {
  fetchedAt: string;
  subscription?: string;
  /** The endpoint's body, which carries no secrets. */
  data?: { five_hour?: { utilization: number; resets_at: string | null }; seven_day?: { utilization: number; resets_at: string | null }; limits?: LiveLimit[] } & Record<string, unknown>;
  error?: string;
}

let cached: LiveUsage | null = null;

const credentials = async (): Promise<{ token: string; subscription?: string }> => {
  const { stdout } = await run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
  const parsed = JSON.parse(stdout.trim()) as { claudeAiOauth?: { accessToken?: string; subscriptionType?: string } };
  const token = parsed.claudeAiOauth?.accessToken;
  if (!token) throw new Error(`the "${KEYCHAIN_SERVICE}" keychain entry has no access token; sign in with claude first`);
  return { token, subscription: parsed.claudeAiOauth?.subscriptionType };
};

export const liveUsage = async (force = false): Promise<LiveUsage> => {
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_MS) return cached;
  const fetchedAt = new Date().toISOString();
  try {
    const { token, subscription } = await credentials();
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json()) as LiveUsage["data"];
    if (!res.ok) throw new Error(`${res.status} from the usage endpoint: ${JSON.stringify(body).slice(0, 200)}`);
    cached = { fetchedAt, subscription, data: body };
  } catch (err) {
    cached = { fetchedAt, error: (err as Error).message };
  }
  return cached;
};
