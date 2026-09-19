"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession, isAuthorizedEmail } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/sanitize";
import { noteSchema, fieldErrors, LIMITS } from "@/lib/validation";
import { STATUS_VALUES, type InternalNote, type Status, type StatusHistoryEntry } from "@/lib/types";
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
