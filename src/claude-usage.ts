/**
 * Claude's own numbers for the plan's rate windows: the endpoint Claude Code's /usage command
 * reads. Authenticated with the CLI's OAuth token from the macOS keychain, which never leaves
 * this process. Cached for a minute; a failure keeps the last good numbers marked stale, and a
 * 429 backs off (Retry-After, else doubling from two minutes).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CACHE_MS = 60_000;
const HOLD_MIN_MS = 2 * 60_000;
const HOLD_MAX_MS = 15 * 60_000;

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
  /** When `data` was fetched; older than the cache window when `stale` is set. */
  fetchedAt: string;
  subscription?: string;
  /** The endpoint's body, which carries no secrets. */
  data?: { five_hour?: { utilization: number; resets_at: string | null }; seven_day?: { utilization: number; resets_at: string | null }; limits?: LiveLimit[] } & Record<string, unknown>;
  /** The last fetch failed with this; `data` is the last good answer. */
  stale?: string;
  /** The fetch failed with this and no good answer came before it. */
  error?: string;
}

let cached: LiveUsage | null = null;
let checkedAt = 0;
let heldUntil = 0;
let holdMs = HOLD_MIN_MS;

const credentials = async (): Promise<{ token: string; subscription?: string }> => {
  const { stdout } = await run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
  const parsed = JSON.parse(stdout.trim()) as { claudeAiOauth?: { accessToken?: string; subscriptionType?: string } };
  const token = parsed.claudeAiOauth?.accessToken;
  if (!token) throw new Error(`the "${KEYCHAIN_SERVICE}" keychain entry has no access token; sign in with claude first`);
  return { token, subscription: parsed.claudeAiOauth?.subscriptionType };
};

/** Retry-After is seconds or an HTTP date; absent or unreadable gives null. The endpoint sends `0`, which callers treat as absent. */
const retryAfterMs = (res: Response): number | null => {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
};

export const liveUsage = async (force = false): Promise<LiveUsage> => {
  const now = Date.now();
  if (cached && (now < heldUntil || (!force && now - checkedAt < CACHE_MS))) return cached;
  checkedAt = now;
  const fetchedAt = new Date(now).toISOString();
  try {
    const { token, subscription } = await credentials();
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      void res.body?.cancel();
      const hold = retryAfterMs(res) || holdMs;
      heldUntil = now + hold;
      holdMs = Math.min(holdMs * 2, HOLD_MAX_MS);
      throw new Error(`rate limited by the usage endpoint; holding off ${Math.ceil(hold / 60_000)} min`);
    }
    const body = (await res.json()) as LiveUsage["data"];
    if (!res.ok) throw new Error(`${res.status} from the usage endpoint: ${JSON.stringify(body).slice(0, 200)}`);
    holdMs = HOLD_MIN_MS;
    cached = { fetchedAt, subscription, data: body };
  } catch (err) {
    const reason = (err as Error).message;
    cached = cached?.data ? { ...cached, stale: reason } : { fetchedAt, error: reason };
  }
  return cached;
};
