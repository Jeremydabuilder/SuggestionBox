"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/sanitize";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import type { ConversationState, ConversationSummary, StudentConversationMessage } from "@/lib/types";
import type { ActionResult } from "@/app/president/actions";

/**
 * Student-side conversation actions. Every one of these re-derives the
 * caller's identity from their own Supabase auth session — never a
 * client-supplied email or suggestion ownership claim — and every read or
 * write goes through the migration's SECURITY DEFINER functions
 * (list_my_conversation_messages, send_suggestion_message,
 * mark_conversation_read_by_student), which independently re-verify
 * submitter_user_id = auth.uid() themselves. A student can never reach
 * another student's thread by any path here, including a raw
 * `.from("suggestion_messages")` call, since that table has no SELECT
 * grant at all — see the migration's own doc comment.
 */

const MESSAGE_MAX_LENGTH = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

async function requireStudentId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export interface MyConversationData {
  state: ConversationState;
  messages: StudentConversationMessage[];
}

export async function getMyConversation(rawSuggestionId: unknown): Promise<ActionResult<MyConversationData>> {
  const userId = await requireStudentId();
  if (!userId) return fail("Sign in to view this conversation.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const supabase = await createSupabaseServerClient();

  const [messagesRes, conversationRes] = await Promise.all([
    supabase.rpc("list_my_conversation_messages", { p_suggestion_id: suggestionId }),
    supabase.from("suggestion_conversations").select("state").eq("suggestion_id", suggestionId).maybeSingle(),
  ]);

  if (messagesRes.error) return fail("The conversation could not be loaded. Try again in a moment.");

  const rows = (messagesRes.data ?? []) as Array<{ id: string; sender_role: "student" | "president"; body: string; created_at: string }>;

  return {
    ok: true,
    data: {
      state: (conversationRes.data?.state as ConversationState | undefined) ?? "open",
      messages: rows.map((r) => ({ id: r.id, senderRole: r.sender_role, body: r.body, createdAt: r.created_at })),
    },
  };
}

export async function sendMyMessage(rawSuggestionId: unknown, rawBody: unknown): Promise<ActionResult<StudentConversationMessage>> {
  const userId = await requireStudentId();
  if (!userId) return fail("Sign in to send a message.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const body = typeof rawBody === "string" ? sanitizeText(rawBody, MESSAGE_MAX_LENGTH) : "";
  if (body.length === 0) return fail("Write a message before sending.");

  const limit = checkChatRateLimit(`conversation:send:student:${userId}`, 12, 5 * 60_000);
  if (!limit.allowed) return fail("You're sending messages quickly — wait a moment and try again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("send_suggestion_message", { p_suggestion_id: suggestionId, p_body: body }).single();
  if (error || !data) return fail(error?.message ?? "That message could not be sent. Try again in a moment.");

  const row = data as { id: string; sender_role: "student" | "president"; body: string; created_at: string };
  return { ok: true, data: { id: row.id, senderRole: row.sender_role, body: row.body, createdAt: row.created_at } };
}

export async function markMyConversationRead(rawSuggestionId: unknown): Promise<ActionResult> {
  const userId = await requireStudentId();
  if (!userId) return fail("Sign in to do that.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_conversation_read_by_student", { p_suggestion_id: suggestionId });
  if (error) return fail(error.message);
  return { ok: true };
}

/**
 * Unread badges for the My Ideas list — one lightweight, safe read (no
 * message content, no sender identity) covering every one of the
 * student's own suggestions at once.
 */
export async function getMyConversationSummaries(): Promise<ActionResult<Record<string, ConversationSummary>>> {
  const userId = await requireStudentId();
  if (!userId) return fail("Sign in to view this.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggestion_conversations")
    .select("suggestion_id, state, last_student_message_at, last_president_message_at, student_last_read_at");
  if (error) return fail("Conversations could not be checked. Try again in a moment.");

  const summaries: Record<string, ConversationSummary> = {};
  for (const row of data ?? []) {
    const unread = row.last_president_message_at !== null && (row.student_last_read_at === null || row.student_last_read_at < row.last_president_message_at);
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
