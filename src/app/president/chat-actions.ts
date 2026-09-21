"use server";

import { revalidatePath } from "next/cache";
import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/sanitize";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import {
  conversationTitleSchema,
  userMessageContentSchema,
  assistantStructuredSchema,
  CHAT_LIMITS,
  type ChatConversation,
  type ChatMessage,
} from "@/lib/chat-store";
import type { ActionResult } from "./actions";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ConversationRow {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  structured: unknown;
  created_by: string;
  created_at: string;
}

function mapConversation(row: ConversationRow): ChatConversation {
  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): ChatMessage {
  // structured is server-validated on the way IN (see sendUserMessage and
  // the trusted assistant-message path), but re-validated here too on the
  // way OUT — never trust a stored JSON blob to still match the schema a
  // future migration might have changed underneath it. A row that fails
  // this check renders as plain text rather than crashing the whole list.
  const parsedStructured = row.structured ? assistantStructuredSchema.safeParse(row.structured) : null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    structured: parsedStructured?.success ? parsedStructured.data : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const PAGE_LIMITS = { conversations: 50, messages: 200 } as const;

function clampLimit(requested: number | undefined, max: number, fallback: number): number {
  if (!requested || requested < 1) return fallback;
  return Math.min(requested, max);
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export async function createConversation(rawTitle?: unknown): Promise<ActionResult<ChatConversation>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const limit = checkChatRateLimit(`chat:create-conversation:${session.email}`, 10, 10 * 60_000);
  if (!limit.allowed) return fail("Please wait a moment before starting another conversation.");

  let title = "New conversation";
  if (typeof rawTitle === "string" && rawTitle.trim().length > 0) {
    const parsed = conversationTitleSchema.safeParse(sanitizeText(rawTitle, CHAT_LIMITS.title));
    if (!parsed.success) return fail("That title didn't pass validation.");
    title = parsed.data;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("chat_conversations").insert({ title }).select("*").single();
  if (error || !data) return fail("That conversation couldn't be created. Try again in a moment.");

  revalidatePath("/president");
  return { ok: true, data: mapConversation(data as ConversationRow) };
}

export async function listConversations(options?: {
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<ActionResult<{ conversations: ChatConversation[]; total: number }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const limit = clampLimit(options?.limit, PAGE_LIMITS.conversations, 20);
  const offset = Math.max(0, options?.offset ?? 0);
  const needle = typeof options?.query === "string" ? sanitizeText(options.query, CHAT_LIMITS.title) : "";

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("chat_conversations")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (needle) query = query.ilike("title", `%${needle}%`);

  const { data, error, count } = await query;
  if (error) return fail("The conversation list could not be loaded. Try again in a moment.");

  return {
    ok: true,
    data: { conversations: ((data ?? []) as ConversationRow[]).map(mapConversation), total: count ?? 0 },
  };
}

export async function openConversation(conversationId: string): Promise<ActionResult<ChatConversation>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(conversationId)) return fail("Unknown conversation.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("chat_conversations").select("*").eq("id", conversationId).single();
  if (error || !data) return fail("That conversation could not be found.");

  return { ok: true, data: mapConversation(data as ConversationRow) };
}

export async function renameConversation(conversationId: string, rawTitle: unknown): Promise<ActionResult<ChatConversation>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(conversationId)) return fail("Unknown conversation.");

  const limit = checkChatRateLimit(`chat:rename:${session.email}`, 30, 10 * 60_000);
  if (!limit.allowed) return fail("Please slow down — try again in a moment.");

  const parsed = conversationTitleSchema.safeParse(sanitizeText(rawTitle, CHAT_LIMITS.title));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That title didn't pass validation.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("chat_conversations")
    .update({ title: parsed.data })
    .eq("id", conversationId)
    .select("*")
    .single();
  if (error || !data) return fail("That conversation could not be found or renamed.");

  revalidatePath("/president");
  return { ok: true, data: mapConversation(data as ConversationRow) };
}

/**
 * Deletes exactly one conversation and, via the documented cascade, its own
 * messages and their pending confirmations — nothing else. Confirmation
 * that this is what the president wants is a UI responsibility (a
 * confirm-before-delete dialog); this action performs the delete once
 * called, the same as deleteDecision/deleteActionItem elsewhere in this app.
 */
export async function deleteConversation(conversationId: string): Promise<ActionResult> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(conversationId)) return fail("Unknown conversation.");

  const limit = checkChatRateLimit(`chat:delete:${session.email}`, 30, 10 * 60_000);
  if (!limit.allowed) return fail("Please slow down — try again in a moment.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("chat_conversations").delete().eq("id", conversationId);
  if (error) return fail("That conversation could not be deleted. Try again in a moment.");

  revalidatePath("/president");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Messages                                                             */
/* ------------------------------------------------------------------ */

export async function listMessages(
  conversationId: string,
  options?: { limit?: number; offset?: number },
): Promise<ActionResult<{ messages: ChatMessage[]; total: number }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");
  if (!UUID_RE.test(conversationId)) return fail("Unknown conversation.");

  const limit = clampLimit(options?.limit, PAGE_LIMITS.messages, 50);
  const offset = Math.max(0, options?.offset ?? 0);

  const supabase = await createSupabaseServerClient();
  const { data, error, count } = await supabase
    .from("chat_messages")
    .select("*", { count: "exact" })
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return fail("Those messages could not be loaded. Try again in a moment.");

  return { ok: true, data: { messages: ((data ?? []) as MessageRow[]).map(mapMessage), total: count ?? 0 } };
}

/**
 * Appends a plain user message. role and structured are never taken from
 * the caller — they are fixed here as 'user' and null, matching exactly
 * what the chat_messages RLS insert policy allows an authenticated client
 * to write. created_by, created_at come from the database trigger, not
 * from this function's arguments; there is no argument for them at all.
 */
export async function sendUserMessage(rawConversationId: unknown, rawContent: unknown): Promise<ActionResult<ChatMessage>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const conversationId = typeof rawConversationId === "string" ? rawConversationId : "";
  if (!UUID_RE.test(conversationId)) return fail("Unknown conversation.");

  const limit = checkChatRateLimit(`chat:send:${session.email}`, 30, 5 * 60_000);
  if (!limit.allowed) return fail(`You're sending messages quickly — wait ${limit.retryAfterSeconds}s and try again.`);

  const cleaned = sanitizeText(rawContent, CHAT_LIMITS.userMessage);
  const parsed = userMessageContentSchema.safeParse(cleaned);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Write something first.");

  const supabase = await createSupabaseServerClient();

  // Verify the conversation exists and is visible to this president before
  // appending — RLS would reject the insert anyway via the FK/select path,
  // but this gives a clear error instead of a raw database failure.
  const { data: conversation, error: conversationError } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("id", conversationId)
    .single();
  if (conversationError || !conversation) return fail("That conversation could not be found.");

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ conversation_id: conversationId, role: "user", content: parsed.data, structured: null })
    .select("*")
    .single();
  if (error || !data) return fail("That message could not be sent. Try again in a moment.");

  revalidatePath("/president");
  return { ok: true, data: mapMessage(data as MessageRow) };
}
