"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";
import {
  decisionInputSchema,
  updateDecisionInputSchema,
  resolveSuggestionCitations,
  type CitedSuggestion,
  type Decision,
} from "@/lib/decisions-actions-store";
import type { Suggestion } from "@/lib/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface DecisionRow {
  id: string;
  decision_text: string;
  meeting_id: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

/** Fresh, RLS-scoped: which of these ids are real suggestions this president can see. */
async function existingSuggestionIds(supabase: SupabaseServerClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase.from("suggestions").select("id").in("id", [...new Set(ids)]);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row: { id: string }) => row.id));
}

async function suggestionTitles(
  supabase: SupabaseServerClient,
  ids: string[],
): Promise<Map<string, { title: string; status: Suggestion["status"] }>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("suggestions").select("id, title, status").in("id", [...new Set(ids)]);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row: { id: string; title: string; status: Suggestion["status"] }) => [row.id, { title: row.title, status: row.status }]));
}

async function loadMeetingHeadlines(supabase: SupabaseServerClient, meetingIds: string[]): Promise<Map<string, string>> {
  if (meetingIds.length === 0) return new Map();
  const { data, error } = await supabase.from("meeting_briefs").select("id, headline").in("id", [...new Set(meetingIds)]);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row: { id: string; headline: string }) => [row.id, row.headline]));
}

async function loadCitationsForDecisions(
  supabase: SupabaseServerClient,
  decisionIds: string[],
): Promise<Map<string, CitedSuggestion[]>> {
  const byDecision = new Map<string, CitedSuggestion[]>();
  if (decisionIds.length === 0) return byDecision;

  const { data, error } = await supabase
    .from("meeting_decision_citations")
    .select("decision_id, suggestion_id")
    .in("decision_id", decisionIds);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ decision_id: string; suggestion_id: string }>;
  const titles = await suggestionTitles(supabase, rows.map((r) => r.suggestion_id));

  for (const row of rows) {
    const suggestion = titles.get(row.suggestion_id);
    if (!suggestion) continue; // Deleted since — skip rather than show a broken chip.
    const list = byDecision.get(row.decision_id) ?? [];
    list.push({ id: row.suggestion_id, title: suggestion.title, status: suggestion.status });
    byDecision.set(row.decision_id, list);
  }
  return byDecision;
}

function mapDecisionRow(row: DecisionRow, meetingHeadline: string | null, citations: CitedSuggestion[]): Decision {
  return {
    id: row.id,
    decisionText: row.decision_text,
    meetingId: row.meeting_id,
    meetingHeadline,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    citations,
  };
}

export async function createDecision(rawInput: unknown): Promise<ActionResult<Decision>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const parsed = decisionInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("That decision couldn't be saved — check the text and try again.");
  const { decisionText, meetingId, citedSuggestionIds } = parsed.data;

  const supabase = await createSupabaseServerClient();

  let resolvedIds: string[];
  try {
    resolvedIds = resolveSuggestionCitations(citedSuggestionIds, await existingSuggestionIds(supabase, citedSuggestionIds));
  } catch {
    return fail("The inbox could not be checked. Try again in a moment.");
  }

  const { data, error } = await supabase
    .from("meeting_decisions")
    .insert({ decision_text: decisionText, meeting_id: meetingId })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[decisions] insert failed:", error?.message);
    return fail("That decision couldn't be saved. Try again in a moment.");
  }

  if (resolvedIds.length > 0) {
    const { error: citationError } = await supabase
      .from("meeting_decision_citations")
      .insert(resolvedIds.map((suggestionId) => ({ decision_id: data.id, suggestion_id: suggestionId })));
    if (citationError) {
      await supabase.from("meeting_decisions").delete().eq("id", data.id);
      console.error("[decisions] citation insert failed:", citationError.message);
      return fail("That decision couldn't be saved. Try again in a moment.");
    }
  }

  let meetingHeadline: string | null = null;
  let citations: CitedSuggestion[] = [];
  try {
    if (meetingId) meetingHeadline = (await loadMeetingHeadlines(supabase, [meetingId])).get(meetingId) ?? null;
    citations = (await loadCitationsForDecisions(supabase, [data.id])).get(data.id) ?? [];
  } catch {
    // Non-fatal — the decision itself saved correctly.
  }

  revalidatePath("/president");
  return { ok: true, data: mapDecisionRow(data as DecisionRow, meetingHeadline, citations) };
}

export async function updateDecision(rawInput: unknown): Promise<ActionResult<Decision>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const parsed = updateDecisionInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("That decision couldn't be updated — check the text and try again.");
  const { id, decisionText, meetingId, citedSuggestionIds } = parsed.data;

  const supabase = await createSupabaseServerClient();

  let resolvedIds: string[];
  try {
    resolvedIds = resolveSuggestionCitations(citedSuggestionIds, await existingSuggestionIds(supabase, citedSuggestionIds));
  } catch {
    return fail("The inbox could not be checked. Try again in a moment.");
  }

  const { data, error } = await supabase
    .from("meeting_decisions")
    .update({ decision_text: decisionText, meeting_id: meetingId })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return fail("That decision could not be found or updated.");

  const { error: deleteError } = await supabase.from("meeting_decision_citations").delete().eq("decision_id", id);
  if (deleteError) {
    console.error("[decisions] citation replace (delete) failed:", deleteError.message);
    return fail("That decision couldn't be updated. Try again in a moment.");
  }
  if (resolvedIds.length > 0) {
    const { error: citationError } = await supabase
      .from("meeting_decision_citations")
      .insert(resolvedIds.map((suggestionId) => ({ decision_id: id, suggestion_id: suggestionId })));
    if (citationError) {
      console.error("[decisions] citation replace (insert) failed:", citationError.message);
      return fail("That decision couldn't be updated. Try again in a moment.");
    }
  }

  let meetingHeadline: string | null = null;
  let citations: CitedSuggestion[] = [];
  try {
    if (meetingId) meetingHeadline = (await loadMeetingHeadlines(supabase, [meetingId])).get(meetingId) ?? null;
    citations = (await loadCitationsForDecisions(supabase, [id])).get(id) ?? [];
  } catch {
    // Non-fatal.
  }

  revalidatePath("/president");
  return { ok: true, data: mapDecisionRow(data as DecisionRow, meetingHeadline, citations) };
}

/** Deleting a decision cascades to its own citation rows only — never to a suggestion or a meeting brief. */
export async function deleteDecision(id: string): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(id)) return fail("Unknown decision.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("meeting_decisions").delete().eq("id", id);
  if (error) return fail("That decision could not be deleted. Try again in a moment.");

  revalidatePath("/president");
  return { ok: true };
}

export async function listDecisions(): Promise<ActionResult<Decision[]>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("meeting_decisions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return fail("The decision log could not be loaded. Try again in a moment.");

  const rows = (data ?? []) as DecisionRow[];
  if (rows.length === 0) return { ok: true, data: [] };

  try {
    const meetingIds = rows.map((r) => r.meeting_id).filter((id): id is string => Boolean(id));
    const [headlines, citationsByDecision] = await Promise.all([
      loadMeetingHeadlines(supabase, meetingIds),
      loadCitationsForDecisions(supabase, rows.map((r) => r.id)),
    ]);
    return {
      ok: true,
      data: rows.map((row) =>
        mapDecisionRow(row, row.meeting_id ? headlines.get(row.meeting_id) ?? null : null, citationsByDecision.get(row.id) ?? []),
      ),
    };
  } catch {
    return fail("The decision log could not be loaded. Try again in a moment.");
  }
}
