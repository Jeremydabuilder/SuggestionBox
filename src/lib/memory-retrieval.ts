import type { Memory } from "./chat-store.ts";

/**
 * Deterministic, zero-credit retrieval for future chat context building.
 * No AI call anywhere in this file. Ranking is pure keyword overlap with a
 * mild preference for rarer/longer words (a generic word like "the"
 * shouldn't outrank a specific one like "assembly"), and results are
 * capped by both count and total characters so a chat request can never
 * balloon into a full-history dump.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is",
  "are", "was", "were", "be", "been", "with", "at", "by", "from", "this",
  "that", "it", "its", "as", "we", "our", "us", "i", "you", "your",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

export interface RankedMemory {
  memory: Memory;
  score: number;
}

/**
 * Rank memories against a query by token overlap. A token that appears in
 * fewer memories (rarer across the set) counts for more than a common one
 * — a crude but effective stand-in for IDF without any external model.
 */
export function rankMemories(memories: Memory[], query: string): RankedMemory[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  const tokenized = memories.map((memory) => ({ memory, tokens: new Set(tokenize(memory.memoryText)) }));

  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const { tokens } of tokenized) if (tokens.has(token)) count += 1;
    documentFrequency.set(token, count);
  }

  const ranked: RankedMemory[] = [];
  for (const { memory, tokens } of tokenized) {
    let score = 0;
    for (const token of queryTokens) {
      if (!tokens.has(token)) continue;
      const frequency = documentFrequency.get(token) ?? 1;
      // Rarer token (appears in fewer memories) scores higher; a token
      // every memory shares contributes almost nothing.
      score += 1 / frequency;
    }
    if (score > 0) ranked.push({ memory, score });
  }

  return ranked.sort((a, b) => b.score - a.score || a.memory.memoryText.length - b.memory.memoryText.length);
}

export interface RetrievalLimits {
  maxCount: number;
  maxTotalChars: number;
}

export const DEFAULT_RETRIEVAL_LIMITS: RetrievalLimits = {
  maxCount: 6,
  maxTotalChars: 1200,
};

/**
 * Take the top-ranked memories up to both a count cap and a total
 * character budget — whichever is reached first stops inclusion. Never
 * returns "everything" regardless of how relevant the whole set is.
 */
export function selectRelevantMemories(
  memories: Memory[],
  query: string,
  limits: RetrievalLimits = DEFAULT_RETRIEVAL_LIMITS,
): Memory[] {
  const ranked = rankMemories(memories, query);
  const selected: Memory[] = [];
  let totalChars = 0;

  for (const { memory } of ranked) {
    if (selected.length >= limits.maxCount) break;
    const nextTotal = totalChars + memory.memoryText.length;
    if (selected.length > 0 && nextTotal > limits.maxTotalChars) break;
    selected.push(memory);
    totalChars = nextTotal;
  }

  return selected;
}
