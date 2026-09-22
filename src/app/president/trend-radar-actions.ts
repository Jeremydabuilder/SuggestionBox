"use server";

import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildTrendRadar, type CategoryTrend, type TrendRadarSuggestion } from "@/lib/trend-radar";
import type { ActionResult } from "./actions";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const MAX_ROWS = 1000;

export interface TrendRadarResultData {
  trends: CategoryTrend[];
}

/** Deterministic category-frequency comparison — no Groq call, no theme guessing. */
export async function getTrendRadar(): Promise<ActionResult<TrendRadarResultData>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggestions")
    .select("category, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) return fail("Trends could not be checked. Try again in a moment.");

  const trends = buildTrendRadar((data ?? []) as TrendRadarSuggestion[], new Date());
  return { ok: true, data: { trends } };
}
