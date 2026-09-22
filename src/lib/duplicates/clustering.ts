import { MODERATE_THRESHOLD, STRONG_THRESHOLD } from "./similarity.ts";

/**
 * Deterministic topic clustering, built entirely on top of the existing
 * pairwise duplicate-detection edges (suggestion_matches) — no new
 * table, no new migration. A cluster is a connected component of
 * suggestions joined by edges that clear a bar STRICTER than the bar
 * that gets a pair shown for review at all (DUPLICATE_THRESHOLD, 0.62):
 * same-category edges need MODERATE_THRESHOLD (0.7), cross-category
 * edges need STRONG_THRESHOLD (0.78) — "require stronger evidence for
 * cross-category relationships." This is what stops one weak, borderline
 * pair from silently bridging two otherwise-unrelated large groups into
 * one — a weak edge (0.62-0.69) still shows up in ordinary duplicate
 * review, it just never contributes to a cluster.
 *
 * A president's own confirmed match always counts, regardless of score
 * or category — an explicit human decision outranks the algorithm. A
 * dismissed match is never included, ever, which is exactly what makes
 * a correction persist without rewriting history: the correction lives
 * in suggestion_matches.state, already durable, already respected by
 * every rescan (see duplicates/service.ts) — clustering just reads the
 * same source of truth.
 *
 * Nothing here merges, deletes, or edits a suggestion. A cluster is a
 * read-only grouping; every suggestion in it is untouched and still
 * exists exactly as it did before.
 */

export type MatchState = "suggested" | "confirmed" | "dismissed";

export interface ClusterableMatch {
  suggestionId: string;
  matchId: string;
  score: number;
  sameCategory: boolean;
  sharedKeywords: string[];
  state: MatchState;
}

export interface ClusterEdge {
  a: string;
  b: string;
  score: number;
  sameCategory: boolean;
  sharedKeywords: string[];
  confirmed: boolean;
}

export interface SuggestionCluster {
  /** Stable within one computation — the lexicographically-smallest member id. Not a database id; nothing is stored under it. */
  id: string;
  suggestionIds: string[];
  edges: ClusterEdge[];
}

export const CLUSTER_EDGE_THRESHOLDS = {
  sameCategory: MODERATE_THRESHOLD,
  crossCategory: STRONG_THRESHOLD,
} as const;

function qualifies(m: ClusterableMatch): boolean {
  if (m.state === "dismissed") return false;
  if (m.state === "confirmed") return true;
  const bar = m.sameCategory ? CLUSTER_EDGE_THRESHOLDS.sameCategory : CLUSTER_EDGE_THRESHOLDS.crossCategory;
  return m.score >= bar;
}

class DisjointSet {
  private parent = new Map<string, string>();

  private ensure(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    this.ensure(id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  ids(): string[] {
    return [...this.parent.keys()];
  }
}

/**
 * Connected-components clustering. Deterministic and order-independent:
 * the same set of matches always produces the same clusters, regardless
 * of input order (union-find with path compression; groups are sorted
 * before being returned).
 */
export function buildSuggestionClusters(matches: ClusterableMatch[]): SuggestionCluster[] {
  const qualifyingMatches = matches.filter(qualifies);
  const sets = new DisjointSet();

  for (const m of qualifyingMatches) sets.union(m.suggestionId, m.matchId);

  const groups = new Map<string, string[]>();
  for (const id of sets.ids()) {
    const root = sets.find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }

  const edgesByRoot = new Map<string, ClusterEdge[]>();
  for (const m of qualifyingMatches) {
    const root = sets.find(m.suggestionId);
    const list = edgesByRoot.get(root) ?? [];
    list.push({ a: m.suggestionId, b: m.matchId, score: m.score, sameCategory: m.sameCategory, sharedKeywords: m.sharedKeywords, confirmed: m.state === "confirmed" });
    edgesByRoot.set(root, list);
  }

  const clusters: SuggestionCluster[] = [];
  for (const [root, ids] of groups) {
    if (ids.length < 2) continue; // a single suggestion with no qualifying edge is not a cluster
    const sortedIds = [...ids].sort();
    clusters.push({
      id: sortedIds[0]!,
      suggestionIds: sortedIds,
      edges: (edgesByRoot.get(root) ?? []).sort((x, y) => y.score - x.score),
    });
  }

  return clusters.sort((a, b) => b.suggestionIds.length - a.suggestionIds.length || a.id.localeCompare(b.id));
}
