import type { Memory } from "./chat-store.ts";

/**
 * The agent's name and short description. Both co-presidents see the same
 * name because it lives in the shared `chat_memories` table — there is no
 * per-user setting anywhere in this file. Nothing here writes memory;
 * that still only ever happens through the existing propose/confirm
 * flow (see agent-settings-actions.ts), exactly like every other durable
 * memory change in this app.
 */

export const AGENT_DEFAULT_NAME = "Co-President Agent";

export const AGENT_DESCRIPTION =
  "Your private student-government assistant for turning student ideas into organized action.";

export const AGENT_NAME_LIMITS = { minLength: 1, maxLength: 40 } as const;

/** The exact, recognizable prefix a name-memory's text must start with. Never shown to the model as an instruction — this is a pure string convention this file alone reads. */
export const AGENT_NAME_MEMORY_PREFIX = "Agent name: ";

export function agentNameMemoryText(name: string): string {
  return `${AGENT_NAME_MEMORY_PREFIX}${name}`;
}

export function isAgentNameMemory(memoryText: string): boolean {
  return memoryText.startsWith(AGENT_NAME_MEMORY_PREFIX);
}

/** A bare, already-trimmed candidate name is valid only if it's short, single-line, and non-empty. */
export function isValidAgentName(name: string): boolean {
  return (
    name.length >= AGENT_NAME_LIMITS.minLength &&
    name.length <= AGENT_NAME_LIMITS.maxLength &&
    !/[\r\n]/.test(name)
  );
}

/**
 * The most recently updated agent-name memory wins — if both presidents
 * somehow race a rename, the later confirmed one is what everyone sees,
 * same as any other shared memory. Falls back to AGENT_DEFAULT_NAME when
 * no such memory exists yet, never an empty string.
 */
export function resolveAgentName(memories: Pick<Memory, "memoryText" | "updatedAt">[]): string {
  const nameMemories = memories
    .filter((m) => isAgentNameMemory(m.memoryText))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const latest = nameMemories[0];
  if (!latest) return AGENT_DEFAULT_NAME;
  const candidate = latest.memoryText.slice(AGENT_NAME_MEMORY_PREFIX.length).trim();
  return isValidAgentName(candidate) ? candidate : AGENT_DEFAULT_NAME;
}

/** Finds the existing agent-name memory (if any), for an edit-in-place proposal rather than piling up duplicates. */
export function findAgentNameMemory<T extends { memoryText: string; updatedAt: string }>(memories: T[]): T | null {
  const nameMemories = memories
    .filter((m) => isAgentNameMemory(m.memoryText))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return nameMemories[0] ?? null;
}
