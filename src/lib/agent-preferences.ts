import type { Memory } from "./chat-store.ts";

/**
 * Agent Settings that are genuinely durable (response style) use the
 * exact same shared-memory mechanism as agent-identity.ts's name — a
 * recognizable text prefix inside an ordinary chat_memories row, written
 * only through the existing propose/confirm flow. No new table, no new
 * migration. Tone/meeting-format preferences the president records in
 * conversation continue to go through Memory Manager exactly as before;
 * this file does not duplicate that free-form path.
 */

export const RESPONSE_STYLES = ["concise", "balanced", "detailed"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];
export const DEFAULT_RESPONSE_STYLE: ResponseStyle = "balanced";

export const RESPONSE_STYLE_MEMORY_PREFIX = "Response style: ";

export function responseStyleMemoryText(style: ResponseStyle): string {
  return `${RESPONSE_STYLE_MEMORY_PREFIX}${style}`;
}

export function isResponseStyleMemory(memoryText: string): boolean {
  return memoryText.startsWith(RESPONSE_STYLE_MEMORY_PREFIX);
}

export function resolveResponseStyle(memories: Pick<Memory, "memoryText" | "updatedAt">[]): ResponseStyle {
  const styleMemories = memories
    .filter((m) => isResponseStyleMemory(m.memoryText))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const latest = styleMemories[0];
  if (!latest) return DEFAULT_RESPONSE_STYLE;
  const candidate = latest.memoryText.slice(RESPONSE_STYLE_MEMORY_PREFIX.length).trim();
  return (RESPONSE_STYLES as readonly string[]).includes(candidate) ? (candidate as ResponseStyle) : DEFAULT_RESPONSE_STYLE;
}

export function findResponseStyleMemory<T extends { memoryText: string; updatedAt: string }>(memories: T[]): T | null {
  const styleMemories = memories
    .filter((m) => isResponseStyleMemory(m.memoryText))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return styleMemories[0] ?? null;
}
