/**
 * Same shape as the per-email `Map<string, number>` cooldown already used
 * for the weekly meeting agent (see prepareWeeklyMeeting in actions.ts),
 * generalized to a sliding window with a max count. In-memory only — this
 * resets on redeploy and does not share state across multiple server
 * instances, the same limitation the existing per-email cooldown already
 * has. Good enough for a two-president school tool; not a substitute for a
 * real distributed limiter if this app ever needs one.
 *
 * No `server-only` import here, deliberately: this file holds no secrets
 * and no I/O, only in-memory bucket arithmetic — the same reasoning
 * lib/groq.ts already uses to keep its pure functions (rankGroqModels)
 * directly unit-testable. It is still only ever called from server action
 * files in practice.
 */
const buckets = new Map<string, number[]>();

export interface RateLimitOutcome {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkChatRateLimit(key: string, max: number, windowMs: number): RateLimitOutcome {
  const now = Date.now();
  const existing = buckets.get(key) ?? [];
  const withinWindow = existing.filter((t) => now - t < windowMs);

  if (withinWindow.length >= max) {
    const oldest = withinWindow[0]!;
    buckets.set(key, withinWindow);
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - now) / 1000) };
  }

  withinWindow.push(now);
  buckets.set(key, withinWindow);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test-only: clear all buckets so tests don't leak state into each other. */
export function _resetChatRateLimitsForTests(): void {
  buckets.clear();
}
