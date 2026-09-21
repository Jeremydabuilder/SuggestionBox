import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { PresidentSession } from "@/lib/auth";
import type { AssistantStructured, MemoryCategory } from "@/lib/chat-store";

/**
 * The one trusted boundary for writes an authenticated president can never
 * make directly (see 20260925000000_ai_chat.sql): an assistant chat
 * message, a pending confirmation, or a confirmed durable-memory mutation.
 *
 * Nothing in this file is a Server Action — there is no "use server"
 * directive, so none of these functions can be called directly from a
 * client bundle. Every export here takes an already-verified
 * PresidentSession as its first argument; this module does not, and must
 * not, call getPresidentSession() itself — that is the caller's job, on
 * every call path that reaches into this file, before it does.
 */

const DEFAULT_CONFIRMATION_TTL_SECONDS = 15 * 60;

export async function insertAssistantMessage(
  session: PresidentSession,
  conversationId: string,
  content: string,
  structured: AssistantStructured | null,
): Promise<string> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("insert_chat_assistant_message", {
    p_conversation_id: conversationId,
    p_content: content,
    p_structured: structured,
    p_acting_email: session.email,
  });
  if (error || !data) {
    console.error("[chat] assistant message insert failed:", error?.message);
    throw new Error("Could not record the assistant's message.");
  }
  return data as string;
}

export type MemoryActionType = "save_memory" | "update_memory" | "delete_memory";

/**
 * Creates the assistant confirmation-card message and its matching pending
 * confirmation together, sharing one pre-generated id (see the migration
 * comment on create_chat_pending_confirmation for why the id must be
 * generated before the message is written, not after).
 */
export async function proposeMemoryAction(
  session: PresidentSession,
  conversationId: string,
  actionType: MemoryActionType,
  payload: Record<string, unknown>,
  cardContent: string,
  cardPreview: { memoryText: string; category: MemoryCategory | null },
): Promise<{ messageId: string; confirmationId: string }> {
  const confirmationId = randomUUID();
  const operation = actionType === "save_memory" ? "create" : actionType === "update_memory" ? "update" : "delete";

  const structured: AssistantStructured = {
    type: "memory_proposal",
    confirmationId,
    operation,
    memoryText: cardPreview.memoryText,
    category: cardPreview.category,
  };

  const messageId = await insertAssistantMessage(session, conversationId, cardContent, structured);

  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("create_chat_pending_confirmation", {
    p_confirmation_id: confirmationId,
    p_message_id: messageId,
    p_action_type: actionType,
    p_payload: payload,
    p_ttl_seconds: DEFAULT_CONFIRMATION_TTL_SECONDS,
    p_acting_email: session.email,
  });
  if (error || !data) {
    console.error("[chat] pending confirmation insert failed:", error?.message);
    throw new Error("Could not create the confirmation.");
  }

  return { messageId, confirmationId };
}

export interface MemoryConfirmationOutcome {
  ok: boolean;
  error?: string;
  memoryId?: string;
  actionType?: string;
}

/** Atomic claim + mutate + mark-confirmed, entirely inside one Postgres function call. */
export async function applyMemoryConfirmation(
  session: PresidentSession,
  confirmationId: string,
): Promise<MemoryConfirmationOutcome> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("apply_chat_memory_confirmation", {
    p_confirmation_id: confirmationId,
    p_acting_email: session.email,
  });
  if (error) {
    console.error("[chat] memory confirmation apply failed:", error.message);
    return { ok: false, error: "server_error" };
  }
  const result = data as { ok: boolean; error?: string; memory_id?: string; action_type?: string };
  return { ok: result.ok, error: result.error, memoryId: result.memory_id, actionType: result.action_type };
}

/** Cancel a still-pending confirmation. Returns false if it was already used, expired, or unknown. */
export async function invalidatePendingConfirmation(confirmationId: string): Promise<boolean> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("invalidate_chat_pending_confirmation", {
    p_confirmation_id: confirmationId,
  });
  if (error) {
    console.error("[chat] confirmation invalidate failed:", error.message);
    return false;
  }
  return Boolean(data);
}
