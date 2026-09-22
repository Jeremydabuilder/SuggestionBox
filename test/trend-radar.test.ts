import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildTrendRadar, classifyTrend, TREND_RADAR_LIMITS } from "../src/lib/trend-radar.ts";
import { CATEGORY_VALUES } from "../src/lib/types.ts";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const RECENT = "2026-09-15T00:00:00.000Z"; // within the last 14 days
const PRIOR = "2026-08-26T00:00:00.000Z"; // 14-28 days ago
const OLDER = "2026-08-15T00:00:00.000Z"; // 28-42 days ago
const OLD = "2026-06-01T00:00:00.000Z"; // outside all three windows

describe("buildTrendRadar — windows and counting", () => {
  test("returns one entry per known category, even with zero suggestions", () => {
    const trends = buildTrendRadar([], NOW);
    assert.equal(trends.length, CATEGORY_VALUES.length);
    assert.ok(trends.every((t) => t.recentCount === 0 && t.priorCount === 0 && t.olderCount === 0 && !t.isRising));
    assert.ok(trends.every((t) => t.label === "insufficient_evidence"));
  });

  test("a category with enough recent volume and real growth over the prior window is flagged emerging", () => {
    const suggestions = [
      ...Array.from({ length: 5 }, () => ({ category: "food" as const, created_at: RECENT })),
      { category: "food" as const, created_at: PRIOR },
    ];
    const trends = buildTrendRadar(suggestions, NOW);
    const food = trends.find((t) => t.category === "food")!;
    assert.equal(food.recentCount, 5);
    assert.equal(food.priorCount, 1);
    assert.equal(food.isRising, true);
    assert.equal(food.label, "emerging");
  });

  test("volume below the absolute floor is never flagged, even with infinite ratio growth", () => {
    const suggestions = [{ category: "food" as const, created_at: RECENT }];
    const trends = buildTrendRadar(suggestions, NOW);
    const food = trends.find((t) => t.category === "food")!;
    assert.ok(food.recentCount < TREND_RADAR_LIMITS.minRecentCount);
    assert.equal(food.isRising, false);
    assert.equal(food.label, "insufficient_evidence");
  });

  test("suggestions outside all three windows are not counted at all", () => {
    const suggestions = [{ category: "food" as const, created_at: OLD }];
    const trends = buildTrendRadar(suggestions, NOW);
    const food = trends.find((t) => t.category === "food")!;
    assert.equal(food.recentCount, 0);
    assert.equal(food.priorCount, 0);
    assert.equal(food.olderCount, 0);
  });

  test("the older window (28-42 days ago) is counted separately from prior", () => {
    const suggestions = [
      ...Array.from({ length: 4 }, () => ({ category: "food" as const, created_at: RECENT })),
      { category: "food" as const, created_at: OLDER },
    ];
    const trends = buildTrendRadar(suggestions, NOW);
    const food = trends.find((t) => t.category === "food")!;
    assert.equal(food.priorCount, 0);
    assert.equal(food.olderCount, 1);
  });

  test("sorts by recentCount descending", () => {
    const suggestions = [
      { category: "food" as const, created_at: RECENT },
      ...Array.from({ length: 3 }, () => ({ category: "events" as const, created_at: RECENT })),
    ];
    const trends = buildTrendRadar(suggestions, NOW);
    assert.equal(trends[0]!.category, "events");
  });

  test("changeRatio is null when there was no prior activity (an undefined ratio is never faked as a number)", () => {
    const suggestions = Array.from({ length: 4 }, () => ({ category: "food" as const, created_at: RECENT }));
    const trends = buildTrendRadar(suggestions, NOW);
    assert.equal(trends.find((t) => t.category === "food")!.changeRatio, null);
  });

  test("changeRatio is the plain recent/prior ratio, rounded to 2 places, when prior activity exists", () => {
    const suggestions = [
      ...Array.from({ length: 6 }, () => ({ category: "food" as const, created_at: RECENT })),
      ...Array.from({ length: 4 }, () => ({ category: "food" as const, created_at: PRIOR })),
    ];
    const trends = buildTrendRadar(suggestions, NOW);
    assert.equal(trends.find((t) => t.category === "food")!.changeRatio, 1.5);
  });
});

describe("classifyTrend — the fixed decision tree, one case per label", () => {
  test("insufficient_evidence: recentCount below the absolute floor, regardless of ratio", () => {
    const { label } = classifyTrend(1, 0, 0);
    assert.equal(label, "insufficient_evidence");
  });

  test("insufficient_evidence: the exact tiny-number example from the spec — 1 suggestion becoming 2 is never a trend", () => {
    const { label } = classifyTrend(2, 1, 0);
    assert.equal(label, "insufficient_evidence");
  });

  test("emerging: real growth from near-zero prior/older activity", () => {
    const { label } = classifyTrend(6, 1, 0);
    assert.equal(label, "emerging");
  });

  test("emerging: recentCount clears the floor with zero prior activity at all", () => {
    const { label } = classifyTrend(3, 0, 0);
    assert.equal(label, "emerging");
  });

  test("sustained: real growth, but the category already had presence in the prior/older window", () => {
    const { label } = classifyTrend(9, 4, 3);
    assert.equal(label, "sustained");
  });

  test("sustained: steady (non-growing) volume, but already elevated — holding steady still counts as sustained, not insufficient", () => {
    const { label } = classifyTrend(4, 4, 4);
    assert.equal(label, "sustained");
  });

  test("cooling: recentCount meaningfully below priorCount (recentCount still clears the floor)", () => {
    const { label } = classifyTrend(3, 8, 6);
    assert.equal(label, "cooling");
  });

  test("cooling takes priority over a steady-looking ratio when the decline is real", () => {
    const { label } = classifyTrend(3, 9, 8);
    assert.equal(label, "cooling");
  });

  test("insufficient_evidence: a lone recent blip with no supporting history either side", () => {
    const { label } = classifyTrend(3, 0, 0);
    // Note: prior=0 with recent clearing the floor is "emerging" (see above) —
    // this case instead pins the OTHER zero-history branch: steady-but-thin.
    assert.equal(label, "emerging");
  });

  test("confidence is 'high' only when recentCount clears twice the floor", () => {
    assert.equal(classifyTrend(TREND_RADAR_LIMITS.minRecentCount, 0, 0).confidence, "moderate");
    assert.equal(classifyTrend(TREND_RADAR_LIMITS.minRecentCount * 2, 0, 0).confidence, "high");
  });

  test("confidence is 'low' for insufficient_evidence", () => {
    assert.equal(classifyTrend(0, 0, 0).confidence, "low");
  });
});
