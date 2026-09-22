import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildSuggestionClusters, CLUSTER_EDGE_THRESHOLDS, type ClusterableMatch } from "../src/lib/duplicates/clustering.ts";

function match(overrides: Partial<ClusterableMatch>): ClusterableMatch {
  return {
    suggestionId: "a",
    matchId: "b",
    score: 0.9,
    sameCategory: true,
    sharedKeywords: ["lunch"],
    state: "suggested",
    ...overrides,
  };
}

describe("buildSuggestionClusters — connected components", () => {
  test("two suggestions joined by a strong same-category edge form a cluster", () => {
    const clusters = buildSuggestionClusters([match({ suggestionId: "a", matchId: "b", score: 0.9 })]);
    assert.equal(clusters.length, 1);
    assert.deepEqual(clusters[0]!.suggestionIds, ["a", "b"]);
  });

  test("a chain of edges (a-b, b-c) merges into one 3-member cluster", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: 0.9 }),
      match({ suggestionId: "b", matchId: "c", score: 0.85 }),
    ]);
    assert.equal(clusters.length, 1);
    assert.deepEqual(clusters[0]!.suggestionIds, ["a", "b", "c"]);
  });

  test("two disjoint pairs produce two separate clusters", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: 0.9 }),
      match({ suggestionId: "x", matchId: "y", score: 0.9 }),
    ]);
    assert.equal(clusters.length, 2);
  });

  test("a single suggestion with no qualifying edge produces no cluster", () => {
    assert.deepEqual(buildSuggestionClusters([]), []);
  });

  test("clusters are sorted largest-first", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: 0.9 }),
      match({ suggestionId: "x", matchId: "y", score: 0.9 }),
      match({ suggestionId: "y", matchId: "z", score: 0.9 }),
    ]);
    assert.equal(clusters[0]!.suggestionIds.length, 3);
    assert.equal(clusters[1]!.suggestionIds.length, 2);
  });

  test("result is order-independent (same edges, different input order, same clusters)", () => {
    const edges = [
      match({ suggestionId: "a", matchId: "b", score: 0.9 }),
      match({ suggestionId: "b", matchId: "c", score: 0.85 }),
      match({ suggestionId: "x", matchId: "y", score: 0.9 }),
    ];
    const forward = buildSuggestionClusters(edges);
    const reversed = buildSuggestionClusters([...edges].reverse());
    assert.deepEqual(
      forward.map((c) => c.suggestionIds),
      reversed.map((c) => c.suggestionIds),
    );
  });
});

describe("weak-edge bridge prevention", () => {
  test("a same-category edge below MODERATE_THRESHOLD never joins a cluster, even though it would show in ordinary duplicate review (which uses a lower bar)", () => {
    const belowClusterBar = CLUSTER_EDGE_THRESHOLDS.sameCategory - 0.01;
    const clusters = buildSuggestionClusters([match({ suggestionId: "a", matchId: "b", score: belowClusterBar, sameCategory: true })]);
    assert.deepEqual(clusters, []);
  });

  test("one weak edge cannot bridge two otherwise-strong groups into one giant cluster", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: 0.95, sameCategory: true }),
      match({ suggestionId: "c", matchId: "d", score: 0.95, sameCategory: true }),
      // The weak bridge: below the clustering bar, so it must not merge {a,b} and {c,d}.
      match({ suggestionId: "b", matchId: "c", score: CLUSTER_EDGE_THRESHOLDS.sameCategory - 0.02, sameCategory: true }),
    ]);
    assert.equal(clusters.length, 2);
    for (const cluster of clusters) assert.equal(cluster.suggestionIds.length, 2);
  });
});

describe("cross-category threshold — stronger evidence required", () => {
  test("a cross-category edge at the same-category bar is NOT enough to cluster", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: CLUSTER_EDGE_THRESHOLDS.sameCategory + 0.02, sameCategory: false }),
    ]);
    assert.deepEqual(clusters, []);
  });

  test("a cross-category edge at or above STRONG_THRESHOLD does cluster", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: CLUSTER_EDGE_THRESHOLDS.crossCategory, sameCategory: false }),
    ]);
    assert.equal(clusters.length, 1);
  });
});

describe("dismissed relationships stay dismissed", () => {
  test("a dismissed pair never clusters, even with a very high score", () => {
    const clusters = buildSuggestionClusters([match({ suggestionId: "a", matchId: "b", score: 0.99, state: "dismissed" })]);
    assert.deepEqual(clusters, []);
  });

  test("dismissing one edge in a chain splits the cluster rather than silently keeping it whole", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: 0.9 }),
      match({ suggestionId: "b", matchId: "c", score: 0.9, state: "dismissed" }),
    ]);
    assert.equal(clusters.length, 1);
    assert.deepEqual(clusters[0]!.suggestionIds, ["a", "b"]);
  });
});

describe("a president's confirmation always counts", () => {
  test("a confirmed match clusters even below the score bar and across categories", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: 0.1, sameCategory: false, state: "confirmed" }),
    ]);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]!.edges[0]!.confirmed, true);
  });
});

describe("evidence is preserved per cluster", () => {
  test("each cluster carries its qualifying edges with score and shared keywords, sorted strongest-first", () => {
    const clusters = buildSuggestionClusters([
      match({ suggestionId: "a", matchId: "b", score: 0.99, sharedKeywords: ["recycling"] }),
      match({ suggestionId: "b", matchId: "c", score: 0.8, sharedKeywords: ["bins"] }),
    ]);
    assert.equal(clusters[0]!.edges.length, 2);
    assert.equal(clusters[0]!.edges[0]!.score, 0.99);
    assert.deepEqual(clusters[0]!.edges[0]!.sharedKeywords, ["recycling"]);
  });
});
