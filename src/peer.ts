/**
 * Type into a running interactive Claude Code session over its messaging socket: the same
 * channel sessions use to message each other. The session's registry record names the
 * socket; the key file beside it (owner-only) holds the peer token. One connection per
 * message: an auth line, then the user frame, newline-delimited JSON. The receiving Claude
 * sees it as a peer message, not as its user typing, and says so in its own guidance.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { config } from "./config.ts";

interface RegistryRecord {
  pid: number;
  messagingSocketPath?: string;
  peerProtocol?: number;
}

const peerToken = async (pid: number): Promise<string> => {
  const files = (await readdir(config.claudeSessionsDir)).filter((f) => new RegExp(`^${pid}\\.[0-9a-f]{64}\\.key$`).test(f));
  if (!files.length) throw new Error(`session ${pid} has no messaging key; it may be an older Claude Code or not accepting peers`);
  const parsed = JSON.parse(await readFile(join(config.claudeSessionsDir, files[0]), "utf8")) as { peerToken?: string };
  if (!parsed.peerToken) throw new Error(`the messaging key for session ${pid} has no peer token`);
  return parsed.peerToken;
};

export const sendToSession = async (pid: number, text: string): Promise<{ msgId: string }> => {
  if (!text.trim()) throw new Error("the message is empty");
  const record = JSON.parse(await readFile(join(config.claudeSessionsDir, `${pid}.json`), "utf8")) as RegistryRecord;
  if (!record.messagingSocketPath) throw new Error(`session ${pid} has no messaging socket`);
  if (record.peerProtocol !== undefined && record.peerProtocol !== 1) throw new Error(`session ${pid} speaks peer protocol ${record.peerProtocol}; Maverick knows 1`);
  const token = await peerToken(pid);
  const msgId = randomUUID();
  const frame = { msgV: 1, msg_id: msgId, type: "user", message: { role: "user", content: text }, priority: "next" };
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(record.messagingSocketPath as string);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`session ${pid} did not take the message within 5s`)); }, 5000);
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ type: "auth", token })}\n`);
      socket.write(`${JSON.stringify(frame)}\n`, () => socket.end());
    });
    socket.on("error", (err) => { clearTimeout(timer); reject(new Error(`session ${pid}: ${err.message}`)); });
    socket.on("close", () => { clearTimeout(timer); resolve(); });
  });
  return { msgId };
};
