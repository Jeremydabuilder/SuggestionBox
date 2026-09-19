/**
 * Text coming from an un-authenticated student is untrusted. We never render
 * it as HTML (React escapes everything), but we still normalise it on the way
 * into the database so that stored values are plain, sane text.
 */

// Strip C0/C1 control characters except tab and newline.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Zero-width and bidi-override characters, used to disguise text.
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;

export function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return "";
  return input
    .replace(CONTROL_CHARS, "")
    .replace(INVISIBLE, "")
    .replace(HTML_TAG, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Single-line fields (title, name, email) additionally lose newlines. */
export function sanitizeLine(input: unknown, maxLength: number): string {
  return sanitizeText(input, maxLength).replace(/\s*\n\s*/g, " ").trim();
}

/** Escape a string for safe interpolation into an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
