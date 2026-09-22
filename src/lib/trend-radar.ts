import { CATEGORY_VALUES, type Category } from "./types.ts";

/**
 * Pure, deterministic category-frequency trend detection — no Groq call,
 * no embeddings, no theme guessing. A category "rises" only when its
 * recent-window count clears both an absolute floor and a growth ratio
 * over the prior window; a quiet inbox never gets a fabricated trend.
 */

export const TREND_RADAR_LIMITS = {
  windowDays: 14,
  minRecentCount: 3,
  minGrowthRatio: 1.5,
} as const;

export interface TrendRadarSuggestion {
  category: Category;
  created_at: string;
}

export interface CategoryTrend {
  category: Category;
  recentCount: number;
  priorCount: number;
  isRising: boolean;
}

export function buildTrendRadar(suggestions: TrendRadarSuggestion[], now: Date): CategoryTrend[] {
  const windowMs = TREND_RADAR_LIMITS.windowDays * 24 * 60 * 60 * 1000;
  const recentCutoff = now.getTime() - windowMs;
  const priorCutoff = recentCutoff - windowMs;

  const counts = new Map<Category, { recent: number; prior: number }>();
  for (const category of CATEGORY_VALUES) counts.set(category, { recent: 0, prior: 0 });

  for (const suggestion of suggestions) {
    const bucket = counts.get(suggestion.category);
    if (!bucket) continue;
    const t = new Date(suggestion.created_at).getTime();
    if (t >= recentCutoff) bucket.recent += 1;
    else if (t >= priorCutoff) bucket.prior += 1;
  }

  return [...counts.entries()]
    .map(([category, { recent, prior }]) => ({
      category,
      recentCount: recent,
      priorCount: prior,
      isRising: recent >= TREND_RADAR_LIMITS.minRecentCount && recent > prior && recent >= prior * TREND_RADAR_LIMITS.minGrowthRatio,
    }))
    .sort((a, b) => b.recentCount - a.recentCount);
}
