import "server-only";
import type { PresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { searchInboxSuggestions, type SearchableSuggestion } from "@/lib/inbox-search";
import { buildProposalPrompt, PROPOSAL_BUILDER_SYSTEM_PROMPT, PROPOSAL_BUILDER_LIMITS } from "@/lib/proposal-prompt";
import { allCitationsAllowed } from "@/lib/inbox-citations";
import { generateAnswerCompletion } from "@/lib/groq";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import type { ProposalDraftStructured } from "@/lib/chat-store";

/**
 * Proposal Builder (proposal_builder). Same boundary shape as
 * chat-inbox-answer.ts: not a Server Action, never calls
 * getPresidentSession() itself, at most 2 Groq requests, and every
 * citation the model produces is re-validated against its own evidence
 * before a structured draft is ever built. Nothing here writes anywhere —
 * the draft exists only as chat text the president copies out manually,
 * per the explicit product decision not to add a proposals table this
 * stage (see the Stage 8 commit message for why).
 */

const MAX_ROWS = 500;

export interface ProposalBuilderResult {
  content: string;
  structured: ProposalDraftStructured | null;
  groqRequestCount: number;
}

export async function buildProposalDraft(session: PresidentSession, topic: string): Promise<ProposalBuilderResult> {
  if (!serverEnv.groqApiKey) {
    return { content: "I can't reach the AI right now — set up GROQ_API_KEY to use the Proposal Builder.", structured: null, groqRequestCount: 0 };
  }

  const limit = checkChatRateLimit(`chat:proposal:${session.email}`, 10, 5 * 60_000);
  if (!limit.allowed) {
    return { content: "You're drafting proposals quickly — wait a moment and try again.", structured: null, groqRequestCount: 0 };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suggestions")
    .select("id, title, description, improvement_reason, category, status, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    return { content: "The inbox could not be read. Try again in a moment.", structured: null, groqRequestCount: 0 };
  }

  const all = (data ?? []) as SearchableSuggestion[];
  const { hits } = searchInboxSuggestions(all, { query: topic || undefined }, PROPOSAL_BUILDER_LIMITS.maxEvidence);
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
      content: "I didn't find enough matching suggestions in the inbox to draft a proposal.",
      structured: { type: "proposal_draft", answer: "No matching suggestions were found.", citations: [] },
      groqRequestCount: 0,
    };
  }

  const userPrompt = buildProposalPrompt(topic, evidence);
  const outcome = await generateAnswerCompletion(PROPOSAL_BUILDER_SYSTEM_PROMPT, userPrompt, {
    maxTokens: PROPOSAL_BUILDER_LIMITS.maxTokens,
    timeoutMs: PROPOSAL_BUILDER_LIMITS.timeoutMs,
  });

  if (!outcome.ok) {
    return { content: "The AI is unavailable right now — try again in a moment.", structured: null, groqRequestCount: outcome.requestCount };
  }

  const allowedRefs = new Set(hits.map((h) => h.ref));
  if (!allCitationsAllowed(outcome.content, allowedRefs)) {
    console.error("[chat-proposal-builder] discarded a draft citing a ref outside its own evidence");
    return {
      content: "I couldn't build a reliable proposal from the inbox for that.",
      structured: null,
      groqRequestCount: outcome.requestCount,
    };
  }

  const citedRefs = [...allowedRefs].filter((ref) => outcome.content.includes(`[${ref}]`));
  const structured: ProposalDraftStructured = {
    type: "proposal_draft",
    answer: outcome.content.trim().slice(0, PROPOSAL_BUILDER_LIMITS.answerLength),
    citations: citedRefs.map((ref) => ({ ref, title: titleByRef.get(ref) ?? "" })),
  };

  return { content: outcome.content.trim(), structured, groqRequestCount: outcome.requestCount };
}
