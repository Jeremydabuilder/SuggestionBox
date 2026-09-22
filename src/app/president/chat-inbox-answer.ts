import "server-only";
import type { PresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { searchInboxSuggestions, type SearchableSuggestion } from "@/lib/inbox-search";
import { buildInboxAnswerPrompt, INBOX_ANSWER_SYSTEM_PROMPT, INBOX_ANSWER_LIMITS } from "@/lib/inbox-answer-prompt";
import { allCitationsAllowed } from "@/lib/inbox-citations";
import { generateAnswerCompletion, ANSWER_MAX_REQUESTS } from "@/lib/groq";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import type { InboxAnswerStructured } from "@/lib/chat-store";

/**
 * "Ask the Inbox" (general_workspace_question). This is NOT a Server
 * Action and is never exported to the browser — same boundary as
 * chat-router.ts: it takes an already-verified PresidentSession and never
 * calls getPresidentSession() itself.
 *
 * At most ANSWER_MAX_REQUESTS (2) Groq HTTP requests happen per call —
 * the configured model once, and only on a model-incompatibility signal,
 * one explicit fallback. Every citation the model produces is
 * re-validated against the exact evidence it was given
 * (lib/inbox-citations.ts) before anything is returned; if even one cited
 * ref falls outside that allowlist, the whole answer is discarded in
 * favor of an honest "couldn't find a reliable answer" message — a
 * partially-trusted answer is never shown.
 */

const MAX_ROWS = 500;

export interface InboxAnswerResult {
  content: string;
  structured: InboxAnswerStructured | null;
  groqRequestCount: number;
}

const MAX_QUOTA_MESSAGE = "You're asking the inbox quickly — wait a moment and try again.";

export async function answerWorkspaceQuestion(session: PresidentSession, question: string): Promise<InboxAnswerResult> {
  if (!serverEnv.groqApiKey) {
    return { content: "I can't reach the AI right now — try Search the inbox instead, or set up GROQ_API_KEY.", structured: null, groqRequestCount: 0 };
  }

  const limit = checkChatRateLimit(`chat:ask:${session.email}`, 15, 5 * 60_000);
  if (!limit.allowed) {
    return { content: MAX_QUOTA_MESSAGE, structured: null, groqRequestCount: 0 };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggestions")
    .select("id, title, description, improvement_reason, category, status, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    return { content: "The inbox could not be searched. Try again in a moment.", structured: null, groqRequestCount: 0 };
  }

  const { hits } = searchInboxSuggestions(
    (data ?? []) as SearchableSuggestion[],
    { query: question },
    INBOX_ANSWER_LIMITS.maxEvidence,
  );

  const titleByRef = new Map(hits.map((h) => [h.ref, h.title]));
  const detailByRef = new Map(((data ?? []) as SearchableSuggestion[]).map((s) => [s.id, s]));
  const evidence = hits.map((h) => ({
    ref: h.ref,
    title: h.title,
    description: detailByRef.get(h.id)?.description ?? "",
    status: h.status,
  }));

  if (evidence.length === 0) {
    return {
      content: "I didn't find any suggestions in the inbox matching that question.",
      structured: { type: "inbox_answer", answer: "No matching suggestions were found.", citations: [] },
      groqRequestCount: 0,
    };
  }

  const userPrompt = buildInboxAnswerPrompt(question, evidence);
  const outcome = await generateAnswerCompletion(INBOX_ANSWER_SYSTEM_PROMPT, userPrompt, {
    maxTokens: INBOX_ANSWER_LIMITS.maxTokens,
    timeoutMs: INBOX_ANSWER_LIMITS.timeoutMs,
  });

  if (!outcome.ok) {
    return { content: "The AI is unavailable right now — try Search the inbox instead.", structured: null, groqRequestCount: outcome.requestCount };
  }

  const allowedRefs = new Set(hits.map((h) => h.ref));
  if (!allCitationsAllowed(outcome.content, allowedRefs)) {
    console.error("[chat-inbox-answer] discarded an answer citing a ref outside its own evidence");
    return {
      content: "I couldn't find a reliable answer in the inbox for that.",
      structured: null,
      groqRequestCount: outcome.requestCount,
    };
  }

  const citedRefs = [...allowedRefs].filter((ref) => outcome.content.includes(`[${ref}]`));
  const structured: InboxAnswerStructured = {
    type: "inbox_answer",
    answer: outcome.content.trim().slice(0, 1000),
    citations: citedRefs.map((ref) => ({ ref, title: titleByRef.get(ref) ?? "" })),
  };

  return { content: outcome.content.trim(), structured, groqRequestCount: outcome.requestCount };
}

export { ANSWER_MAX_REQUESTS };
