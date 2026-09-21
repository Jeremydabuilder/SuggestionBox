/**
 * Pure bounding/sanitization for any text that might eventually reach an AI
 * prompt. Stage 3 does not send suggestion content to Groq at all — this
 * exists now so later stages (Ask the Inbox, Proposal Builder) have one
 * tested place to bound retrieved text before it is ever interpolated into
 * a prompt, rather than each future call site inventing its own truncation.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Strip control characters, collapse whitespace, and cap length. Never throws. */
export function boundTextForPrompt(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return "";
  return input
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Bounds each item in a list and caps how many items survive at all. */
export function boundTextList(items: unknown[], maxItems: number, maxLengthEach: number): string[] {
  return items
    .slice(0, maxItems)
    .map((item) => boundTextForPrompt(item, maxLengthEach))
    .filter((item) => item.length > 0);
}
