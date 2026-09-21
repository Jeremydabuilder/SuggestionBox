/**
 * Heuristic, best-effort rejection of durable-memory text that looks like a
 * secret or a student-identity field. This is a content filter on the text
 * a president is about to save as a memory — it never sees or touches
 * anything else, and it never logs what it rejected (the caller must not
 * log rejected content either).
 *
 * "Where reasonably detectable" — this cannot catch everything, and does
 * not try to. It exists to stop the obvious cases: a pasted email address,
 * something that looks like an API key or bearer token, a password, or a
 * long run of digits that could be a phone/SSN/card number.
 */

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const API_KEY_PATTERN = /\b(gsk_|sk-|pk_|eyJhbGciOi|AIza|xox[baprs]-)[A-Za-z0-9_-]{8,}/;
const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._-]{10,}/i;
const LONG_SECRET_LIKE = /\b[A-Za-z0-9_-]{32,}\b/;
const PASSWORD_WORD = /\b(password|passwd|pwd)\s*[:=]/i;
const LONG_DIGIT_RUN = /\b\d[\d -]{8,}\d\b/;
const IP_ADDRESS = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

export interface MemoryContentCheck {
  allowed: boolean;
  reason?: string;
}

export function checkMemoryContent(text: string): MemoryContentCheck {
  if (EMAIL_PATTERN.test(text)) return { allowed: false, reason: "looks like an email address" };
  if (API_KEY_PATTERN.test(text)) return { allowed: false, reason: "looks like an API key" };
  if (BEARER_PATTERN.test(text)) return { allowed: false, reason: "looks like an auth token" };
  if (PASSWORD_WORD.test(text)) return { allowed: false, reason: "looks like a password" };
  if (IP_ADDRESS.test(text)) return { allowed: false, reason: "looks like an IP address" };
  if (LONG_DIGIT_RUN.test(text)) return { allowed: false, reason: "looks like a phone number or id" };
  if (LONG_SECRET_LIKE.test(text)) return { allowed: false, reason: "looks like a secret or token" };
  return { allowed: true };
}
