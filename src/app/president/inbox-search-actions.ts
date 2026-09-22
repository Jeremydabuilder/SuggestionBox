"use server";

import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchInboxSuggestions, type InboxSearchHit, type SearchableSuggestion } from "@/lib/inbox-search";
import { CATEGORY_VALUES, STATUS_VALUES, type Category, type Status } from "@/lib/types";
import type { ActionResult } from "./actions";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const MAX_ROWS = 500;
const RESULT_LIMIT = 15;

export interface InboxSearchResultData {
  hits: InboxSearchHit[];
  totalMatches: number;
}

/**
 * Deterministic keyword/category/status search — no Groq call. Only
 * title/description/improvement_reason/category/status/created_at are
 * selected, matching SearchableSuggestion exactly: no student_name,
 * student_email, or any other field is read here at all, so nothing PII
 * can leak into a downstream Groq prompt through this path (see
 * chat-inbox-answer.ts, which reuses this same search for evidence).
 */
export async function searchInbox(rawQuery?: unknown, rawCategory?: unknown, rawStatus?: unknown): Promise<ActionResult<InboxSearchResultData>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const query = typeof rawQuery === "string" ? rawQuery.slice(0, 200) : undefined;
  const category =
    typeof rawCategory === "string" && (CATEGORY_VALUES as readonly string[]).includes(rawCategory)
      ? (rawCategory as Category)
      : undefined;
  const status =
    typeof rawStatus === "string" && (STATUS_VALUES as readonly string[]).includes(rawStatus) ? (rawStatus as Status) : undefined;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggestions")
    .select("id, title, description, improvement_reason, category, status, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) return fail("The inbox could not be searched. Try again in a moment.");

  const result = searchInboxSuggestions((data ?? []) as SearchableSuggestion[], { query, category, status }, RESULT_LIMIT);
  return { ok: true, data: { hits: result.hits, totalMatches: result.totalMatches } };
}
