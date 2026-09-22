import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  DUPLICATE_THRESHOLD,
  defaultStrategy,
  findMatches,
  type SimilarityStrategy,
  type SuggestionForMatching,
} from "./similarity.ts";
import { canonicalPair, pairKey } from "./pair.ts";

export { canonicalPair } from "./pair.ts";

/**
 * Finding and recording possible duplicates.
 *
 * Everything here is advisory. It writes rows to `suggestion_matches` and
 * nothing else: no suggestion is ever edited, archived, merged, rejected or
 * deleted by this code, and a decision a president has already made is never
 * overwritten by a later scan.
 */

/** Scanning is capped so a submission can never become slow. */
const CANDIDATE_LIMIT = 500;

const MATCHABLE_COLUMNS = "id, title, description, improvement_reason, category";

export interface DetectionResult {
  scanned: number;
  recorded: number;
  skipped: number;
}

/**
 * Compare one suggestion with the active ones already in the box and record
 * anything worth a president's attention.
 *
 * Archived suggestions are not candidates — a president has already filed
 * them away, and resurfacing them as duplicates would undo that.
 */
export async function detectDuplicatesFor(
  suggestionId: string,
  strategy: SimilarityStrategy = defaultStrategy,
): Promise<DetectionResult> {
  const service = createSupabaseServiceClient();

  const { data: subject, error: subjectError } = await service
    .from("suggestions")
    .select(MATCHABLE_COLUMNS)
    .eq("id", suggestionId)
    .single();

  if (subjectError || !subject) {
    throw new Error(subjectError?.message ?? "Suggestion not found.");
  }

  const { data: candidates, error: candidateError } = await service
    .from("suggestions")
    .select(MATCHABLE_COLUMNS)
    .neq("id", suggestionId)
    .neq("status", "archived")
    .is("trashed_at", null)
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);

  if (candidateError) throw new Error(candidateError.message);

  const pool = (candidates ?? []) as SuggestionForMatching[];
  const matches = findMatches(subject as SuggestionForMatching, pool, strategy);
  if (matches.length === 0) return { scanned: pool.length, recorded: 0, skipped: 0 };

  // A president's decision outranks the detector. Any pair already marked
  // confirmed or dismissed is left exactly as it is — which is what stops a
  // dismissed match reappearing the next time anything is scanned.
  const { data: existing, error: existingError } = await service
    .from("suggestion_matches")
    .select("suggestion_id, match_id, state")
    .or(`suggestion_id.eq.${suggestionId},match_id.eq.${suggestionId}`);

  if (existingError) throw new Error(existingError.message);

  const decided = new Set(
    (existing ?? [])
      .filter((row) => row.state !== "suggested")
      .map((row) => pairKey(row.suggestion_id, row.match_id)),
  );

  const rows = [];
  let skipped = 0;
  for (const match of matches) {
    const [low, high] = canonicalPair(suggestionId, match.other.id);
    if (decided.has(pairKey(low, high))) {
      skipped += 1;
      continue;
    }
    rows.push({
      suggestion_id: low,
      match_id: high,
      score: match.breakdown.score,
      breakdown: match.breakdown,
      method: strategy.method,
      state: "suggested",
    });
  }

  if (rows.length > 0) {
    const { error } = await service
      .from("suggestion_matches")
      .upsert(rows, { onConflict: "suggestion_id,match_id" });
    if (error) throw new Error(error.message);
  }

  return { scanned: pool.length, recorded: rows.length, skipped };
}

/**
 * Re-compare every active suggestion. Used to bring suggestions that predate
 * duplicate detection into the picture, and after the scoring method changes.
 * Confirmed and dismissed decisions survive it untouched.
 */
export async function rescanAllDuplicates(
  strategy: SimilarityStrategy = defaultStrategy,
): Promise<DetectionResult> {
  const service = createSupabaseServiceClient();

  const { data, error } = await service
    .from("suggestions")
    .select(MATCHABLE_COLUMNS)
    .neq("status", "archived")
    .is("trashed_at", null)
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);

  if (error) throw new Error(error.message);
  const pool = (data ?? []) as SuggestionForMatching[];

  const { data: existing, error: existingError } = await service
    .from("suggestion_matches")
    .select("suggestion_id, match_id, state");
  if (existingError) throw new Error(existingError.message);

  const decided = new Set(
    (existing ?? [])
      .filter((row) => row.state !== "suggested")
      .map((row) => pairKey(row.suggestion_id, row.match_id)),
  );

  const rows = new Map<string, Record<string, unknown>>();
  let skipped = 0;

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const breakdown = strategy.compare(pool[i]!, pool[j]!);
      if (breakdown.score < DUPLICATE_THRESHOLD) continue;
      const [low, high] = canonicalPair(pool[i]!.id, pool[j]!.id);
      const key = pairKey(low, high);
      if (decided.has(key)) {
        skipped += 1;
        continue;
      }
      rows.set(key, {
        suggestion_id: low,
        match_id: high,
        score: breakdown.score,
        breakdown,
        method: strategy.method,
        state: "suggested",
      });
    }
  }

  if (rows.size > 0) {
    const { error: upsertError } = await service
      .from("suggestion_matches")
      .upsert([...rows.values()], { onConflict: "suggestion_id,match_id" });
    if (upsertError) throw new Error(upsertError.message);
  }

  return { scanned: pool.length, recorded: rows.size, skipped };
}
