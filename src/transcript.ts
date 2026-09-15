/**
 * What a Claude Code session is doing, read from the transcript the CLI keeps at
 * `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`. Read-only, tail only (the files run
 * to megabytes), and tolerant of shapes we have not seen: a missing field is just absent.
 */
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TAIL_BYTES = 160 * 1024;

export interface TranscriptGlance {
  title?: string;
  lastPrompt?: string;
  lastReply?: string;
  lastActivity?: string;
}

const slugOf = (cwd: string): string => cwd.replace(/\//g, "-");

const textOf = (content: unknown): string | undefined => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null && "type" in c)
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  return parts.length ? parts.join(" ") : undefined;
};

const clip = (s: string, n = 200): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

export const glance = async (cwd: string, sessionId: string): Promise<TranscriptGlance> => {
  const path = join(homedir(), ".claude", "projects", slugOf(cwd), `${sessionId}.jsonl`);
  let handle;
  try {
    handle = await open(path, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // a partial first line
    const out: TranscriptGlance = {};
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = entry.type;
      const message = entry.message as { role?: string; content?: unknown } | undefined;
      if (type === "last-prompt" && typeof entry.lastPrompt === "string") {
        out.lastPrompt = clip(entry.lastPrompt);
      } else if (type === "ai-title") {
        const title = (entry.title ?? entry.aiTitle ?? entry.text) as string | undefined;
        if (title) out.title = clip(title, 120);
      } else if (type === "user" && message) {
        const text = textOf(message.content);
        if (text && !text.startsWith("<") && !/^\[Request interrupted/.test(text)) out.lastPrompt = clip(text);
      } else if (type === "assistant" && message) {
        const text = textOf(message.content);
        if (text) out.lastReply = clip(text);
      }
      if (typeof entry.timestamp === "string" && (type === "user" || type === "assistant")) out.lastActivity = entry.timestamp;
    }
    return out;
  } finally {
    await handle.close();
  }
};
