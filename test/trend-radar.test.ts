import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildTrendRadar, TREND_RADAR_LIMITS } from "../src/lib/trend-radar.ts";
import { CATEGORY_VALUES } from "../src/lib/types.ts";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const RECENT = "2026-09-15T00:00:00.000Z"; // within the last 14 days
const PRIOR = "2026-08-26T00:00:00.000Z"; // 14-28 days ago
const OLD = "2026-06-01T00:00:00.000Z"; // outside both windows

describe("buildTrendRadar", () => {
  test("returns one entry per known category, even with zero suggestions", () => {
    const trends = buildTrendRadar([], NOW);
    assert.equal(trends.length, CATEGORY_VALUES.length);
    assert.ok(trends.every((t) => t.recentCount === 0 && t.priorCount === 0 && !t.isRising));
  });

  test("a category with enough recent volume and real growth over the prior window is flagged rising", () => {
    const suggestions = [
      ...Array.from({ length: 5 }, () => ({ category: "food" as const, created_at: RECENT })),
      { category: "food" as const, created_at: PRIOR },
    ];
    const trends = buildTrendRadar(suggestions, NOW);
    const food = trends.find((t) => t.category === "food")!;
    assert.equal(food.recentCount, 5);
    assert.equal(food.priorCount, 1);
    assert.equal(food.isRising, true);
  });

  test("volume below the absolute floor is never flagged, even with infinite ratio growth", () => {
    const suggestions = [{ category: "food" as const, created_at: RECENT }];
    const trends = buildTrendRadar(suggestions, NOW);
    const food = trends.find((t) => t.category === "food")!;
    assert.ok(food.recentCount < TREND_RADAR_LIMITS.minRecentCount);
    assert.equal(food.isRising, false);
  });

  test("steady (non-growing) volume is never flagged as rising", () => {
    const suggestions = [
      ...Array.from({ length: 4 }, () => ({ category: "food" as const, created_at: RECENT })),
      ...Array.from({ length: 4 }, () => ({ category: "food" as const, created_at: PRIOR })),
    ];
    const trends = buildTrendRadar(suggestions, NOW);
    const food = trends.find((t) => t.category === "food")!;
    assert.equal(food.isRising, false);
  });

  test("suggestions outside both windows are not counted at all", () => {
    const suggestions = [{ category: "food" as const, created_at: OLD }];
    const trends = buildTrendRadar(suggestions, NOW);
    const food = trends.find((t) => t.category === "food")!;
    assert.equal(food.recentCount, 0);
    assert.equal(food.priorCount, 0);
  });

  test("sorts by recentCount descending", () => {
    const suggestions = [
      { category: "food" as const, created_at: RECENT },
      ...Array.from({ length: 3 }, () => ({ category: "events" as const, created_at: RECENT })),
    ];
    const trends = buildTrendRadar(suggestions, NOW);
    assert.equal(trends[0]!.category, "events");
  });
});
