import type { Memory } from "./chat-store.ts";

/**
 * Durable email-drafting preferences, read the exact same way
 * agent-identity.ts reads the agent's name: a recognizable text prefix on
 * an ordinary chat_memories row, resolved by "most recently updated
 * wins." Nothing in this file ever writes a memory — a preference is only
 * ever saved through the existing propose/confirm flow every other
 * durable memory change in this app already goes through
 * (requestCreateMemory / confirmMemoryAction), so a preference can never
 * be saved without a president's explicit confirmation click.
 */

export const EMAIL_SIGNOFF_MEMORY_PREFIX = "Email sign-off: ";
export const EMAIL_SIGNATURE_MEMORY_PREFIX = "Email signature: ";
export const EMAIL_STYLE_MEMORY_PREFIX = "Email style: ";
export const EMAIL_TONE_MEMORY_PREFIX = "Email tone: ";

export const EMAIL_STYLES = ["concise", "balanced", "detailed"] as const;
export type EmailStyle = (typeof EMAIL_STYLES)[number];
export const DEFAULT_EMAIL_STYLE: EmailStyle = "balanced";

export const EMAIL_TONES = ["warm", "formal"] as const;
export type EmailTone = (typeof EMAIL_TONES)[number];
export const DEFAULT_EMAIL_TONE: EmailTone = "warm";

export const DEFAULT_EMAIL_SIGNOFF = "Best";
export const DEFAULT_EMAIL_SIGNATURE = "The Co-Presidents";

function latestMemoryWithPrefix<T extends { memoryText: string; updatedAt: string }>(memories: T[], prefix: string): T | null {
  const matches = memories
    .filter((m) => m.memoryText.startsWith(prefix))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return matches[0] ?? null;
}

export interface EmailPreferences {
  signOff: string;
  signature: string;
  style: EmailStyle;
  tone: EmailTone;
}

export function resolveEmailPreferences(memories: Pick<Memory, "memoryText" | "updatedAt">[]): EmailPreferences {
  const signOffMemory = latestMemoryWithPrefix(memories, EMAIL_SIGNOFF_MEMORY_PREFIX);
  const signatureMemory = latestMemoryWithPrefix(memories, EMAIL_SIGNATURE_MEMORY_PREFIX);
  const styleMemory = latestMemoryWithPrefix(memories, EMAIL_STYLE_MEMORY_PREFIX);
  const toneMemory = latestMemoryWithPrefix(memories, EMAIL_TONE_MEMORY_PREFIX);

  const styleCandidate = styleMemory?.memoryText.slice(EMAIL_STYLE_MEMORY_PREFIX.length).trim().toLowerCase();
  const toneCandidate = toneMemory?.memoryText.slice(EMAIL_TONE_MEMORY_PREFIX.length).trim().toLowerCase();

  return {
    signOff: signOffMemory?.memoryText.slice(EMAIL_SIGNOFF_MEMORY_PREFIX.length).trim() || DEFAULT_EMAIL_SIGNOFF,
    signature: signatureMemory?.memoryText.slice(EMAIL_SIGNATURE_MEMORY_PREFIX.length).trim() || DEFAULT_EMAIL_SIGNATURE,
    style: (EMAIL_STYLES as readonly string[]).includes(styleCandidate ?? "") ? (styleCandidate as EmailStyle) : DEFAULT_EMAIL_STYLE,
    tone: (EMAIL_TONES as readonly string[]).includes(toneCandidate ?? "") ? (toneCandidate as EmailTone) : DEFAULT_EMAIL_TONE,
  };
}
