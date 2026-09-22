"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/sanitize";
import { confirmationPhraseFor } from "@/lib/trash";
import type { ActionResult } from "./actions";
import type { TrashedSuggestion } from "@/lib/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const TRASH_REASON_MAX = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything here is a thin, session-checked wrapper around the
 * SECURITY DEFINER functions in the trash migration — those functions do
 * the actual authorization (is_president()) and state checks again
 * themselves, so this file never trusts anything about the caller beyond
 * "a president session cookie is present." No table is written to or read
 * from directly for a trash mutation; everything goes through
 * supabase.rpc(...).
 */

export interface DeletionDependencyPreview {
  noteCount: number;
  historyCount: number;
  matchCount: number;
  citationCount: number;
  messageCount: number;
}

export async function listTrash(): Promise<ActionResult<TrashedSuggestion[]>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_trashed_suggestions");
  if (error) return fail("Trash could not be loaded. Try again in a moment.");

  return { ok: true, data: (data ?? []) as TrashedSuggestion[] };
}

export async function moveToTrash(rawId: unknown, rawReason: unknown): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const id = typeof rawId === "string" ? rawId : "";
  if (!UUID_RE.test(id)) return fail("That suggestion could not be found.");

  const reason = typeof rawReason === "string" ? sanitizeText(rawReason, TRASH_REASON_MAX) : "";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("trash_suggestion", {
    p_suggestion_id: id,
    p_reason: reason.length > 0 ? reason : null,
  });
  if (error) return fail(error.message);

  revalidatePath("/president");
  return { ok: true };
}

export async function restoreFromTrash(rawId: unknown): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const id = typeof rawId === "string" ? rawId : "";
  if (!UUID_RE.test(id)) return fail("That suggestion could not be found.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("restore_suggestion", { p_suggestion_id: id });
  if (error) return fail(error.message);

  revalidatePath("/president");
  return { ok: true };
}

/**
 * Read-only counts of what permanently deleting this suggestion would take
 * with it, shown before a president can even reach the confirmation step.
 * Every table here is one the signed-in president already has ordinary
 * SELECT access to (see the citation/notes/history/match RLS policies) —
 * nothing new is opened up to compute this.
 */
export async function getDeletionDependencyPreview(rawId: unknown): Promise<ActionResult<DeletionDependencyPreview>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const id = typeof rawId === "string" ? rawId : "";
  if (!UUID_RE.test(id)) return fail("That suggestion could not be found.");

  const supabase = await createSupabaseServerClient();
  const [notes, history, matchesAsSubject, matchesAsMatch, briefCitations, decisionCitations, actionCitations, messageCountRes] = await Promise.all([
    supabase.from("internal_notes").select("id", { count: "exact", head: true }).eq("suggestion_id", id),
    supabase.from("status_history").select("id", { count: "exact", head: true }).eq("suggestion_id", id),
    supabase.from("suggestion_matches").select("id", { count: "exact", head: true }).eq("suggestion_id", id),
    supabase.from("suggestion_matches").select("id", { count: "exact", head: true }).eq("match_id", id),
    supabase.from("meeting_brief_citations").select("brief_id", { count: "exact", head: true }).eq("suggestion_id", id),
    supabase.from("meeting_decision_citations").select("decision_id", { count: "exact", head: true }).eq("suggestion_id", id),
    supabase.from("meeting_action_citations").select("action_id", { count: "exact", head: true }).eq("suggestion_id", id),
    // suggestion_messages has no SELECT grant at all (see the migration's
    // own doc comment) — its count can only come from this function.
    supabase.rpc("count_conversation_messages", { p_suggestion_id: id }),
  ]);

  const results = [notes, history, matchesAsSubject, matchesAsMatch, briefCitations, decisionCitations, actionCitations, messageCountRes];
  if (results.some((r) => r.error)) return fail("Those details could not be checked. Try again in a moment.");

  return {
    ok: true,
    data: {
      noteCount: notes.count ?? 0,
      historyCount: history.count ?? 0,
      matchCount: (matchesAsSubject.count ?? 0) + (matchesAsMatch.count ?? 0),
      citationCount: (briefCitations.count ?? 0) + (decisionCitations.count ?? 0) + (actionCitations.count ?? 0),
      messageCount: (messageCountRes.data as number | null) ?? 0,
    },
  };
}

/**
 * Step 1 of permanent deletion. The caller must already have typed the
 * exact confirmation phrase for this suggestion — DELETE followed by the
 * first 8 characters of its id, uppercased — which this re-checks
 * server-side rather than trusting the client's own validation. Only once
 * that matches does it ask the database for a short-lived, single-use
 * token; the database re-verifies the suggestion is actually in Trash
 * before issuing one.
 */
export async function requestPermanentDeletion(
  rawId: unknown,
  rawTypedPhrase: unknown,
): Promise<ActionResult<{ token: string; expiresAt: string }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const id = typeof rawId === "string" ? rawId : "";
  if (!UUID_RE.test(id)) return fail("That suggestion could not be found.");

  const typedPhrase = typeof rawTypedPhrase === "string" ? rawTypedPhrase.trim() : "";
  const expectedPhrase = confirmationPhraseFor(id);
  if (typedPhrase !== expectedPhrase) {
    return fail(`Type "${expectedPhrase}" exactly to continue.`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("request_suggestion_deletion", { p_suggestion_id: id }).single();
  if (error || !data) return fail(error?.message ?? "That confirmation could not be created. Try again.");

  const row = data as { token: string; expires_at: string };
  return { ok: true, data: { token: row.token, expiresAt: row.expires_at } };
}

/**
 * Step 2: the second, explicit confirmation click. Consumes the one-time
 * token from step 1 — the database rejects an unknown, already-used, or
 * expired token, and re-checks the suggestion is still in Trash before
 * doing anything irreversible.
 */
export async function confirmPermanentDeletion(rawToken: unknown): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const token = typeof rawToken === "string" ? rawToken : "";
  if (token.length === 0) return fail("That confirmation is invalid. Request a new one.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("confirm_suggestion_deletion", { p_token: token });
  if (error) return fail(error.message);

  revalidatePath("/president");
  return { ok: true };
}
