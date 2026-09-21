import "server-only";
import type { PresidentSession } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { routeDeterministically } from "@/lib/chat-router-deterministic";
import {
  buildClassifierUserPrompt,
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_LIMITS,
  parseClassifierOutput,
} from "@/lib/chat-classifier";
import { generateClassifierCompletion, CLASSIFIER_MAX_REQUESTS } from "@/lib/groq";
import { checkChatRateLimit } from "@/lib/chat-rate-limit";
import { boundTextForPrompt } from "@/lib/text-bounds";
import { parseIntentArgs, type RouteDecision } from "@/lib/chat-intents";
import { executeRoute, type ToolExecutionResult } from "./chat-tool-registry";

/**
 * The one place a chat message becomes a route. This is NOT a Server
 * Action (no "use server") and is never exported to the browser — it takes
 * an ALREADY-VERIFIED PresidentSession as its first argument and never
 * calls getPresidentSession() itself. The future "use server" action that
 * wraps this for real chat orchestration must obtain identity from
 * getPresidentSession() and pass the result in; it must never accept a
 * claimed president identity as an argument from the client.
 */

export interface RouteMetadata {
  route_source: "deterministic" | "ai" | "fallback";
  intent: string;
  needs_clarification: boolean;
  duration_bucket: string;
  error_category?: string;
  /** Exact count of Groq HTTP requests made for this routing attempt. 0 for deterministic routes. Never exceeds CLASSIFIER_MAX_REQUESTS (2). */
  groq_request_count: number;
}

function durationBucket(ms: number): string {
  if (ms < 50) return "<50ms";
  if (ms < 200) return "<200ms";
  if (ms < 1000) return "<1s";
  if (ms < 5000) return "<5s";
  return ">=5s";
}

/**
 * Logs ONLY the fields on RouteMetadata — never message text, context
 * text, model output, student data, or memory contents. There is no
 * parameter to this function that could carry any of that; a future edit
 * that tries to log more must change this function's own signature to do
 * it, which is the point.
 */
function logRouteMetadata(meta: RouteMetadata): void {
  console.info("[chat-router]", meta);
}

function fallbackDecision(question: string, source: RouteDecision["source"] = "fallback"): RouteDecision {
  return {
    intent: "clarification_needed",
    args: parseIntentArgs("clarification_needed", { question }),
    confidence: "low",
    needsClarification: true,
    clarificationQuestion: question,
    source,
  };
}

export interface RoutedMessage {
  decision: RouteDecision;
  execution: ToolExecutionResult;
}

export async function routeChatMessage(
  session: PresidentSession,
  rawMessage: string,
  recentContext: string[] = [],
): Promise<RoutedMessage> {
  const start = Date.now();
  const message = boundTextForPrompt(rawMessage, CLASSIFIER_LIMITS.message);

  const finish = (
    decision: RouteDecision,
    source: RouteMetadata["route_source"],
    groqRequestCount: number,
    errorCategory?: string,
  ): RoutedMessage => {
    logRouteMetadata({
      route_source: source,
      intent: decision.intent,
      needs_clarification: decision.needsClarification,
      duration_bucket: durationBucket(Date.now() - start),
      groq_request_count: groqRequestCount,
      ...(errorCategory ? { error_category: errorCategory } : {}),
    });
    return { decision, execution: executeRoute(decision) };
  };

  if (!message) {
    return finish(fallbackDecision("What would you like help with?"), "fallback", 0, "empty_message");
  }

  // Deterministic routing first, and always — this makes zero Groq calls.
  const deterministic = routeDeterministically(message);
  if (deterministic) {
    return finish(deterministic, "deterministic", 0);
  }

  if (!serverEnv.groqApiKey) {
    return finish(
      fallbackDecision("I can't reach the AI classifier right now — try one of the suggested prompts, or set up GROQ_API_KEY."),
      "fallback",
      0,
      "unconfigured",
    );
  }

  const limit = checkChatRateLimit(`chat:classify:${session.email}`, 20, 5 * 60_000);
  if (!limit.allowed) {
    return finish(fallbackDecision("You're sending requests quickly — wait a moment and try again."), "fallback", 0, "rate_limited");
  }

  // At most CLASSIFIER_MAX_REQUESTS (2) Groq HTTP requests happen below:
  // the configured model once, and — only on a model-incompatibility
  // signal — exactly one explicit fallback model. Never more, never a
  // silent multi-model cycle. See generateClassifierCompletion's own doc
  // comment for the exact rule.
  const userPrompt = buildClassifierUserPrompt(message, recentContext);
  const outcome = await generateClassifierCompletion(CLASSIFIER_SYSTEM_PROMPT, userPrompt, {
    maxTokens: CLASSIFIER_LIMITS.maxTokens,
    timeoutMs: CLASSIFIER_LIMITS.timeoutMs,
  });

  if (!outcome.ok) {
    return finish(
      fallbackDecision("The AI classifier is unavailable right now — try one of the suggested prompts."),
      "fallback",
      outcome.requestCount,
      outcome.errorCategory,
    );
  }

  const parsed = parseClassifierOutput(outcome.content);
  if (!parsed.ok) {
    return finish(
      fallbackDecision("I couldn't quite understand that — could you rephrase it?"),
      "fallback",
      outcome.requestCount,
      parsed.reason,
    );
  }

  return finish(parsed.decision, "ai", outcome.requestCount);
}

export { CLASSIFIER_MAX_REQUESTS };
