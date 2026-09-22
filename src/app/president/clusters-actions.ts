"use server";

import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildSuggestionClusters, type ClusterableMatch } from "@/lib/duplicates/clustering";
import type { SimilarityBreakdown } from "@/lib/duplicates/similarity";
import type { ActionResult } from "./actions";
import type { Category, Status } from "@/lib/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const MAX_MATCH_ROWS = 2000;

export interface ClusterMemberView {
  id: string;
  title: string;
  category: Category;
  status: Status;
}

export interface ClusterEdgeView {
  a: string;
  b: string;
  score: number;
  sameCategory: boolean;
  sharedKeywords: string[];
  confirmed: boolean;
}

export interface SuggestionClusterView {
  id: string;
  members: ClusterMemberView[];
  edges: ClusterEdgeView[];
}

interface MatchRow {
  suggestion_id: string;
  match_id: string;
  score: number;
  breakdown: SimilarityBreakdown;
  state: "suggested" | "confirmed" | "dismissed";
}

/**
 * Read-only deterministic topic clusters — no Groq call anywhere in this
 * path. Reads every non-dismissed match row (dismissed pairs never reach
 * lib/duplicates/clustering.ts at all, though it would also drop them
 * itself) plus the current title/category/status of every suggestion
 * involved, so a cluster always reflects live data, never a stale
 * snapshot. Archived suggestions are excluded from clustering, same as
 * they already are from ordinary duplicate scans.
 */
export async function getSuggestionClusters(): Promise<ActionResult<SuggestionClusterView[]>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { data: matchRows, error: matchError } = await supabase
    .from("suggestion_matches")
    .select("suggestion_id, match_id, score, breakdown, state")
    .neq("state", "dismissed")
    .limit(MAX_MATCH_ROWS);
  if (matchError) return fail("Clusters could not be loaded. Try again in a moment.");

  const rows = (matchRows ?? []) as MatchRow[];
  if (rows.length === 0) return { ok: true, data: [] };

  const clusterableMatches: ClusterableMatch[] = rows.map((row) => ({
    suggestionId: row.suggestion_id,
    matchId: row.match_id,
    score: row.score,
    sameCategory: row.breakdown?.sameCategory ?? false,
    sharedKeywords: row.breakdown?.sharedKeywords ?? [],
    state: row.state,
  }));

  const clusters = buildSuggestionClusters(clusterableMatches);
  if (clusters.length === 0) return { ok: true, data: [] };

  const allIds = [...new Set(clusters.flatMap((c) => c.suggestionIds))];
  const { data: suggestions, error: suggestionError } = await supabase
    .from("suggestions")
    .select("id, title, category, status")
    .in("id", allIds)
    .neq("status", "archived");
  if (suggestionError) return fail("Clusters could not be loaded. Try again in a moment.");

  const byId = new Map((suggestions ?? []).map((s: { id: string; title: string; category: Category; status: Status }) => [s.id, s]));

  const views: SuggestionClusterView[] = [];
  for (const cluster of clusters) {
    const members = cluster.suggestionIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (members.length < 2) continue; // archived/trashed members dropped it below a real cluster
    views.push({
      id: cluster.id,
      members: members.map((m) => ({ id: m.id, title: m.title, category: m.category, status: m.status })),
      edges: cluster.edges.filter((e) => byId.has(e.a) && byId.has(e.b)),
    });
  }

  return { ok: true, data: views };
}
