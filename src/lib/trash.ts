/**
 * Pure, framework-free trash helpers — no "server-only" or "use server"
 * import here, deliberately, so this stays importable from both a Server
 * Action file and a Client Component without either constraint fighting
 * the other (a "use server" file's exports must all be async functions;
 * this one isn't).
 */

/** The exact phrase a president must type to permanently delete a suggestion. */
export function confirmationPhraseFor(suggestionId: string): string {
  return `DELETE ${suggestionId.slice(0, 8).toUpperCase()}`;
}
