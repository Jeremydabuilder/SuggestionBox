"use server";

import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import { generateAnswerCompletion } from "@/lib/groq";
import {
  buildConversationPrompt,
  conversationAiSystemPrompt,
  CONVERSATION_AI_LIMITS,
  CONVERSATION_DRAFT_MODES,
  type ConversationDraftMode,
  type ConversationTranscriptLine,
} from "@/lib/conversation-ai-prompt";
import type { ActionResult } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * The only Groq call anywhere in the conversation feature — reading and
 * sending messages (conversation-actions.ts) never touch Groq at all.
 * Requires an explicit president click (this is only ever invoked by a
 * composer button, never automatically). Before anything is sent to
 * Groq, the transcript is re-fetched fresh via the same
 * list_president_conversation_messages() function the conversation panel
 * itself uses, then mapped to neutral "Student"/"Co-Presidents" labels
 * with sender_email and sender_user_id dropped entirely — those two
 * fields never exist in any value this function passes to
 * buildConversationPrompt.
 */
export async function draftConversationReply(
  rawSuggestionId: unknown,
  rawMode: unknown,
  rawCurrentDraft: unknown,
): Promise<ActionResult<{ draft: string; mode: ConversationDraftMode }>> {
  const session = await getPresidentSession();
  if (!session) return fail("Your session has expired. Sign in again.");

  const suggestionId = typeof rawSuggestionId === "string" ? rawSuggestionId : "";
  if (!UUID_RE.test(suggestionId)) return fail("That suggestion could not be found.");

  const mode = (CONVERSATION_DRAFT_MODES as readonly string[]).includes(rawMode as string)
    ? (rawMode as ConversationDraftMode)
    : null;
  if (!mode) return fail("Unknown draft action.");

  if (!serverEnv.groqApiKey) {
    return fail("I can't reach the AI right now — set up GROQ_API_KEY to draft replies.");
  }

  const limit = checkChatRateLimit(`conversation:ai:${session.email}`, 15, 5 * 60_000);
  if (!limit.allowed) return fail("You're requesting drafts quickly — wait a moment and try again.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_president_conversation_messages", { p_suggestion_id: suggestionId });
  if (error) return fail("The conversation could not be read. Try again in a moment.");

  const rows = (data ?? []) as Array<{ sender_role: "student" | "president"; body: string }>;
  const transcript: ConversationTranscriptLine[] = rows.map((r) => ({
    role: r.sender_role === "student" ? "Student" : "Co-Presidents",
    body: r.body,
  }));

  if (transcript.length === 0) {
    return fail("There's nothing in this conversation yet to draft from.");
  }

  const currentDraft = typeof rawCurrentDraft === "string" ? rawCurrentDraft : undefined;
  const userPrompt = buildConversationPrompt(mode, transcript, currentDraft);

  const outcome = await generateAnswerCompletion(conversationAiSystemPrompt(), userPrompt, {
    maxTokens: CONVERSATION_AI_LIMITS.maxTokens,
    timeoutMs: CONVERSATION_AI_LIMITS.timeoutMs,
  });

  if (!outcome.ok) {
    return fail("The AI is unavailable right now — you can still write and send a reply manually.");
  }

  return { ok: true, data: { draft: outcome.content.trim().slice(0, CONVERSATION_AI_LIMITS.answerLength), mode } };
}
