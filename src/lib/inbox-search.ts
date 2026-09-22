import type { Category, Status } from "./types.ts";

/**
 * Pure keyword/category/status search over already-fetched suggestions.
 * No Groq call, no I/O — the "use server" orchestrator
 * (inbox-search-actions.ts) does the fetching. Refs assigned here
 * (`S001`, `S002`, ...) are positional within THIS ONE result set only —
 * the same convention lib/meeting-agent.ts already uses — and are not a
 * durable identifier a later, unrelated message can resolve.
 *
 * Deliberately narrower than the full `Suggestion` type: it has no
 * student_name/student_email field at all, so nothing built from a
 * SearchableSuggestion can carry that PII downstream into a Groq prompt
 * (general_workspace_question) even by accident — the type itself makes
 * that impossible, not just a convention this file has to remember.
 */
export interface SearchableSuggestion {
  id: string;
  title: string;
  description: string;
  improvement_reason: string;
  category: Category;
  status: Status;
  created_at: string;
}

export interface InboxSearchFilters {
  query?: string;
  category?: Category;
  status?: Status;
}

export interface InboxSearchHit {
  ref: string;
  id: string;
  title: string;
  status: Status;
  category: Category;
}

export interface InboxSearchResult {
  hits: InboxSearchHit[];
  totalMatches: number;
  /** ref -> real suggestion id, for anything downstream (e.g. citation validation) that needs to resolve one. */
  refToId: Map<string, string>;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function matchesQuery(suggestion: SearchableSuggestion, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return true;
  const haystack = new Set(tokenize(`${suggestion.title} ${suggestion.description} ${suggestion.improvement_reason}`));
  return queryTokens.some((token) => haystack.has(token));
}

export function searchInboxSuggestions(
  suggestions: SearchableSuggestion[],
  filters: InboxSearchFilters,
  limit: number,
): InboxSearchResult {
  const queryTokens = filters.query ? tokenize(filters.query) : [];

  const filtered = suggestions
    .filter((s) => (filters.category ? s.category === filters.category : true))
    .filter((s) => (filters.status ? s.status === filters.status : true))
    .filter((s) => matchesQuery(s, queryTokens))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const capped = filtered.slice(0, Math.max(0, limit));
  const refToId = new Map<string, string>();
  const hits: InboxSearchHit[] = capped.map((s, index) => {
    const ref = `S${String(index + 1).padStart(3, "0")}`;
    refToId.set(ref, s.id);
    return { ref, id: s.id, title: s.title, status: s.status, category: s.category };
  });

  return { hits, totalMatches: filtered.length, refToId };
}
