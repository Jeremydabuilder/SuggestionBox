"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession, isAuthorizedEmail } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/sanitize";
import { noteSchema, fieldErrors, LIMITS } from "@/lib/validation";
import {
  STATUS_VALUES,
  type InternalNote,
  type Status,
  type StatusHistoryEntry,
} from "@/lib/types";
import { rescanAllDuplicates } from "@/lib/duplicates/service";
import { serverEnv } from "@/lib/env";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/* ------------------------------------------------------------------ */
/* Sign in — a magic link, and only ever to an approved co-president.  */
/* ------------------------------------------------------------------ */

export async function requestMagicLink(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, LIMITS.email);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  // Unauthorized addresses get the same answer as authorized ones, so the
  // panel never reveals who the co-presidents are. No link is sent.
  const authorized = await isAuthorizedEmail(email);
  const genericReply = {
    ok: true,
    message: "If that address is approved, a sign-in link is on its way. Check your inbox.",
  };
  if (!authorized) return genericReply;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${serverEnv.siteUrl}/auth/callback?next=/president`,
    },
  });

  if (error) {
    console.error("[auth] magic link failed:", error.message);
    return { ok: false, message: "We couldn't send the link just now. Try again in a moment." };
  }
  return genericReply;
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/president");
}

/* ------------------------------------------------------------------ */
/* Panel actions — every one re-checks the session on the server.      */
/* ------------------------------------------------------------------ */

export async function markRead(id: string, read: boolean): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("suggestions")
    .update({ is_read: read, read_at: read ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) return fail(error.message);
  revalidatePath("/president");
  return { ok: true };
}

export async function setStatus(id: string, status: Status): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!STATUS_VALUES.includes(status)) return fail("Unknown status.");

  const supabase = await createSupabaseServerClient();
  // Acting on a suggestion counts as having read it.
  const patch: Record<string, unknown> = { status, is_read: true };
  const { error } = await supabase.from("suggestions").update(patch).eq("id", id);

  if (error) return fail(error.message);
  revalidatePath("/president");
  return { ok: true };
}

export async function addNote(
  suggestionId: string,
  body: string,
): Promise<ActionResult<InternalNote>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const parsed = noteSchema.safeParse({
    suggestionId,
    body: sanitizeText(body, LIMITS.note),
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return fail(errors.body ?? errors.suggestionId ?? "That note couldn't be saved.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("internal_notes")
    .insert({
      suggestion_id: parsed.data.suggestionId,
      author_email: session.email,
      body: parsed.data.body,
    })
    .select("*")
    .single();

  if (error || !data) return fail(error?.message ?? "That note couldn't be saved.");
  revalidatePath("/president");
  return { ok: true, data: data as InternalNote };
}

export async function deleteNote(noteId: string): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  // RLS additionally restricts this to the note's own author.
  const { error } = await supabase.from("internal_notes").delete().eq("id", noteId);
  if (error) return fail(error.message);
  revalidatePath("/president");
  return { ok: true };
}

export interface SuggestionDetailData {
  notes: InternalNote[];
  history: StatusHistoryEntry[];
}

/* ------------------------------------------------------------------ */
/* Possible duplicates                                                 */
/* ------------------------------------------------------------------ */
/*
 * Every action here records a decision about a RELATIONSHIP. None of them
 * deletes, archives, merges or rejects a suggestion: both submissions, and
 * whatever the students put their names to, stay exactly as they arrived.
 */

async function decideMatch(
  matchId: string,
  state: "confirmed" | "dismissed",
): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("suggestion_matches")
    .update({ state, decided_by: session.email, decided_at: new Date().toISOString() })
    .eq("id", matchId);

  if (error) return fail(error.message);
  revalidatePath("/president");
  return { ok: true };
}

/** "Yes, these two are the same idea." Both suggestions are left intact. */
export async function confirmMatch(matchId: string): Promise<ActionResult> {
  return decideMatch(matchId, "confirmed");
}

/**
 * "No, these are different." The row is kept rather than deleted, so the
 * detector knows not to raise the same pair again on the next scan.
 */
export async function dismissMatch(matchId: string): Promise<ActionResult> {
  return decideMatch(matchId, "dismissed");
}

/**
 * Undo a dismissal. The pair goes back to being a suggested match.
 *
 * Nothing is erased: decided_by and decided_at still say who dismissed it
 * and when, and the reversal is recorded beside them with the president who
 * made it and the time. The whole decision trail stays readable.
 */
export async function restoreMatch(matchId: string): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggestion_matches")
    .update({
      state: "suggested",
      reopened_by: session.email,
      reopened_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .eq("state", "dismissed")
    .select("id");

  if (error) return fail(error.message);
  if (!data || data.length === 0) return fail("That match is no longer dismissed.");

  revalidatePath("/president");
  return { ok: true };
}

/**
 * File one suggestion under another as the idea the presidents are
 * tracking. Pass null for primaryId to unlink.
 *
 * This only sets a pointer. The duplicate keeps its own text, status,
 * history, notes and submitter details, and still appears in the inbox.
 */
export async function setPrimarySuggestion(
  suggestionId: string,
  primaryId: string | null,
): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (primaryId === suggestionId) return fail("A suggestion cannot be filed under itself.");

  const supabase = await createSupabaseServerClient();

  let target = primaryId;
  if (target) {
    // Keep groups one level deep: if the chosen suggestion is itself filed
    // under another, file this one under that same one.
    const { data: chosen, error: chosenError } = await supabase
      .from("suggestions")
      .select("id, primary_suggestion_id")
      .eq("id", target)
      .single();
    if (chosenError || !chosen) return fail(chosenError?.message ?? "That suggestion is gone.");
    if (chosen.primary_suggestion_id && chosen.primary_suggestion_id !== suggestionId) {
      target = chosen.primary_suggestion_id as string;
    }
    if (target === suggestionId) return fail("A suggestion cannot be filed under itself.");

    // Anything already filed under THIS suggestion moves with it, so no
    // group is ever orphaned by the change.
    const { error: reparentError } = await supabase
      .from("suggestions")
      .update({ primary_suggestion_id: target })
      .eq("primary_suggestion_id", suggestionId);
    if (reparentError) return fail(reparentError.message);
  }

  const { error } = await supabase
    .from("suggestions")
    .update({ primary_suggestion_id: target })
    .eq("id", suggestionId);

  if (error) return fail(error.message);
  revalidatePath("/president");
  return { ok: true };
}

/**
 * Re-run detection across the active suggestions. Needed for suggestions
 * that predate the feature. Confirmed and dismissed pairs are untouched.
 */
export async function rescanDuplicates(): Promise<ActionResult<{ recorded: number }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  try {
    const result = await rescanAllDuplicates();
    revalidatePath("/president");
    return { ok: true, data: { recorded: result.recorded } };
  } catch (error) {
    console.error("[duplicates] rescan failed:", error);
    return fail("The scan couldn't finish. Try again in a moment.");
  }
}

export async function loadDetail(
  suggestionId: string,
): Promise<ActionResult<SuggestionDetailData>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const [notesResult, historyResult] = await Promise.all([
    supabase
      .from("internal_notes")
      .select("*")
      .eq("suggestion_id", suggestionId)
      .order("created_at", { ascending: true }),
    supabase
      .from("status_history")
      .select("*")
      .eq("suggestion_id", suggestionId)
      .order("created_at", { ascending: false }),
  ]);

  if (notesResult.error) return fail(notesResult.error.message);
  if (historyResult.error) return fail(historyResult.error.message);

  return {
    ok: true,
    data: {
      notes: (notesResult.data ?? []) as InternalNote[],
      history: (historyResult.data ?? []) as StatusHistoryEntry[],
    },
  };
}
