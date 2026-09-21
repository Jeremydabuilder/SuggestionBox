"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";
import {
  actionItemInputSchema,
  updateActionItemInputSchema,
  resolveSuggestionCitations,
  type ActionItem,
  type CitedSuggestion,
} from "@/lib/decisions-actions-store";
import type { Suggestion } from "@/lib/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * No owner, assignee, assigned_to, or responsibility field exists on this
 * row shape or anywhere else in this file, by explicit product requirement.
 * Action items are a shared list both co-presidents read and complete.
 */
interface ActionItemRow {
  id: string;
  action_text: string;
  deadline: string | null;
  completed: boolean;
  completed_at: string | null;
  meeting_id: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

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

async function loadCitationsForActions(
  supabase: SupabaseServerClient,
  actionIds: string[],
): Promise<Map<string, CitedSuggestion[]>> {
  const byAction = new Map<string, CitedSuggestion[]>();
  if (actionIds.length === 0) return byAction;

  const { data, error } = await supabase
    .from("meeting_action_citations")
    .select("action_id, suggestion_id")
    .in("action_id", actionIds);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ action_id: string; suggestion_id: string }>;
  const titles = await suggestionTitles(supabase, rows.map((r) => r.suggestion_id));

  for (const row of rows) {
    const suggestion = titles.get(row.suggestion_id);
    if (!suggestion) continue;
    const list = byAction.get(row.action_id) ?? [];
    list.push({ id: row.suggestion_id, title: suggestion.title, status: suggestion.status });
    byAction.set(row.action_id, list);
  }
  return byAction;
}

function mapActionRow(row: ActionItemRow, meetingHeadline: string | null, citations: CitedSuggestion[]): ActionItem {
  return {
    id: row.id,
    actionText: row.action_text,
    deadline: row.deadline,
    completed: row.completed,
    completedAt: row.completed_at,
    meetingId: row.meeting_id,
    meetingHeadline,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    citations,
  };
}

export async function createActionItem(rawInput: unknown): Promise<ActionResult<ActionItem>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const parsed = actionItemInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("That action couldn't be saved — check the text and try again.");
  const { actionText, deadline, meetingId, citedSuggestionIds } = parsed.data;

  const supabase = await createSupabaseServerClient();

  let resolvedIds: string[];
  try {
    resolvedIds = resolveSuggestionCitations(citedSuggestionIds, await existingSuggestionIds(supabase, citedSuggestionIds));
  } catch {
    return fail("The inbox could not be checked. Try again in a moment.");
  }

  const { data, error } = await supabase
    .from("meeting_actions")
    .insert({ action_text: actionText, deadline, meeting_id: meetingId })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[actions] insert failed:", error?.message);
    return fail("That action couldn't be saved. Try again in a moment.");
  }

  if (resolvedIds.length > 0) {
    const { error: citationError } = await supabase
      .from("meeting_action_citations")
      .insert(resolvedIds.map((suggestionId) => ({ action_id: data.id, suggestion_id: suggestionId })));
    if (citationError) {
      await supabase.from("meeting_actions").delete().eq("id", data.id);
      console.error("[actions] citation insert failed:", citationError.message);
      return fail("That action couldn't be saved. Try again in a moment.");
    }
  }

  let meetingHeadline: string | null = null;
  let citations: CitedSuggestion[] = [];
  try {
    if (meetingId) meetingHeadline = (await loadMeetingHeadlines(supabase, [meetingId])).get(meetingId) ?? null;
    citations = (await loadCitationsForActions(supabase, [data.id])).get(data.id) ?? [];
  } catch {
    // Non-fatal.
  }

  revalidatePath("/president");
  return { ok: true, data: mapActionRow(data as ActionItemRow, meetingHeadline, citations) };
}

export async function updateActionItem(rawInput: unknown): Promise<ActionResult<ActionItem>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const parsed = updateActionItemInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("That action couldn't be updated — check the text and try again.");
  const { id, actionText, deadline, meetingId, citedSuggestionIds } = parsed.data;

  const supabase = await createSupabaseServerClient();

  let resolvedIds: string[];
  try {
    resolvedIds = resolveSuggestionCitations(citedSuggestionIds, await existingSuggestionIds(supabase, citedSuggestionIds));
  } catch {
    return fail("The inbox could not be checked. Try again in a moment.");
  }

  const { data, error } = await supabase
    .from("meeting_actions")
    .update({ action_text: actionText, deadline, meeting_id: meetingId })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return fail("That action could not be found or updated.");

  const { error: deleteError } = await supabase.from("meeting_action_citations").delete().eq("action_id", id);
  if (deleteError) {
    console.error("[actions] citation replace (delete) failed:", deleteError.message);
    return fail("That action couldn't be updated. Try again in a moment.");
  }
  if (resolvedIds.length > 0) {
    const { error: citationError } = await supabase
      .from("meeting_action_citations")
      .insert(resolvedIds.map((suggestionId) => ({ action_id: id, suggestion_id: suggestionId })));
    if (citationError) {
      console.error("[actions] citation replace (insert) failed:", citationError.message);
      return fail("That action couldn't be updated. Try again in a moment.");
    }
  }

  let meetingHeadline: string | null = null;
  let citations: CitedSuggestion[] = [];
  try {
    if (meetingId) meetingHeadline = (await loadMeetingHeadlines(supabase, [meetingId])).get(meetingId) ?? null;
    citations = (await loadCitationsForActions(supabase, [id])).get(id) ?? [];
  } catch {
    // Non-fatal.
  }

  revalidatePath("/president");
  return { ok: true, data: mapActionRow(data as ActionItemRow, meetingHeadline, citations) };
}

/** completed_at is trigger-derived from `completed` in the database — this just flips the flag. */
export async function setActionItemCompleted(id: string, completed: boolean): Promise<ActionResult<{ completed: boolean }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(id)) return fail("Unknown action.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("meeting_actions")
    .update({ completed })
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) return fail("That action could not be updated. Try again in a moment.");

  revalidatePath("/president");
  return { ok: true, data: { completed } };
}

/** Deleting an action item cascades to its own citation rows only — never to a suggestion or a meeting brief. */
export async function deleteActionItem(id: string): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(id)) return fail("Unknown action.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("meeting_actions").delete().eq("id", id);
  if (error) return fail("That action could not be deleted. Try again in a moment.");

  revalidatePath("/president");
  return { ok: true };
}

export async function listActionItems(): Promise<ActionResult<ActionItem[]>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("meeting_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return fail("The action list could not be loaded. Try again in a moment.");

  const rows = (data ?? []) as ActionItemRow[];
  if (rows.length === 0) return { ok: true, data: [] };

  try {
    const meetingIds = rows.map((r) => r.meeting_id).filter((id): id is string => Boolean(id));
    const [headlines, citationsByAction] = await Promise.all([
      loadMeetingHeadlines(supabase, meetingIds),
      loadCitationsForActions(supabase, rows.map((r) => r.id)),
    ]);
    return {
      ok: true,
      data: rows.map((row) =>
        mapActionRow(row, row.meeting_id ? headlines.get(row.meeting_id) ?? null : null, citationsByAction.get(row.id) ?? []),
      ),
    };
  } catch {
    return fail("The action list could not be loaded. Try again in a moment.");
  }
}
