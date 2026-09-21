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
import { generateJsonCompletion, GroqRequestError } from "@/lib/groq";
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

  const finish = (decision: RouteDecision, source: RouteMetadata["route_source"], errorCategory?: string): RoutedMessage => {
    logRouteMetadata({
      route_source: source,
      intent: decision.intent,
      needs_clarification: decision.needsClarification,
      duration_bucket: durationBucket(Date.now() - start),
      ...(errorCategory ? { error_category: errorCategory } : {}),
    });
    return { decision, execution: executeRoute(decision) };
  };

  if (!message) {
    return finish(fallbackDecision("What would you like help with?"), "fallback", "empty_message");
  }

  // Deterministic routing first, and always — this makes zero Groq calls.
  const deterministic = routeDeterministically(message);
  if (deterministic) {
    return finish(deterministic, "deterministic");
  }

  if (!serverEnv.groqApiKey) {
    return finish(
      fallbackDecision("I can't reach the AI classifier right now — try one of the suggested prompts, or set up GROQ_API_KEY."),
      "fallback",
      "unconfigured",
    );
  }

  const limit = checkChatRateLimit(`chat:classify:${session.email}`, 20, 5 * 60_000);
  if (!limit.allowed) {
    return finish(fallbackDecision("You're sending requests quickly — wait a moment and try again."), "fallback", "rate_limited");
  }

  try {
    const userPrompt = buildClassifierUserPrompt(message, recentContext);
    const { content } = await generateJsonCompletion(CLASSIFIER_SYSTEM_PROMPT, userPrompt, {
      maxTokens: CLASSIFIER_LIMITS.maxTokens,
      timeoutMs: CLASSIFIER_LIMITS.timeoutMs,
    });

    const parsed = parseClassifierOutput(content);
    if (!parsed.ok) {
      return finish(fallbackDecision("I couldn't quite understand that — could you rephrase it?"), "fallback", parsed.reason);
    }

    return finish(parsed.decision, "ai");
  } catch (error) {
    const category =
      error instanceof GroqRequestError
        ? error.status === 429
          ? "rate_limited"
          : error.status === 401 || error.status === 403
            ? "unauthorized"
            : "upstream_error"
        : error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "network_error";
    return finish(fallbackDecision("The AI classifier is unavailable right now — try one of the suggested prompts."), "fallback", category);
  }
}
