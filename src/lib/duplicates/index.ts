/**
 * Shared, client-safe helpers for working with duplicate matches.
 *
 * Nothing here touches the database or the server — the panel and the
 * detail pane both use it to turn the flat list of match rows into
 * per-suggestion answers.
 */
import type { Suggestion, SuggestionMatch } from "@/lib/types";

export { similarityLevel, LEVEL_LABEL, type SimilarityLevel } from "./similarity.ts";
export { canonicalPair, pairKey } from "./pair.ts";

/** All the match rows that involve a given suggestion, either way round. */
export function matchesFor(
  suggestionId: string,
  matches: readonly SuggestionMatch[],
): SuggestionMatch[] {
  return matches.filter(
    (m) => m.suggestion_id === suggestionId || m.match_id === suggestionId,
  );
}

/** The other suggestion's id in a pair. */
export function otherIdIn(match: SuggestionMatch, suggestionId: string): string {
  return match.suggestion_id === suggestionId ? match.match_id : match.suggestion_id;
}

/** How many live (not dismissed) possible duplicates a suggestion has. */
export function matchCountFor(
  suggestionId: string,
  matches: readonly SuggestionMatch[],
): number {
  return matchesFor(suggestionId, matches).filter((m) => m.state !== "dismissed").length;
}

/**
 * How many submissions are being tracked as the same idea — the primary
 * plus everything filed under it. Returns 0 when the suggestion is not part
 * of a group, so callers can just check for > 1.
 */
export function relatedGroupSize(
  suggestion: Suggestion,
  all: readonly Suggestion[],
): number {
  const primaryId = suggestion.primary_suggestion_id ?? suggestion.id;
  const members = all.filter(
    (s) => s.id === primaryId || s.primary_suggestion_id === primaryId,
  );
  return members.length > 1 ? members.length : 0;
}

/** Everything filed under this suggestion, most recent first. */
export function duplicatesOf(
  suggestionId: string,
  all: readonly Suggestion[],
): Suggestion[] {
  return all.filter((s) => s.primary_suggestion_id === suggestionId);
}
