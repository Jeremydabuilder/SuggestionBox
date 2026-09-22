import { CATEGORY_VALUES, type Category } from "./types.ts";

/**
 * Pure, deterministic category-frequency trend detection — no Groq call,
 * no embeddings, no theme guessing, no AI "certainty" score. Three
 * comparable time windows (recent / prior / older) feed a fixed decision
 * tree that only ever produces one of four honest labels. Every label
 * ships with the exact counts and windows that produced it — "why it was
 * flagged" is always the same few numbers a president can re-check by
 * hand, never a black box.
 */

export const TREND_RADAR_LIMITS = {
  windowDays: 14,
  /** Absolute floor a category's recent count must clear before it is
   *  evaluated at all — this alone is what stops "one suggestion became
   *  two" from ever being called a trend, regardless of ratio. */
  minRecentCount: 3,
  minGrowthRatio: 1.5,
  /** recent <= prior * this ratio counts as a real decline, not noise. */
  coolingRatio: 0.67,
} as const;

export const TREND_LABELS = ["emerging", "sustained", "cooling", "insufficient_evidence"] as const;
export type TrendLabel = (typeof TREND_LABELS)[number];

export const TREND_LABEL_TEXT: Record<TrendLabel, string> = {
  emerging: "Emerging",
  sustained: "Sustained",
  cooling: "Cooling",
  insufficient_evidence: "Insufficient evidence",
};

export type TrendConfidence = "low" | "moderate" | "high";

export interface TrendRadarSuggestion {
  category: Category;
  created_at: string;
}

export interface CategoryTrend {
  category: Category;
  recentCount: number;
  priorCount: number;
  olderCount: number;
  /** recentCount / priorCount, rounded to 2 places — null when priorCount is 0 (an undefined ratio is not a number, never faked as one). */
  changeRatio: number | null;
  label: TrendLabel;
  /** Evidence quality, not model certainty — see classifyTrend's own doc comment for exactly what sets each level. */
  confidence: TrendConfidence;
  /** Convenience flag = label is "emerging" or "sustained". Kept for callers that only need a yes/no signal. */
  isRising: boolean;
}

/**
 * The fixed decision tree behind every label:
 *
 * 1. recentCount below the absolute floor -> "insufficient_evidence",
 *    always, regardless of how dramatic the ratio looks. This is the one
 *    rule that exists specifically so "1 suggestion became 2" can never
 *    be presented as a trend.
 * 2. recentCount meaningfully below priorCount (<= priorCount *
 *    coolingRatio) -> "cooling".
 * 3. recentCount grew at least minGrowthRatio over priorCount, OR there
 *    was no prior activity at all (priorCount === 0) -> either
 *    "sustained" (if the category already had real presence in the
 *    prior or older window) or "emerging" (if it came from near zero).
 * 4. Otherwise recentCount is roughly steady versus priorCount — still
 *    "sustained" if the category already had presence, or
 *    "insufficient_evidence" if it's a one-window blip with no
 *    supporting history either side.
 *
 * Confidence is "high" only when recentCount clears twice the floor —
 * more raw evidence, not a stronger model opinion (there is no model
 * here at all).
 */
export function classifyTrend(recentCount: number, priorCount: number, olderCount: number): { label: TrendLabel; confidence: TrendConfidence } {
  const { minRecentCount, minGrowthRatio, coolingRatio } = TREND_RADAR_LIMITS;

  if (recentCount < minRecentCount) return { label: "insufficient_evidence", confidence: "low" };

  const confidence: TrendConfidence = recentCount >= minRecentCount * 2 ? "high" : "moderate";
  const hadPriorPresence = priorCount >= minRecentCount || olderCount >= minRecentCount;

  if (priorCount > 0 && recentCount <= priorCount * coolingRatio) {
    return { label: "cooling", confidence };
  }

  const grew = priorCount === 0 || recentCount >= priorCount * minGrowthRatio;
  if (grew) {
    return { label: hadPriorPresence ? "sustained" : "emerging", confidence };
  }

  return hadPriorPresence ? { label: "sustained", confidence } : { label: "insufficient_evidence", confidence: "low" };
}

export function buildTrendRadar(suggestions: TrendRadarSuggestion[], now: Date): CategoryTrend[] {
  const windowMs = TREND_RADAR_LIMITS.windowDays * 24 * 60 * 60 * 1000;
  const recentCutoff = now.getTime() - windowMs;
  const priorCutoff = recentCutoff - windowMs;
  const olderCutoff = priorCutoff - windowMs;

  const counts = new Map<Category, { recent: number; prior: number; older: number }>();
  for (const category of CATEGORY_VALUES) counts.set(category, { recent: 0, prior: 0, older: 0 });

  for (const suggestion of suggestions) {
    const bucket = counts.get(suggestion.category);
    if (!bucket) continue;
    const t = new Date(suggestion.created_at).getTime();
    if (t >= recentCutoff) bucket.recent += 1;
    else if (t >= priorCutoff) bucket.prior += 1;
    else if (t >= olderCutoff) bucket.older += 1;
  }

  return [...counts.entries()]
    .map(([category, { recent, prior, older }]) => {
      const { label, confidence } = classifyTrend(recent, prior, older);
      return {
        category,
        recentCount: recent,
        priorCount: prior,
        olderCount: older,
        changeRatio: prior > 0 ? Math.round((recent / prior) * 100) / 100 : null,
        label,
        confidence,
        isRising: label === "emerging" || label === "sustained",
      };
    })
    .sort((a, b) => b.recentCount - a.recentCount);
}
