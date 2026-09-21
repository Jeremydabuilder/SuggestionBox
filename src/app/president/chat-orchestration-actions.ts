"use server";

import { getPresidentSession } from "@/lib/auth";
import { sendUserMessage, listMessages } from "./chat-actions";
import { routeChatMessage } from "./chat-router";
import { insertAssistantMessage } from "./chat-assistant-internal";
import type { ActionResult } from "./actions";
import type { ChatMessage } from "@/lib/chat-store";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export interface SendChatMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  intent: string;
  toolStatus: "ok" | "not_available";
}

const RECENT_CONTEXT_MESSAGES = 6;

/**
 * The one browser-callable entry point that turns a typed message into a
 * persisted turn: insert the user's message (via the existing, RLS-
 * enforced sendUserMessage), route it (Stage 3), and persist the
 * assistant's reply through the trusted internal module — never a raw
 * client-controllable insert of an assistant row.
 *
 * Obtains identity from getPresidentSession() itself, exactly as required:
 * nothing here accepts a claimed president identity as an argument.
 */
export async function sendChatMessage(rawConversationId: unknown, rawContent: unknown): Promise<ActionResult<SendChatMessageResult>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const conversationId = typeof rawConversationId === "string" ? rawConversationId : "";

  const userResult = await sendUserMessage(conversationId, rawContent);
  if (!userResult.ok) return userResult;

  // Bounded recent context for pronoun/reference resolution only — capped
  // well below what the classifier itself further bounds (see
  // CLASSIFIER_LIMITS in lib/chat-classifier.ts).
  const historyResult = await listMessages(conversationId, { limit: 200, offset: 0 });
  const priorMessages = historyResult.ok ? historyResult.data.messages.slice(0, -1) : [];
  const recentContext = priorMessages.slice(-RECENT_CONTEXT_MESSAGES).map((m) => m.content);

  const { decision, execution } = await routeChatMessage(session, userResult.data.content, recentContext);

  let assistantContent: string;
  if (execution.status === "ok" && execution.kind === "help") {
    assistantContent = execution.message;
  } else if (execution.status === "ok" && execution.kind === "clarification") {
    assistantContent = execution.question;
  } else if (execution.status === "ok" && execution.kind === "memory_manager") {
    assistantContent = "Opening Memory Manager.";
  } else if (execution.status === "ok" && execution.kind === "meeting_prep") {
    assistantContent = "Opening Meeting Prep.";
  } else if (execution.status === "ok" && execution.kind === "meeting_history") {
    assistantContent = "Opening Meeting History.";
  } else if (execution.status === "ok" && execution.kind === "list_decisions") {
    assistantContent = "Opening the Decision Log.";
  } else if (execution.status === "ok" && execution.kind === "list_actions") {
    assistantContent = "Opening Action Items.";
  } else {
    assistantContent = execution.status === "not_available" ? execution.reason : "I couldn't process that just now.";
  }

  let assistantMessageId: string;
  try {
    assistantMessageId = await insertAssistantMessage(session, conversationId, assistantContent, null);
  } catch {
    return fail("Your message was sent, but I couldn't reply just now. Try again in a moment.");
  }

  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    conversationId,
    role: "assistant",
    content: assistantContent,
    structured: null,
    createdBy: session.email,
    createdAt: new Date().toISOString(),
  };

  return {
    ok: true,
    data: {
      userMessage: userResult.data,
      assistantMessage,
      intent: decision.intent,
      toolStatus: execution.status,
    },
  };
}
