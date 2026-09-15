/**
 * A session's conversation, read from the transcript Claude Code keeps, shaped for a chat
 * view: prompts, replies, and tool calls as small events. Incremental: the caller passes the
 * byte offset it last saw and gets only what was appended since.
 */
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ChatEvent {
  t: string;
  role: "user" | "assistant" | "system";
  /** Prose, markdown as written. */
  text?: string;
  /** Tool calls in this assistant turn: name and a one-line gloss of the input. */
  tools?: Array<{ name: string; gloss: string }>;
  /** Count of tool results carried by a user turn (their bodies are not shipped to the page). */
  results?: number;
  interrupted?: boolean;
  /** For system events: what the harness injected (task notification, reminder, command output). */
  label?: string;
}

/** Text the harness puts in the user's seat: not something Cory typed. */
const SYSTEM_TAGS: Array<[RegExp, string]> = [
  [/^\s*<task-notification/, "task notification"],
  [/^\s*\[SYSTEM NOTIFICATION/, "system notification"],
  [/^\s*This session is being continued from a previous conversation/, "context summary"],
  [/^\s*<system-reminder/, "system reminder"],
  [/^\s*<local-command-(stdout|stderr|caveat)/, "command output"],
  [/^\s*<command-(name|message|args)/, "slash command"],
  [/^\s*<ide_/, "editor context"],
];
const systemLabel = (text: string): string | undefined => SYSTEM_TAGS.find(([re]) => re.test(text))?.[1];

export interface TranscriptPage {
  events: ChatEvent[];
  offset: number;
  size: number;
  title?: string;
}

const slugOf = (cwd: string): string => cwd.replace(/\//g, "-");
/** First read of a big file starts with this much tail and widens until enough prose turns are in view. */
const FIRST_TAIL = 512 * 1024;
const WIDEST_TAIL = 16 * 1024 * 1024;
const ENOUGH_PROSE = 24;

const gloss = (name: string, input: Record<string, unknown> | undefined): string => {
  if (!input) return "";
  const pick = (input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.description ?? input.prompt ?? input.url ?? "") as string;
  const s = String(pick).replace(/\s+/g, " ").trim();
  return s.length > 110 ? `${s.slice(0, 109)}…` : s;
};

export const transcriptPath = (cwd: string, sessionId: string): string =>
  join(homedir(), ".claude", "projects", slugOf(cwd), `${sessionId}.jsonl`);

export const readTranscript = async (cwd: string, sessionId: string, from = 0): Promise<TranscriptPage> => {
  const path = transcriptPath(cwd, sessionId);
  let handle;
  try {
    handle = await open(path, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { events: [], offset: 0, size: 0 };
    throw err;
  }
  try {
    const { size } = await handle.stat();
    if (from > 0) return parseFrom(handle, Math.min(from, size), size, false);
    // First read of a big file: a tail, widened while it holds little but tool traffic
    // (tool results dominate the bytes), so the page opens on real conversation.
    let tail = FIRST_TAIL;
    for (;;) {
      const start = Math.max(0, size - tail);
      const page = await parseFrom(handle, start, size, start > 0);
      const prose = page.events.filter((e) => e.role !== "system" && e.text).length;
      if (start === 0 || prose >= ENOUGH_PROSE || tail >= WIDEST_TAIL) return page;
      tail *= 4;
    }
  } finally {
    await handle.close();
  }
};

const parseFrom = async (handle: Awaited<ReturnType<typeof open>>, start: number, size: number, cut: boolean): Promise<TranscriptPage> => {
  {
    if (size <= start) return { events: [], offset: size, size };
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    const lines = text.split("\n");
    const complete = text.endsWith("\n") ? lines : lines.slice(0, -1);
    if (cut) complete.shift(); // a partial first line at the cut
    const consumed = complete.reduce((n, l) => n + Buffer.byteLength(l, "utf8") + 1, 0);
    const events: ChatEvent[] = [];
    let title: string | undefined;
    for (const line of complete) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (entry.type === "ai-title" && typeof entry.aiTitle === "string") title = entry.aiTitle;
      const message = entry.message as { role?: string; content?: unknown } | undefined;
      const t = typeof entry.timestamp === "string" ? entry.timestamp : "";
      if (entry.type === "user" && message) {
        const c = message.content;
        const pushUser = (text: string, results?: number) => {
          const label = systemLabel(text);
          if (label) events.push({ t, role: "system", label, text });
          else events.push({ t, role: "user", text, ...(results ? { results } : {}) });
        };
        if (typeof c === "string") {
          if (c.startsWith("[Request interrupted")) events.push({ t, role: "user", interrupted: true });
          else pushUser(c);
        } else if (Array.isArray(c)) {
          const texts = c.filter((p): p is { type: string; text: string } => typeof p === "object" && p !== null && (p as { type?: string }).type === "text").map((p) => p.text);
          const results = c.filter((p) => typeof p === "object" && p !== null && (p as { type?: string }).type === "tool_result").length;
          if (texts.length) pushUser(texts.join("\n"), results);
          else if (results) events.push({ t, role: "user", results });
        }
      } else if (entry.type === "assistant" && message && Array.isArray(message.content)) {
        const texts: string[] = [];
        const tools: ChatEvent["tools"] = [];
        for (const part of message.content as Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>) {
          if (part.type === "text" && part.text) texts.push(part.text);
          else if (part.type === "tool_use" && part.name) tools.push({ name: part.name, gloss: gloss(part.name, part.input) });
        }
        if (texts.length || tools.length) events.push({ t, role: "assistant", ...(texts.length ? { text: texts.join("\n\n") } : {}), ...(tools.length ? { tools } : {}) });
      }
    }
    return { events, offset: start + consumed, size, ...(title ? { title } : {}) };
  }
};
