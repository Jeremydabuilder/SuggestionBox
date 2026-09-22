"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/sanitize";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import type { ConversationState, ConversationSummary, PresidentConversationMessage } from "@/lib/types";
import type { ActionResult } from "./actions";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const MESSAGE_MAX_LENGTH = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * President-side conversation actions. Same shape as trash-actions.ts:
 * a session check, then a thin call into the migration's own SECURITY
 * DEFINER functions or an ordinary RLS-scoped select — never a raw
 * write to suggestion_conversations or suggestion_messages.
 */

export interface PresidentConversationData {
  state: ConversationState;
  messages: PresidentConversationMessage[];
}

export async function getConversation(rawSuggestionId: unknown): Promise<ActionResult<PresidentConversationData>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const supabase = await createSupabaseServerClient();
  const [messagesRes, conversationRes] = await Promise.all([
    supabase.rpc("list_president_conversation_messages", { p_suggestion_id: suggestionId }),
    supabase.from("suggestion_conversations").select("state").eq("suggestion_id", suggestionId).maybeSingle(),
  ]);

  if (messagesRes.error) return fail("The conversation could not be loaded. Try again in a moment.");

  const rows = (messagesRes.data ?? []) as Array<{
    id: string;
    sender_role: "student" | "president";
    sender_email: string;
    body: string;
    created_at: string;
  }>;

  return {
    ok: true,
    data: {
      state: (conversationRes.data?.state as ConversationState | undefined) ?? "open",
      messages: rows.map((r) => ({ id: r.id, senderRole: r.sender_role, senderEmail: r.sender_email, body: r.body, createdAt: r.created_at })),
    },
  };
}

export async function sendPresidentMessage(rawSuggestionId: unknown, rawBody: unknown): Promise<ActionResult<PresidentConversationMessage>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const body = typeof rawBody === "string" ? sanitizeText(rawBody, MESSAGE_MAX_LENGTH) : "";
  if (body.length === 0) return fail("Write a reply before sending.");

  const limit = checkChatRateLimit(`conversation:send:president:${session.email}`, 30, 5 * 60_000);
  if (!limit.allowed) return fail("You're sending messages quickly — wait a moment and try again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("send_suggestion_message", { p_suggestion_id: suggestionId, p_body: body }).single();
  if (error || !data) return fail(error?.message ?? "That reply could not be sent. Try again in a moment.");

  const row = data as { id: string; sender_role: "student" | "president"; sender_email: string; body: string; created_at: string };
  revalidatePath("/president");
  return { ok: true, data: { id: row.id, senderRole: row.sender_role, senderEmail: row.sender_email, body: row.body, createdAt: row.created_at } };
}

export async function resolveConversation(rawSuggestionId: unknown): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("resolve_suggestion_conversation", { p_suggestion_id: suggestionId });
  if (error) return fail(error.message);
  revalidatePath("/president");
  return { ok: true };
}

export async function reopenConversation(rawSuggestionId: unknown): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_suggestion_conversation", { p_suggestion_id: suggestionId });
  if (error) return fail(error.message);
  revalidatePath("/president");
  return { ok: true };
}

export async function markConversationReadByPresident(rawSuggestionId: unknown): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_conversation_read_by_president", { p_suggestion_id: suggestionId });
  if (error) return fail(error.message);
  return { ok: true };
}

/**
 * Inbox-wide summaries: every conversation's state and whether it's
 * unread FOR THE CALLING PRESIDENT specifically (per-president read
 * state — see the migration's president_reads jsonb column) — used for
 * the "Student replied" filter and the per-suggestion badge.
 */
export async function getConversationSummaries(): Promise<ActionResult<Record<string, ConversationSummary>>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggestion_conversations")
    .select("suggestion_id, state, last_student_message_at, last_president_message_at, president_reads");
  if (error) return fail("Conversations could not be checked. Try again in a moment.");

  const email = session.email.toLowerCase();
  const summaries: Record<string, ConversationSummary> = {};
  for (const row of data ?? []) {
    const reads = (row.president_reads ?? {}) as Record<string, string>;
    const myLastRead = reads[email] ?? null;
    const unread = row.last_student_message_at !== null && (myLastRead === null || myLastRead < row.last_student_message_at);
    summaries[row.suggestion_id] = {
      suggestionId: row.suggestion_id,
      state: row.state as ConversationState,
      hasConversation: true,
      lastStudentMessageAt: row.last_student_message_at,
      lastPresidentMessageAt: row.last_president_message_at,
      unread,
    };
  }
  return { ok: true, data: summaries };
}
