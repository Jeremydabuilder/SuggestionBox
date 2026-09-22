import "server-only";
import type { PresidentSession } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import {
  segmentTranscript,
  buildCleanupUserPrompt,
  parseCleanupOutput,
  CLEANUP_SYSTEM_PROMPT,
  CLEANUP_LIMITS,
  type CleanupSegment,
} from "@/lib/transcript-cleanup";
import { generateClassifierCompletion } from "@/lib/groq";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";

/**
 * Cleanup Review's categorization step. Not a Server Action, never calls
 * getPresidentSession() itself — same boundary as chat-router.ts and the
 * Stage 7/8 Groq-backed modules. At most CLASSIFIER_MAX_REQUESTS (2) Groq
 * requests per call (reuses generateClassifierCompletion's own tested
 * bound). Every segment's TEXT always comes back exactly as it went in —
 * the model can only choose a category for an index, never rewrite,
 * merge, or invent a segment, so there is nothing here for a
 * citation-style fabrication check to guard against.
 */

export interface CleanupReviewResult {
  segments: CleanupSegment[];
  warning: string | null;
  groqRequestCount: number;
}

function allUnclear(segments: string[]): CleanupSegment[] {
  return segments.map((text, index) => ({ index, text, category: "unclear" as const }));
}

export async function categorizeTranscript(session: PresidentSession, rawTranscript: string): Promise<CleanupReviewResult> {
  const segments = segmentTranscript(rawTranscript);
  if (segments.length === 0) {
    return { segments: [], warning: null, groqRequestCount: 0 };
  }

  if (!serverEnv.groqApiKey) {
    return { segments: allUnclear(segments), warning: "AI categorization isn't set up — review each segment manually.", groqRequestCount: 0 };
  }

  const limit = checkChatRateLimit(`chat:cleanup:${session.email}`, 10, 5 * 60_000);
  if (!limit.allowed) {
    return { segments: allUnclear(segments), warning: "You're processing recordings quickly — wait a moment and try again.", groqRequestCount: 0 };
  }

  const userPrompt = buildCleanupUserPrompt(segments);
  const outcome = await generateClassifierCompletion(CLEANUP_SYSTEM_PROMPT, userPrompt, {
    maxTokens: CLEANUP_LIMITS.maxTokens,
    timeoutMs: CLEANUP_LIMITS.timeoutMs,
  });

  if (!outcome.ok) {
    return {
      segments: allUnclear(segments),
      warning: "AI categorization is unavailable right now — review each segment manually.",
      groqRequestCount: outcome.requestCount,
    };
  }

  const parsed = parseCleanupOutput(outcome.content, segments);
  if (!parsed.ok) {
    return {
      segments: allUnclear(segments),
      warning: "AI categorization returned something unexpected — review each segment manually.",
      groqRequestCount: outcome.requestCount,
    };
  }

  return { segments: parsed.segments, warning: null, groqRequestCount: outcome.requestCount };
}
