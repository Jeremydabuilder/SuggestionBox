import "server-only";
import type { PresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { searchInboxSuggestions, type SearchableSuggestion } from "@/lib/inbox-search";
import {
  buildCommunicationPrompt,
  communicationDraftSystemPrompt,
  COMMUNICATION_DRAFT_LIMITS,
  COMMUNICATION_DRAFT_KINDS,
  type CommunicationDraftKind,
} from "@/lib/communication-prompt";
import { allCitationsAllowed } from "@/lib/inbox-citations";
import { generateAnswerCompletion } from "@/lib/groq";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import type { CommunicationDraftStructured } from "@/lib/chat-store";

/**
 * Draft communications (draft_communication). Same boundary shape as
 * chat-inbox-answer.ts and chat-proposal-builder.ts. There is no send
 * capability anywhere reachable from this file — the draft is chat text
 * only, exactly like every other assistant reply; the president copies it
 * out and sends it themselves through whatever channel they actually use.
 */

const MAX_ROWS = 500;
const DEFAULT_KIND: CommunicationDraftKind = "student_update";

export interface CommunicationDraftResult {
  content: string;
  structured: CommunicationDraftStructured | null;
  groqRequestCount: number;
}

export async function buildCommunicationDraft(
  session: PresidentSession,
  rawKind: string | undefined,
  topic: string,
): Promise<CommunicationDraftResult> {
  const kind = (COMMUNICATION_DRAFT_KINDS as readonly string[]).includes(rawKind ?? "")
    ? (rawKind as CommunicationDraftKind)
    : DEFAULT_KIND;

  if (!serverEnv.groqApiKey) {
    return { content: "I can't reach the AI right now — set up GROQ_API_KEY to draft communications.", structured: null, groqRequestCount: 0 };
  }

  const limit = checkChatRateLimit(`chat:communication:${session.email}`, 10, 5 * 60_000);
  if (!limit.allowed) {
    return { content: "You're drafting quickly — wait a moment and try again.", structured: null, groqRequestCount: 0 };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggestions")
    .select("id, title, description, improvement_reason, category, status, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    return { content: "The workspace could not be read. Try again in a moment.", structured: null, groqRequestCount: 0 };
  }

  const all = (data ?? []) as SearchableSuggestion[];
  const { hits } = searchInboxSuggestions(all, { query: topic || undefined }, COMMUNICATION_DRAFT_LIMITS.maxEvidence);
  const titleByRef = new Map(hits.map((h) => [h.ref, h.title]));
  const detailById = new Map(all.map((s) => [s.id, s]));
  const evidence = hits.map((h) => ({
    ref: h.ref,
    title: h.title,
    description: detailById.get(h.id)?.description ?? "",
    status: h.status,
  }));

  if (evidence.length === 0) {
    return {
      content: "I didn't find enough matching workspace activity to draft that.",
      structured: { type: "communication_draft", kind, answer: "No matching evidence was found.", citations: [] },
      groqRequestCount: 0,
    };
  }

  const userPrompt = buildCommunicationPrompt(topic, evidence);
  const outcome = await generateAnswerCompletion(communicationDraftSystemPrompt(kind), userPrompt, {
    maxTokens: COMMUNICATION_DRAFT_LIMITS.maxTokens,
    timeoutMs: COMMUNICATION_DRAFT_LIMITS.timeoutMs,
  });

  if (!outcome.ok) {
    return { content: "The AI is unavailable right now — try again in a moment.", structured: null, groqRequestCount: outcome.requestCount };
  }

  const allowedRefs = new Set(hits.map((h) => h.ref));
  if (!allCitationsAllowed(outcome.content, allowedRefs)) {
    console.error("[chat-communication-draft] discarded a draft citing a ref outside its own evidence");
    return {
      content: "I couldn't draft that reliably from the workspace data. Try narrowing the topic.",
      structured: null,
      groqRequestCount: outcome.requestCount,
    };
  }

  const citedRefs = [...allowedRefs].filter((ref) => outcome.content.includes(`[${ref}]`));
  const structured: CommunicationDraftStructured = {
    type: "communication_draft",
    kind,
    answer: outcome.content.trim().slice(0, COMMUNICATION_DRAFT_LIMITS.answerLength),
    citations: citedRefs.map((ref) => ({ ref, title: titleByRef.get(ref) ?? "" })),
  };

  return { content: outcome.content.trim(), structured, groqRequestCount: outcome.requestCount };
}
