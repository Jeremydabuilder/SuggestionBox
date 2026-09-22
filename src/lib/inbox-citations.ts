/**
 * The one place an "Ask the Inbox" model answer's citations get checked
 * against what it was actually given. A citation ref the model invents —
 * one that was never in its retrieved evidence — must never reach the
 * president as if it were real. There is no partial trust here: if even
 * one cited ref falls outside the allowlist, the whole answer is treated
 * as unreliable by the caller (see chat-inbox-answer.ts), never silently
 * repaired or shown with the bad citation removed.
 */

const CITATION_REF_RE = /\[S(\d{3})\]/g;

export function extractCitedRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(CITATION_REF_RE)) refs.add(`S${match[1]}`);
  return [...refs];
}

export function allCitationsAllowed(text: string, allowedRefs: ReadonlySet<string>): boolean {
  return extractCitedRefs(text).every((ref) => allowedRefs.has(ref));
}
